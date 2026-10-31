from types import SimpleNamespace

import pytest
from starlette.testclient import TestClient

import app.device as device
import app.main as main
from app.device import DeviceManager
from app.hub import Hub


class RunningDevice(DeviceManager):
    @property
    def running(self):
        return True


@pytest.mark.parametrize("command", [
    {"cmd": "set_mode", "mode": "idle"},
    {"cmd": "stop"},
    {"cmd": "tune", "center_freq": 101_000_000, "gain": 20},
    {"cmd": "tune", "sample_rate": 1_024_000},
    {"cmd": "tune", "converter_on": True},
    {"cmd": "tune", "converter_hz": 100_000_000},
    {"cmd": "tune", "direct_sampling": True},
])
def test_recording_refuses_disruptive_commands_and_preserves_iq(tmp_path, monkeypatch, command):
    hub = Hub()
    manager = RunningDevice(hub)
    manager.mode_name = "spectrum"
    manager.mode = SimpleNamespace(owns_device=True, controls_tuning=False, snapshot=lambda: [])
    monkeypatch.setattr(main, "hub", hub)
    monkeypatch.setattr(main, "manager", manager)
    monkeypatch.setattr(device, "RECORDINGS_DIR", tmp_path)
    with TestClient(main.app) as client, client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "status"
        ws.send_json({"cmd": "record", "action": "start"})
        started = ws.receive_json()
        assert started["recording"] is True
        manager._write_iq(b"\x01\x02")
        ws.send_json(command)
        response = ws.receive_json()
        assert response["type"] == "error"
        assert "record" in response["message"].lower()
        assert manager.recording
        assert manager.mode_name == "spectrum"
        assert manager.center_freq == 100_000_000
        assert manager.sample_rate == 2_400_000
        assert manager.gain == "auto"
        ws.send_json({"cmd": "record", "action": "stop"})
        stopped = ws.receive_json()
        assert stopped["stopped"] == started["name"]
        assert (tmp_path / stopped["stopped"]).read_bytes() == b"\x01\x02"


def test_gain_change_and_explicit_stop_remain_available_during_recording(tmp_path, monkeypatch):
    hub = Hub()
    manager = RunningDevice(hub)
    manager.mode_name = "spectrum"
    manager.mode = SimpleNamespace(owns_device=True, controls_tuning=False, snapshot=lambda: [])
    monkeypatch.setattr(main, "hub", hub)
    monkeypatch.setattr(main, "manager", manager)
    monkeypatch.setattr(device, "RECORDINGS_DIR", tmp_path)
    with TestClient(main.app) as client, client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"cmd": "record", "action": "start"})
        assert ws.receive_json()["recording"]
        ws.send_json({"cmd": "tune", "gain": 20})
        assert ws.receive_json()["gain"] == 20
        ws.send_json({"cmd": "record", "action": "stop"})
        assert ws.receive_json()["recording"] is False
