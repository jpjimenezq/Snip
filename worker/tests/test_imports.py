import importlib.util

import pytest


def test_imports():
    import snip_worker.jobs  # noqa: F401
    import snip_worker.runner  # noqa: F401
    import snip_worker.ingest  # noqa: F401
    import snip_worker.transcribe  # noqa: F401


@pytest.mark.skipif(importlib.util.find_spec("snip_worker.render") is None, reason="render aún no existe")
def test_render_api():
    from snip_worker.render import probe, extract_frame, make_preview, render_clip  # noqa: F401
