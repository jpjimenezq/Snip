import logging
import sys

from .config import get_settings
from .logsetup import setup_logging
from .runner import run_forever


def main() -> int:
    log_dir = get_settings().data_dir / "logs"
    used = setup_logging(log_dir)
    if used:
        logging.getLogger("snip").info("Log en archivo: %s", used)
    try:
        run_forever()
    except RuntimeError as exc:
        logging.getLogger("snip").error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
