"""Bucle principal: reclama jobs y los despacha de a uno."""
from __future__ import annotations

import logging
import socket
import time

from . import db, jobs, live_recorder
from .config import get_settings

log = logging.getLogger("snip.runner")


def run_one(job: dict) -> None:
    jtype = job["type"]
    handler = jobs.HANDLERS.get(jtype)
    if handler is None:
        raise RuntimeError(f"Tipo de job desconocido: {jtype}")
    handler(job)


def run_forever() -> None:
    s = get_settings()
    s.require_supabase()
    worker_id = socket.gethostname()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    log.info("Worker '%s' iniciado. Datos en %s. Esperando jobs cada %.0f s (Ctrl+C para salir).",
             worker_id, s.data_dir, s.poll_seconds)
    job: dict | None = None
    live_recorder.start()
    try:
        while True:
            try:
                job = db.claim_job(worker_id)
            except Exception as exc:
                log.error("No se pudo consultar jobs (%s). Reintentando...", exc)
                time.sleep(max(s.poll_seconds, 5))
                continue
            if not job:
                time.sleep(s.poll_seconds)
                continue
            log.info("Job %s [%s] tomado (intento %s)", job["id"], job["type"], job.get("attempts"))
            started = time.monotonic()
            try:
                run_one(job)
                db.finish_job(job["id"])
                log.info("Job %s terminado en %.0f s", job["id"], time.monotonic() - started)
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                log.exception("Job %s falló: %s", job["id"], exc)
                try:
                    db.fail_job(job["id"], f"{type(exc).__name__}: {exc}")
                except Exception as exc2:
                    log.error("Además no se pudo marcar el job como error: %s", exc2)
            job = None
    except KeyboardInterrupt:
        log.info("Ctrl+C recibido: cerrando el worker.")
        live_recorder.stop()
        if job is not None:
            try:
                db.client().table("jobs").update({"status": "pending", "worker_id": None}).eq(
                    "id", job["id"]
                ).execute()
                log.info("El job %s volvió a la cola.", job["id"])
            except Exception:
                pass
