from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import os
import re
import struct
import tempfile
import zlib
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


_MAX_PNG_BYTES = 1_500_000
_MAX_IMAGE_DIMENSION = 4096
_RECORDING_RE = re.compile(r"iq_\d{8}-\d{6}_\d+Hz_\d+sps\.cu8\Z")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class CaptureSessionError(ValueError):
    pass


class CaptureSessionConflict(CaptureSessionError):
    pass


class DopplerSample(BaseModel):
    elapsed_s: float = Field(ge=0, le=259200)
    offset_hz: float | None = Field(default=None, ge=-18000, le=18000)
    locked: bool

    @model_validator(mode="after")
    def validate_lock(self) -> DopplerSample:
        if not math.isfinite(self.elapsed_s):
            raise ValueError("elapsed_s must be finite")
        if self.offset_hz is not None and not math.isfinite(self.offset_hz):
            raise ValueError("offset_hz must be finite")
        if self.locked and self.offset_hz is None:
            raise ValueError("a locked Doppler sample needs an offset")
        return self


class ReceptionSessionRequest(BaseModel):
    recording_name: str = Field(min_length=1, max_length=128)
    started_at: datetime
    ended_at: datetime
    center_freq_hz: int = Field(gt=0, le=2_000_000_000)
    tuned_freq_hz: int = Field(gt=0, le=2_000_000_000)
    sample_rate_sps: int = Field(gt=0, le=10_000_000)
    bandwidth_hz: int = Field(gt=0, le=500_000)
    demod: Literal["nfm", "wfm", "am", "usb", "lsb", "cw"]
    gain_db: float | Literal["auto"] | None = None
    sstv_mode: str | None = Field(default=None, max_length=32)
    dropped_blocks: int = Field(ge=0)
    lost_pct: float = Field(ge=0, le=100)
    doppler_samples: list[DopplerSample] = Field(default_factory=list, max_length=7200)
    image_data_url: str | None = Field(default=None, max_length=2_100_000)

    @model_validator(mode="after")
    def validate_capture(self) -> ReceptionSessionRequest:
        if self.started_at.utcoffset() is None or self.ended_at.utcoffset() is None:
            raise ValueError("capture timestamps must include a timezone")
        if self.ended_at < self.started_at:
            raise ValueError("ended_at must not precede started_at")
        duration = (self.ended_at - self.started_at).total_seconds()
        previous = -1.0
        for sample in self.doppler_samples:
            if sample.elapsed_s <= previous:
                raise ValueError("Doppler sample times must increase")
            if sample.elapsed_s > duration + 2.0:
                raise ValueError("Doppler sample exceeds capture duration")
            previous = sample.elapsed_s
        if not math.isfinite(self.lost_pct):
            raise ValueError("lost_pct must be finite")
        if isinstance(self.gain_db, float) and not math.isfinite(self.gain_db):
            raise ValueError("gain_db must be finite")
        return self


class ReceptionSessionV1(BaseModel):
    schema_version: Literal[1] = 1
    id: str
    recording_name: str
    recording_size_bytes: int = Field(ge=0)
    started_at: datetime
    ended_at: datetime
    center_freq_hz: int
    tuned_freq_hz: int
    sample_rate_sps: int
    bandwidth_hz: int
    demod: Literal["nfm", "wfm", "am", "usb", "lsb", "cw"]
    gain_db: float | Literal["auto"] | None
    sstv_mode: str | None
    dropped_blocks: int
    lost_pct: float
    doppler_samples: list[DopplerSample]
    image_name: str | None
    request_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def _recording_path(recordings_dir: Path, name: str) -> Path:
    if (not _RECORDING_RE.fullmatch(name) or Path(name).name != name
            or "/" in name or "\\" in name):
        raise CaptureSessionError("recording_name must be a listed IQ recording")
    root = recordings_dir.resolve()
    candidate = recordings_dir / name
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise CaptureSessionError("recording does not exist") from exc
    if resolved.parent != root or not resolved.is_file():
        raise CaptureSessionError("recording does not exist")
    return resolved


