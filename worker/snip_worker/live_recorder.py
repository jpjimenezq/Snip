"""Fase 3: grabación continua de canales en vivo en un búfer circular en disco.

Por cada fila enabled de live_watches mantiene `streamlink --stdout URL calidad | ffmpeg -c copy
-f segment` escribiendo segmentos seg_YYYYmmddTHHMMSS.ts (hora UTC) en SNIP_DATA_DIR/live/{id}/.
Un hilo daemon revisa la tabla cada ~10 s (también es el heartbeat). Nunca debe tumbar el worker.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import db
from . import live_utils as lu

log = logging.getLogger("snip.live")

LOOP_S = 10.0
OFFLINE_RETRY_S = 60.0
ERROR_RETRY_S = 30.0
STALL_S = 60.0  # sin segmentos nuevos durante este tiempo => reiniciar
OFFLINE_MARKERS = ("no playable streams", "could not find", "not found", "404", "is offline",
                   "no streams found", "unable to find")


class _Rec:
    """Estado de grabación de un canal."""

    def __init__(self, watch: dict):
        self.watch = watch
        self.id = watch["id"]
        self.dir = lu.watch_dir(self.id)
        self.sl: subprocess.Popen | None = None
        self.ff: subprocess.Popen | None = None
        self.started = 0.0
        self.retry_at = 0.0
        self.state = "idle"  # idle | offline | recording | error
        self.error: str | None = None
        self._logf = None

    @property
    def log_path(self) -> Path:
        return self.dir / "streamlink.log"

    def alive(self) -> bool:
        return (self.sl is not None and self.sl.poll() is None
                and self.ff is not None and self.ff.poll() is None)

    def start(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        target = lu.normalize_live_url(self.watch["url"])
        self._logf = open(self.log_path, "wb")
        self.sl = subprocess.Popen(
            [*lu.streamlink_cmd(), "--stdout", "--loglevel", "warning", target.url, lu.get_quality()],
            stdout=subprocess.PIPE, stderr=self._logf, stdin=subprocess.DEVNULL, **lu.popen_kwargs())
        env = dict(os.environ, TZ="UTC0")  # los nombres de segmento llevan hora UTC
        self.ff = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", "pipe:0",
             "-c", "copy", "-f", "segment", "-segment_time", str(lu.get_segment_s()),
             "-reset_timestamps", "1", "-strftime", "1", "-segment_format", "mpegts",
             str(self.dir / lu.segment_pattern())],
            stdin=self.sl.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
            **lu.popen_kwargs())
        if self.sl.stdout:
            self.sl.stdout.close()  # ffmpeg es el único lector
        self.started = time.monotonic()
        self.state = "idle"
        self.error = None
        log.info("Grabando %s (%s)", target.url, lu.get_quality())

    def stop(self) -> None:
        # streamlink primero: al cerrarse su salida ffmpeg finaliza el último segmento
        try:
            if self.sl is not None and self.sl.poll() is None:
                self.sl.terminate()
                try:
                    self.sl.wait(timeout=3)
                except Exception:
                    pass
            if self.ff is not None and self.ff.poll() is None:
                try:
                    self.ff.wait(timeout=5)
                except Exception:
                    pass
        finally:
            lu.kill_tree(self.sl)
            lu.kill_tree(self.ff)
            if self._logf:
                try:
                    self._logf.close()
                except Exception:
                    pass
                self._logf = None
            self.sl = self.ff = None

    def log_tail(self) -> str:
        try:
            data = self.log_path.read_bytes()[-1500:].decode("utf-8", "replace")
            return data.strip()
        except OSError:
            return ""


class Manager:
    def __init__(self) -> None:
        self.recs: dict[str, _Rec] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---- ciclo de vida
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        if not lu.streamlink_available():
            log.warning("streamlink no está instalado: las grabaciones en vivo quedan desactivadas "
                        "(pip install streamlink).")
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="live-recorder", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        for rec in list(self.recs.values()):
            try:
                rec.stop()
            except Exception as exc:
                log.warning("No se pudo detener la grabación %s: %s", rec.id, exc)
        self.recs.clear()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception as exc:  # nunca tumbar el hilo
                log.exception("Error en el gestor de grabaciones: %s", exc)
            self._stop.wait(LOOP_S)

    # ---- una vuelta
    def tick(self) -> None:
        try:
            rows = db.client().table("live_watches").select("*").execute().data or []
        except Exception as exc:
            log.warning("No se pudo leer live_watches (%s)", exc)
            return
        by_id = {r["id"]: r for r in rows}
        # detener los que ya no están habilitados / borrados
        for wid in list(self.recs):
            w = by_id.get(wid)
            if w is None or not w.get("enabled"):
                log.info("Deteniendo la grabación %s", wid)
                self.recs.pop(wid).stop()
        # limpiar disco de watches borrados
        self._cleanup_orphans(set(by_id))
        for w in rows:
            if self._stop.is_set():
                return
            try:
                if w.get("enabled"):
                    self._service(w)
                else:
                    self._set_idle(w)
            except Exception as exc:
                log.exception("Error con el canal %s: %s", w.get("url"), exc)

    def _cleanup_orphans(self, known: set[str]) -> None:
        try:
            root = lu.live_root()
            if not root.exists():
                return
            for d in root.iterdir():
                if d.is_dir() and d.name not in known and d.name not in self.recs:
                    shutil.rmtree(d, ignore_errors=True)
        except Exception as exc:
            log.debug("limpieza de huérfanos: %s", exc)

    def _set_idle(self, w: dict) -> None:
        lu.prune_segments(lu.watch_dir(w["id"]), lu.get_buffer_min())
        if w.get("status") != "idle" or w.get("buffer_s"):
            segs = lu.list_segments(lu.watch_dir(w["id"]))
            self._push(w["id"], status="idle", buffer_s=lu.buffer_seconds(segs), error=None)

    def _service(self, w: dict) -> None:
        wid = w["id"]
        rec = self.recs.get(wid)
        if rec is None or rec.watch.get("url") != w["url"]:
            if rec:
                rec.stop()
            rec = self.recs[wid] = _Rec(w)
        rec.watch = w
        now = time.monotonic()
        segs = lu.list_segments(rec.dir)
        lu.prune_segments(rec.dir, lu.get_buffer_min())

        if rec.alive():
            fresh = bool(segs) and (datetime.now(timezone.utc) - segs[-1].start).total_seconds() < STALL_S
            up = now - rec.started
            if fresh or up < STALL_S:
                rec.state = "recording" if (segs or up > 15) else rec.state
                self._push(wid, status="recording" if rec.state == "recording" else w.get("status", "idle"),
                           buffer_s=lu.buffer_seconds(lu.list_segments(rec.dir)), error=None)
                return
            log.warning("La grabación de %s se estancó; reiniciando", w["url"])
            rec.stop()
            rec.state, rec.error, rec.retry_at = "error", "La grabación se estancó (sin datos nuevos).", now + 5
        elif rec.sl is not None:  # algún proceso terminó
            tail = rec.log_tail()
            rec.stop()
            low = tail.lower()
            if any(m in low for m in OFFLINE_MARKERS) or not tail:
                rec.state, rec.error, rec.retry_at = "offline", None, now + OFFLINE_RETRY_S
            else:
                rec.state, rec.error, rec.retry_at = "error", tail[-300:], now + ERROR_RETRY_S
            log.info("Grabación de %s terminó: %s", w["url"], rec.state)

        if rec.sl is None and now >= rec.retry_at:
            if not lu.streamlink_available():
                rec.state, rec.error, rec.retry_at = "error", "streamlink no está instalado en el worker.", now + 300
            else:
                try:
                    rec.start()
                except Exception as exc:
                    rec.stop()
                    rec.state, rec.error, rec.retry_at = "error", f"{type(exc).__name__}: {exc}"[:300], now + ERROR_RETRY_S
                    log.warning("No se pudo iniciar la grabación de %s: %s", w["url"], exc)
        if rec.sl is not None:
            status = "recording" if rec.state == "recording" else "idle"
        else:
            status = rec.state if rec.state in ("offline", "error") else "idle"
        self._push(wid, status=status, buffer_s=lu.buffer_seconds(lu.list_segments(rec.dir)), error=rec.error)

    def _push(self, wid: str, **fields) -> None:
        fields["last_seen_at"] = datetime.now(timezone.utc).isoformat()
        try:
            db.client().table("live_watches").update(fields).eq("id", wid).execute()
        except Exception as exc:
            log.warning("No se pudo actualizar live_watches %s: %s", wid, exc)


_manager = Manager()


def start() -> None:
    """Arranca el gestor de grabaciones en segundo plano."""
    try:
        _manager.start()
    except Exception as exc:
        log.exception("No se pudo arrancar el grabador en vivo: %s", exc)


def stop() -> None:
    """Detiene todas las grabaciones."""
    try:
        _manager.stop()
    except Exception as exc:
        log.warning("Error al detener el grabador en vivo: %s", exc)
