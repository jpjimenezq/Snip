"""Pruebas de la fase 4 con HTTP simulado (httpx.MockTransport) y una BD falsa."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from snip_worker import publish
from snip_worker.platforms import common, facebook, instagram, tiktok, youtube
from snip_worker.platforms.common import AuthExpired, PublishContext, PublishError


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(common, "sleep", lambda s: None)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "gid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "gsec")
    monkeypatch.setenv("TIKTOK_CLIENT_KEY", "tk")
    monkeypatch.setenv("TIKTOK_CLIENT_SECRET", "tsec")


def make_ctx(tmp_path: Path, handler, *, size=1000, platform="youtube", pub=None, clip=None,
             tokens=None, duration=30.0) -> PublishContext:
    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * size)
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return PublishContext(
        http=http,
        pub={"id": "p1", "platform": platform, "privacy": "public", "title": "Mi título",
             "caption": "Descripción #cosas", **(pub or {})},
        clip={"id": "c1", "start_s": 0, "end_s": duration, "title": "T", "copies": {"youtube": {"tags": ["#a", "b"]}},
              **(clip or {})},
        account={"id": "a1", "platform": platform, "external_id": "ext1"},
        tokens=tokens or {"access_token": "AT", "refresh_token": "RT", "extra": {}},
        video_path=video, duration_s=duration, signed_url=lambda: "https://signed/video.mp4",
    )


# ---------------------------------------------------------------- tokens
def test_google_refresh_and_persist(monkeypatch):
    seen = {}

    def handler(req: httpx.Request):
        seen["body"] = req.content.decode()
        return httpx.Response(200, json={"access_token": "NEW", "expires_in": 3600})

    updates = []

    class T:
        def update(self, f):
            updates.append(f)
            return self
        def eq(self, *a):
            return self
        def execute(self):
            return None

    class C:
        def table(self, name):
            assert name == "social_tokens"
            return T()

    monkeypatch.setattr(publish.db, "client", lambda: C())
    http = httpx.Client(transport=httpx.MockTransport(handler))
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    tokens = {"access_token": "OLD", "refresh_token": "RT", "expires_at": past}
    out = publish.ensure_fresh_token(http, {"id": "a1", "platform": "youtube"}, tokens)
    assert out["access_token"] == "NEW" and out["refresh_token"] == "RT"
    assert "grant_type=refresh_token" in seen["body"] and "client_secret=gsec" in seen["body"]
    assert updates and updates[0]["access_token"] == "NEW"


def test_valid_token_not_refreshed():
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    t = {"access_token": "A", "expires_at": future}
    assert publish.ensure_fresh_token(None, {"id": "a", "platform": "youtube"}, t) is t


def test_google_refresh_invalid_grant_is_auth_expired():
    http = httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"error": "invalid_grant", "error_description": "revoked"})))
    with pytest.raises(AuthExpired):
        youtube.refresh(http, {"refresh_token": "RT"})


def test_tiktok_refresh_rotates_refresh_token(monkeypatch):
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(
        200, json={"access_token": "N", "refresh_token": "R2", "expires_in": 86400})))
    assert tiktok.refresh(http, {"refresh_token": "R"})["refresh_token"] == "R2"


def test_meta_expired_token_requires_reconnect():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with pytest.raises(AuthExpired) as e:
        publish.ensure_fresh_token(None, {"id": "a", "platform": "facebook"}, {"access_token": "x", "expires_at": past})
    assert "Reconecta" in str(e.value)


# ---------------------------------------------------------------- YouTube
def test_youtube_resumable_chunking(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube, "CHUNK", 256 * 1024)
    size = 600 * 1024  # 3 trozos: 256K, 256K, 88K
    calls = []

    def handler(req: httpx.Request):
        if req.method == "POST":
            body = json.loads(req.content)
            calls.append(("init", body))
            assert req.headers["x-upload-content-length"] == str(size)
            return httpx.Response(200, headers={"location": "https://upload.example/session"})
        cr = req.headers["content-range"]
        calls.append(("put", cr))
        end = int(cr.split("-")[1].split("/")[0])
        if end + 1 < size:
            return httpx.Response(308, headers={"range": f"bytes=0-{end}"})
        return httpx.Response(200, json={"id": "VID123"})

    ctx = make_ctx(tmp_path, handler, size=size)
    res = youtube.publish(ctx)
    assert res.external_id == "VID123" and res.external_url == "https://youtube.com/shorts/VID123"
    puts = [c[1] for c in calls if c[0] == "put"]
    assert puts == [f"bytes 0-{256*1024-1}/{size}", f"bytes {256*1024}-{512*1024-1}/{size}", f"bytes {512*1024}-{size-1}/{size}"]
    snippet = calls[0][1]["snippet"]
    assert snippet["title"].endswith("#shorts") and snippet["categoryId"] == "22"
    assert snippet["tags"] == ["a", "b"]
    assert calls[0][1]["status"] == {"privacyStatus": "public", "selfDeclaredMadeForKids": False}


def test_youtube_title_limits(tmp_path):
    ctx = make_ctx(tmp_path, lambda r: httpx.Response(200), pub={"title": "x" * 150}, duration=30)
    t = youtube.build_title(ctx)
    assert len(t) <= 100 and t.endswith("#shorts")
    long_ctx = make_ctx(tmp_path, lambda r: httpx.Response(200), pub={"title": "Largo"}, duration=120)
    assert youtube.build_title(long_ctx) == "Largo"


def test_youtube_retries_5xx_by_querying_offset(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube, "CHUNK", 256 * 1024)
    size = 300 * 1024
    state = {"n": 0}

    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, headers={"location": "https://u/s"})
        cr = req.headers["content-range"]
        if cr.startswith("bytes */"):
            return httpx.Response(308)  # sin Range: nada recibido
        state["n"] += 1
        if state["n"] == 1:
            return httpx.Response(503)
        end = int(cr.split("-")[1].split("/")[0])
        return httpx.Response(308, headers={"range": f"bytes=0-{end}"}) if end + 1 < size else httpx.Response(200, json={"id": "V"})

    assert youtube.publish(make_ctx(tmp_path, handler, size=size)).external_id == "V"


def test_youtube_quota_message(tmp_path):
    def handler(req):
        return httpx.Response(403, json={"error": {"message": "x", "errors": [{"reason": "quotaExceeded"}]}})
    with pytest.raises(PublishError) as e:
        youtube.publish(make_ctx(tmp_path, handler))
    assert "cuota" in str(e.value)


# ---------------------------------------------------------------- TikTok
def tiktok_handler(log, direct_error=None, final_status="PUBLISH_COMPLETE"):
    def handler(req: httpx.Request):
        path = req.url.path
        log.append(path)
        if path.endswith("creator_info/query/"):
            return httpx.Response(200, json={"data": {"privacy_level_options": ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
                                                      "max_video_post_duration_sec": 600}, "error": {"code": "ok"}})
        if path.endswith("/video/init/") and "inbox" not in path:
            if direct_error:
                return httpx.Response(403, json={"error": {"code": direct_error, "message": "nope"}})
            return httpx.Response(200, json={"data": {"publish_id": "PID", "upload_url": "https://up.tt/u"}, "error": {"code": "ok"}})
        if "inbox/video/init" in path:
            return httpx.Response(200, json={"data": {"publish_id": "PID", "upload_url": "https://up.tt/u"}, "error": {"code": "ok"}})
        if req.url.host == "up.tt":
            log.append(req.headers["content-range"])
            return httpx.Response(201)
        if path.endswith("status/fetch/"):
            data = {"status": final_status}
            if final_status == "PUBLISH_COMPLETE":
                data["publicaly_available_post_id"] = [7777]
            return httpx.Response(200, json={"data": data, "error": {"code": "ok"}})
        return httpx.Response(404)
    return handler


def test_tiktok_direct_post(tmp_path):
    log = []
    res = tiktok.publish(make_ctx(tmp_path, tiktok_handler(log), platform="tiktok", size=2000))
    assert res.external_id == "7777" and res.note is None
    assert "/v2/post/publish/video/init/" in log and not any("inbox" in p for p in log)
    assert "bytes 0-1999/2000" in log


def test_tiktok_falls_back_to_inbox(tmp_path):
    log = []
    h = tiktok_handler(log, direct_error="unaudited_client_can_only_post_to_private_accounts", final_status="SEND_TO_USER_INBOX")
    res = tiktok.publish(make_ctx(tmp_path, h, platform="tiktok", size=2000))
    assert any("inbox/video/init" in p for p in log)
    assert res.note == "Enviado a tu bandeja de TikTok para terminar de publicar"
    assert res.external_id == "PID"


def test_tiktok_other_errors_do_not_fall_back(tmp_path):
    log = []
    h = tiktok_handler(log, direct_error="rate_limit_exceeded")
    with pytest.raises(PublishError):
        tiktok.publish(make_ctx(tmp_path, h, platform="tiktok", size=2000))
    assert not any("inbox" in p for p in log)


def test_tiktok_chunk_plan():
    assert tiktok._plan_chunks(1_000_000) == (1_000_000, 1)
    cs, n = tiktok._plan_chunks(25 * 1024 * 1024)
    assert cs == tiktok.CHUNK and n == 2  # el último trozo absorbe el resto


# ---------------------------------------------------------------- Instagram
def test_instagram_container_polling(tmp_path):
    statuses = iter(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"])
    posted = []

    def handler(req: httpx.Request):
        path = req.url.path
        if req.method == "POST" and path.endswith("/media"):
            form = dict(httpx.QueryParams(req.content.decode()))
            posted.append(form)
            return httpx.Response(200, json={"id": "CONT"})
        if path.endswith("/CONT"):
            return httpx.Response(200, json={"status_code": next(statuses)})
        if path.endswith("/media_publish"):
            return httpx.Response(200, json={"id": "MEDIA"})
        if path.endswith("/MEDIA"):
            return httpx.Response(200, json={"permalink": "https://instagram.com/reel/abc/"})
        return httpx.Response(404)

    ctx = make_ctx(tmp_path, handler, platform="instagram",
                   tokens={"access_token": "PT", "extra": {"ig_user_id": "IG1", "page_access_token": "PT"}})
    res = instagram.publish(ctx)
    assert res.external_id == "MEDIA" and res.external_url == "https://instagram.com/reel/abc/"
    assert posted[0]["media_type"] == "REELS" and posted[0]["video_url"] == "https://signed/video.mp4"


def test_instagram_container_error(tmp_path):
    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, json={"id": "CONT"})
        return httpx.Response(200, json={"status_code": "ERROR", "status": "bad codec"})
    ctx = make_ctx(tmp_path, handler, platform="instagram", tokens={"access_token": "t", "extra": {"ig_user_id": "I"}})
    with pytest.raises(PublishError):
        instagram.publish(ctx)


def test_instagram_token_error_is_auth_expired(tmp_path):
    h = lambda r: httpx.Response(400, json={"error": {"message": "Error validating access token: Session has expired", "code": 190}})
    ctx = make_ctx(tmp_path, h, platform="instagram", tokens={"access_token": "t", "extra": {"ig_user_id": "I"}})
    with pytest.raises(AuthExpired):
        instagram.publish(ctx)


def test_instagram_rejects_private(tmp_path):
    ctx = make_ctx(tmp_path, lambda r: httpx.Response(500), platform="instagram", pub={"privacy": "private"})
    with pytest.raises(PublishError):
        instagram.publish(ctx)


# ---------------------------------------------------------------- Facebook
def test_facebook_reel_flow(tmp_path):
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.method, req.url.host, req.url.path))
        if req.url.host == "rupload.facebook.com":
            assert req.headers["authorization"] == "OAuth PT" and req.headers["file_size"] == "1000"
            return httpx.Response(200, json={"success": True})
        if req.method == "POST" and req.url.path.endswith("/video_reels"):
            form = dict(httpx.QueryParams(req.content.decode()))
            if form["upload_phase"] == "start":
                return httpx.Response(200, json={"video_id": "V1", "upload_url": "https://rupload.facebook.com/video-upload/v23.0/V1"})
            assert form["upload_phase"] == "finish" and form["video_state"] == "PUBLISHED"
            return httpx.Response(200, json={"success": True})
        if req.url.path.endswith("/V1"):
            return httpx.Response(200, json={"status": {"video_status": "ready"}, "permalink_url": "/reel/V1"})
        return httpx.Response(404)

    ctx = make_ctx(tmp_path, handler, platform="facebook", tokens={"access_token": "U", "extra": {"page_access_token": "PT"}})
    res = facebook.publish(ctx)
    assert res.external_id == "V1" and res.external_url == "https://www.facebook.com/reel/V1"


def test_facebook_falls_back_to_videos(tmp_path):
    def handler(req: httpx.Request):
        if req.url.path.endswith("/video_reels"):
            return httpx.Response(400, json={"error": {"message": "reels not allowed"}})
        if req.url.path.endswith("/ext1/videos"):
            assert "file_url=https" in req.content.decode()
            return httpx.Response(200, json={"id": "FV"})
        if req.url.path.endswith("/FV"):
            return httpx.Response(200, json={"permalink_url": "/page/videos/FV"})
        return httpx.Response(404)

    ctx = make_ctx(tmp_path, handler, platform="facebook", tokens={"access_token": "U", "extra": {"page_access_token": "PT"}})
    res = facebook.publish(ctx)
    assert res.external_id == "FV" and res.external_url.endswith("/page/videos/FV")


# ---------------------------------------------------------------- job: aislamiento de errores
class FakeDB:
    def __init__(self):
        self.tables = {
            "publications": [
                {"id": "p1", "clip_id": "c1", "account_id": "a1", "platform": "youtube", "privacy": "public", "caption": "x"},
                {"id": "p2", "clip_id": "c1", "account_id": "a2", "platform": "facebook", "privacy": "public", "caption": "y"},
            ],
            "social_accounts": [{"id": "a1", "platform": "youtube", "external_id": "e1"},
                                {"id": "a2", "platform": "facebook", "external_id": "e2"}],
            "social_tokens": [{"account_id": "a1", "access_token": "t"}, {"account_id": "a2", "access_token": "t"}],
        }

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.upd, self.mode = db, name, [], None, "select"

    def select(self, *_):
        return self
    def update(self, fields):
        self.mode, self.upd = "update", fields
        return self
    def eq(self, col, val):
        self.filters.append((col, [val]))
        return self
    def in_(self, col, vals):
        self.filters.append((col, list(vals)))
        return self
    def limit(self, _):
        return self
    def execute(self):
        rows = [r for r in self.db.tables[self.name] if all(r.get(c) in v for c, v in self.filters)]
        if self.mode == "update":
            for r in rows:
                r.update(self.upd)
        return type("R", (), {"data": rows})()


def _setup_job(monkeypatch, tmp_path, publishers):
    fake = FakeDB()
    monkeypatch.setattr(publish.db, "client", lambda: fake)
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    clip = {"id": "c1", "start_s": 0, "end_s": 20}
    monkeypatch.setattr(publish, "ensure_video", lambda cid: (clip, video))
    monkeypatch.setattr(publish, "PUBLISHERS", publishers)
    monkeypatch.setattr(publish, "new_http", lambda: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    return fake


def test_one_failure_does_not_stop_others(monkeypatch, tmp_path):
    def boom(ctx):
        raise PublishError("Facebook rechazó el video")

    fake = _setup_job(monkeypatch, tmp_path, {
        "youtube": lambda ctx: common.PublishResult("YV", "https://youtube.com/shorts/YV"), "facebook": boom})
    publish.publish_clip({"payload": {"publication_ids": ["p1", "p2"]}})  # no lanza: una tuvo éxito
    pubs = {p["id"]: p for p in fake.tables["publications"]}
    assert pubs["p1"]["status"] == "published" and pubs["p1"]["external_url"].endswith("YV")
    assert pubs["p2"]["status"] == "error" and "rechazó" in pubs["p2"]["error"]


def test_job_fails_only_if_all_fail(monkeypatch, tmp_path):
    def expired(ctx):
        raise AuthExpired("token muerto")

    fake = _setup_job(monkeypatch, tmp_path, {"youtube": expired, "facebook": expired})
    with pytest.raises(RuntimeError) as e:
        publish.publish_clip({"payload": {"publication_ids": ["p1", "p2"]}})
    assert "youtube" in str(e.value) and "facebook" in str(e.value)
    assert all(a["status"] == "expired" for a in fake.tables["social_accounts"])
    assert all(p["status"] == "error" for p in fake.tables["publications"])


def test_render_failure_marks_all_publications(monkeypatch, tmp_path):
    fake = _setup_job(monkeypatch, tmp_path, {})
    monkeypatch.setattr(publish, "ensure_video", lambda cid: (_ for _ in ()).throw(RuntimeError("sin video fuente")))
    with pytest.raises(RuntimeError):
        publish.publish_clip({"payload": {"publication_ids": ["p1", "p2"]}})
    assert all("sin video fuente" in p["error"] for p in fake.tables["publications"])


def test_handlers_registered():
    assert "publish_clip" in publish.HANDLERS