def _decode_png(data_url: str | None) -> bytes | None:
    if data_url is None:
        return None
    prefix, separator, encoded = data_url.partition(",")
    if prefix != "data:image/png;base64" or not separator:
        raise CaptureSessionError("image must be a PNG data URL")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CaptureSessionError("image is not valid base64") from exc
    if len(data) > _MAX_PNG_BYTES or not data.startswith(_PNG_SIGNATURE):
        raise CaptureSessionError("image is not a supported PNG")

    pos = len(_PNG_SIGNATURE)
    saw_ihdr = False
    saw_idat = False
    saw_iend = False
    while pos + 12 <= len(data):
        length = struct.unpack_from(">I", data, pos)[0]
        if length > _MAX_PNG_BYTES or pos + 12 + length > len(data):
            raise CaptureSessionError("PNG chunk is truncated or too large")
        kind = data[pos + 4:pos + 8]
        payload_end = pos + 8 + length
        payload = data[pos + 8:payload_end]
        expected_crc = struct.unpack_from(">I", data, payload_end)[0]
        if (zlib.crc32(kind + payload) & 0xFFFFFFFF) != expected_crc:
            raise CaptureSessionError("PNG checksum does not match")
        if not saw_ihdr:
            if kind != b"IHDR" or length != 13:
                raise CaptureSessionError("PNG is missing its image header")
            width, height = struct.unpack_from(">II", payload)
            if not (0 < width <= _MAX_IMAGE_DIMENSION and 0 < height <= _MAX_IMAGE_DIMENSION):
                raise CaptureSessionError("PNG dimensions are outside the supported range")
            saw_ihdr = True
        elif kind == b"IHDR":
            raise CaptureSessionError("PNG contains multiple image headers")
        if kind == b"IDAT":
            saw_idat = True
        pos = payload_end + 4
        if kind == b"IEND":
            if length != 0 or pos != len(data):
                raise CaptureSessionError("PNG has an invalid end chunk")
            saw_iend = True
            break
    if not (saw_ihdr and saw_idat and saw_iend):
        raise CaptureSessionError("PNG is incomplete")
    return data


def _atomic_write(path: Path, content: bytes) -> None:
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def save_session(recordings_dir: Path, request: ReceptionSessionRequest) -> dict:
    recording = _recording_path(recordings_dir, request.recording_name)
    image_bytes = _decode_png(request.image_data_url)
    request_data = request.model_dump(mode="json", exclude={"image_data_url"})
    digest = hashlib.sha256(
        json.dumps(request_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        + b"\0" + (image_bytes or b"")
    ).hexdigest()
    session_id = recording.stem
    manifest_path = recordings_dir / f"{session_id}.session.json"
    image_name = f"{session_id}.sstv.png" if image_bytes is not None else None
    image_path = recordings_dir / image_name if image_name is not None else None

    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CaptureSessionError("existing session metadata is unreadable") from exc
        if existing.get("request_sha256") != digest:
            raise CaptureSessionConflict("a different review session already exists for this recording")
        if image_bytes is not None and image_path is not None and not image_path.exists():
            _atomic_write(image_path, image_bytes)
        return ReceptionSessionV1.model_validate(existing).model_dump(mode="json")

    if image_bytes is not None and image_path is not None:
        _atomic_write(image_path, image_bytes)
    session = ReceptionSessionV1(
        id=session_id,
        recording_name=recording.name,
        recording_size_bytes=recording.stat().st_size,
        started_at=request.started_at,
        ended_at=request.ended_at,
        center_freq_hz=request.center_freq_hz,
        tuned_freq_hz=request.tuned_freq_hz,
        sample_rate_sps=request.sample_rate_sps,
        bandwidth_hz=request.bandwidth_hz,
        demod=request.demod,
        gain_db=request.gain_db,
        sstv_mode=request.sstv_mode,
        dropped_blocks=request.dropped_blocks,
        lost_pct=request.lost_pct,
        doppler_samples=request.doppler_samples,
        image_name=image_name,
        request_sha256=digest,
    )
    _atomic_write(
        manifest_path,
        (json.dumps(session.model_dump(mode="json"), sort_keys=True, indent=2) + "\n").encode("utf-8"),
    )
    return session.model_dump(mode="json")


def list_sessions(recordings_dir: Path) -> list[dict]:
    sessions = []
    for manifest_path in recordings_dir.glob("*.session.json"):
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            session = ReceptionSessionV1.model_validate(payload)
            recording = _recording_path(recordings_dir, session.recording_name)
            if session.id != recording.stem or manifest_path.name != f"{session.id}.session.json":
                continue
            if session.image_name not in (None, f"{session.id}.sstv.png"):
                continue
            if session.image_name is not None and not (recordings_dir / session.image_name).is_file():
                continue
            sessions.append(session.model_dump(mode="json"))
        except (OSError, json.JSONDecodeError, ValueError):
            continue
    return sorted(sessions, key=lambda item: item["ended_at"], reverse=True)
