"""Configuración de logging: consola + archivo diario data/logs/worker-YYYYMMDD.log."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from pathlib import Path

FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
DATEFMT = "%H:%M:%S"
FILE_DATEFMT = "%Y-%m-%d %H:%M:%S"
KEEP_DAYS = 14


class DailyFileHandler(logging.Handler):
    """Escribe en logs/worker-YYYYMMDD.log y cambia de archivo al cambiar el día
    (el worker puede quedarse corriendo semanas). Borra los logs de más de KEEP_DAYS días."""

    def __init__(self, log_dir: Path, keep_days: int = KEEP_DAYS, prefix: str = "worker"):
        super().__init__()
        self.log_dir = Path(log_dir)
        self.keep_days = keep_days
        self.prefix = prefix
        self._day: date | None = None
        self._stream = None
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def path_for(self, day: date) -> Path:
        return self.log_dir / f"{self.prefix}-{day:%Y%m%d}.log"

    def _open(self, day: date) -> None:
        if self._stream:
            self._stream.close()
        self._stream = open(self.path_for(day), "a", encoding="utf-8")
        self._day = day
        self.prune()

    def prune(self) -> None:
        limit = datetime.now() - timedelta(days=self.keep_days)
        for p in self.log_dir.glob(f"{self.prefix}-*.log"):
            try:
                if datetime.fromtimestamp(p.stat().st_mtime) < limit:
                    p.unlink()
            except OSError:
                pass

    def emit(self, record: logging.LogRecord) -> None:
        try:
            day = date.fromtimestamp(record.created)
            if day != self._day or self._stream is None:
                self._open(day)
            self._stream.write(self.format(record) + "\n")
            self._stream.flush()
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        if self._stream:
            self._stream.close()
            self._stream = None
        super().close()


def setup_logging(log_dir: Path | None = None) -> Path | None:
    """Consola siempre; archivo diario si log_dir se puede crear. Devuelve el directorio usado."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        if getattr(h, "_snip", False):
            root.removeHandler(h)
    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter(FORMAT, DATEFMT))
    console._snip = True  # type: ignore[attr-defined]
    root.addHandler(console)
    used = None
    if log_dir is not None:
        try:
            fh = DailyFileHandler(log_dir)
            fh.setFormatter(logging.Formatter(FORMAT, FILE_DATEFMT))
            fh._snip = True  # type: ignore[attr-defined]
            root.addHandler(fh)
            used = Path(log_dir)
        except OSError as exc:
            logging.getLogger("snip").warning("No se pudo crear el log en archivo (%s)", exc)
    for noisy in ("httpx", "httpx2", "httpcore", "hpack", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return used
