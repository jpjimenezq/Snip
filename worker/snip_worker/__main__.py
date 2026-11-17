import logging
import sys

from .runner import run_forever


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in ("httpx", "httpx2", "httpcore", "hpack", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    try:
        run_forever()
    except RuntimeError as exc:
        logging.getLogger("snip").error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
