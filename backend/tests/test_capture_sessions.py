from __future__ import annotations

import base64
import json
import struct
import zlib
from datetime import datetime, timezone

import pytest

from app.capture_sessions import (
    CaptureSessionConflict,
    CaptureSessionError,
    ReceptionSessionRequest,
    list_sessions,
    save_session,
)


def _png_data_url() -> str:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x12\x34\x56"))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _request(**overrides) -> ReceptionSessionRequest:
    body = {
        "recording_name": "iq_20261031-103000_437550000Hz_2400000sps.cu8",
        "started_at": "2026-10-31T01:30:00Z",
        "ended_at": "2026-10-31T01:32:00Z",
        "center_freq_hz": 438150000,
        "tuned_freq_hz": 437550000,
        "sample_rate_sps": 2400000,
        "bandwidth_hz": 36000,
        "demod": "nfm",
        "gain_db": "auto",
        "sstv_mode": "Robot 36",
        "dropped_blocks": 2,
        "lost_pct": 0.5,
        "doppler_samples": [
            {"elapsed_s": 0.0, "offset_hz": None, "locked": False},
            {"elapsed_s": 1.0, "offset_hz": -1240.5, "locked": True},
        ],
        "image_data_url": _png_data_url(),
    }
    body.update(overrides)
    return ReceptionSessionRequest.model_validate(body)


def test_save_session_keeps_iq_and_adds_image_and_metadata_sidecars(tmp_path) -> None:
    recording = tmp_path / "iq_20261031-103000_437550000Hz_2400000sps.cu8"
    recording.write_bytes(b"raw IQ")

    session = save_session(tmp_path, _request())

    assert session["recording_name"] == recording.name
    assert session["id"] == recording.stem
    assert session["image_name"] == recording.stem + ".sstv.png"
    assert session["doppler_samples"][1] == {
        "elapsed_s": 1.0,
        "offset_hz": -1240.5,
        "locked": True,
    }
    assert recording.read_bytes() == b"raw IQ"
    assert (tmp_path / session["image_name"]).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    saved = json.loads((tmp_path / (recording.stem + ".session.json")).read_text())
    assert saved["schema_version"] == 1
    assert saved["recording_name"] == recording.name
    assert saved["gain_db"] == "auto"


def test_save_session_is_idempotent_for_the_same_capture(tmp_path) -> None:
    recording = tmp_path / "iq_20261031-103000_437550000Hz_2400000sps.cu8"
    recording.write_bytes(b"raw IQ")
    request = _request()

    first = save_session(tmp_path, request)
    second = save_session(tmp_path, request)

    assert second == first
    assert len(list(tmp_path.glob("*.session.json"))) == 1


def test_save_session_rejects_different_payload_for_an_existing_capture(tmp_path) -> None:
    recording = tmp_path / "iq_20261031-103000_437550000Hz_2400000sps.cu8"
    recording.write_bytes(b"raw IQ")
    save_session(tmp_path, _request())

    with pytest.raises(CaptureSessionConflict):
        save_session(tmp_path, _request(dropped_blocks=3))


def test_save_session_rejects_unlisted_or_unsafe_recording_names(tmp_path) -> None:
    with pytest.raises(CaptureSessionError):
        save_session(tmp_path, _request(recording_name="../outside.cu8"))

    with pytest.raises(CaptureSessionError):
        save_session(tmp_path, _request(recording_name="iq_missing_437550000Hz_2400000sps.cu8"))


def test_save_session_rejects_invalid_png_before_writing_sidecars(tmp_path) -> None:
    recording = tmp_path / "iq_20261031-103000_437550000Hz_2400000sps.cu8"
    recording.write_bytes(b"raw IQ")

    with pytest.raises(CaptureSessionError):
        save_session(tmp_path, _request(image_data_url="data:image/png;base64,SGVsbG8="))

    assert not list(tmp_path.glob("*.session.json"))
    assert not list(tmp_path.glob("*.sstv.png"))


def test_session_without_decoded_image_is_listed_and_replayable(tmp_path) -> None:
    recording = tmp_path / "iq_20261031-103000_437550000Hz_2400000sps.cu8"
    recording.write_bytes(b"raw IQ")
    saved = save_session(tmp_path, _request(image_data_url=None))

    listed = list_sessions(tmp_path)

    assert len(listed) == 1
    assert listed[0]["id"] == saved["id"]
    assert listed[0]["recording_name"] == recording.name
    assert listed[0]["image_name"] is None


def test_request_rejects_nonmonotonic_or_out_of_range_doppler_samples() -> None:
    with pytest.raises(ValueError):
        _request(doppler_samples=[
            {"elapsed_s": 2.0, "offset_hz": 100.0, "locked": True},
            {"elapsed_s": 1.0, "offset_hz": 200.0, "locked": True},
        ])

    with pytest.raises(ValueError):
        _request(ended_at=datetime(2026, 10, 31, tzinfo=timezone.utc),
                 started_at=datetime(2026, 11, 1, tzinfo=timezone.utc))
