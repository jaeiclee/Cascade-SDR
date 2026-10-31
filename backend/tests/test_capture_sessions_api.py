import base64
import struct
import zlib

import app.main as main
from starlette.testclient import TestClient

from app.main import app


RECORDING_NAME = "iq_20261031-103000_437550000Hz_2400000sps.cu8"


def _png_data_url() -> str:
    def chunk(kind: bytes, data: bytes) -> bytes:
        payload = kind + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x12\x34\x56"))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _payload(recording_name: str = RECORDING_NAME, image_data_url: str | None = None) -> dict:
    return {
        "recording_name": recording_name,
        "started_at": "2026-10-31T01:30:00Z",
        "ended_at": "2026-10-31T01:32:00Z",
        "center_freq_hz": 438150000,
        "tuned_freq_hz": 437550000,
        "sample_rate_sps": 2400000,
        "bandwidth_hz": 36000,
        "demod": "nfm",
        "gain_db": "auto",
        "sstv_mode": "Robot 36",
        "dropped_blocks": 0,
        "lost_pct": 0.0,
        "doppler_samples": [
            {"elapsed_s": 0.0, "offset_hz": None, "locked": False},
            {"elapsed_s": 1.0, "offset_hz": -100.0, "locked": True},
        ],
        "image_data_url": image_data_url,
    }


def test_session_api_creates_lists_and_deletes_review_with_recording(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "RECORDINGS_DIR", tmp_path)
    recordings_mount = next(route for route in app.routes if getattr(route, "name", None) == "recordings")
    recordings_app = getattr(recordings_mount, "app")
    monkeypatch.setattr(recordings_app, "directory", str(tmp_path))
    monkeypatch.setattr(recordings_app, "all_directories", [str(tmp_path)])
    recording = tmp_path / RECORDING_NAME
    recording.write_bytes(b"raw IQ")

    with TestClient(app) as client:
        created = client.post("/api/sessions", json=_payload(image_data_url=_png_data_url()))
        assert created.status_code == 200
        session = created.json()["session"]
        assert session["recording_name"] == RECORDING_NAME
        assert session["image_name"] == recording.stem + ".sstv.png"
        assert (tmp_path / session["image_name"]).is_file()
        assert client.get("/api/sessions").json()["sessions"] == [session]
        assert client.get(f"/recordings/{RECORDING_NAME}").content == b"raw IQ"
        image_response = client.get(f"/recordings/{session['image_name']}")
        assert image_response.status_code == 200
        assert image_response.headers["content-type"].startswith("image/png")
        assert image_response.content.startswith(bytes.fromhex("89504e470d0a1a0a"))
        metadata_response = client.get(f"/recordings/{recording.stem}.session.json")
        assert metadata_response.status_code == 200
        assert metadata_response.json()["recording_name"] == RECORDING_NAME
        assert client.delete(f"/api/recordings/{RECORDING_NAME}").status_code == 200

    assert not recording.exists()
    assert not (tmp_path / (recording.stem + ".session.json")).exists()
    assert not (tmp_path / (recording.stem + ".sstv.png")).exists()


def test_session_api_rejects_nonlisted_recording_names(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "RECORDINGS_DIR", tmp_path)

    with TestClient(app) as client:
        response = client.post("/api/sessions", json=_payload("../outside.cu8"))

    assert response.status_code == 400
    assert not (tmp_path.parent / "outside.cu8").exists()


def test_session_api_returns_conflict_for_different_review_payload(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "RECORDINGS_DIR", tmp_path)
    (tmp_path / RECORDING_NAME).write_bytes(b"raw IQ")

    with TestClient(app) as client:
        first = client.post("/api/sessions", json=_payload())
        changed = _payload()
        changed["dropped_blocks"] = 1
        second = client.post("/api/sessions", json=changed)

    assert first.status_code == 200
    assert second.status_code == 409
