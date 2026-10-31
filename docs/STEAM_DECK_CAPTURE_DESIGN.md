# Steam Deck SSTV capture and review design

## Problem

The Steam Deck profile already opens SSTV at an ISS preset, and the backend already follows carrier drift digitally inside the configured channel. What is missing is a Deck-sized path that controls capture/replay/decoding in one place and saves the received IQ, decoded image, measured Doppler trace, and reception settings as one reviewable session. Do not add a pass planner or orbital prediction. Do not retune the RTL-SDR hardware during a capture: the raw `.cu8` recording has one center-frequency header, while the existing `FmTracker` already follows drift in baseband.

## Usage

1. Open the Steam Deck ISS profile. Select an ISS channel in the SSTV panel or enter its frequency in the live toolbar. Adjust gain in the toolbar.
2. Tap **Capture review** in the Recording panel. The app records raw IQ while SSTV decoding and carrier tracking continue.
3. Tap **Stop & save** after reception. The app stores a review record with the IQ filename, an optional decoded PNG, tuned and center frequencies, bandwidth, sample rate, gain, loss counters, timestamps, and measured carrier-offset samples.
4. Tap **Replay latest** to open the newest review. In Replay mode, each review also shows its carrier trace, reception details, image preview, downloads, and a **Replay IQ** action.

Ordinary IQ recording remains available. The default desktop launch profile remains unchanged. The pass planner and orbital Doppler prediction remain out of scope.

## Shape

Keep the existing `DeviceManager.record_start/record_stop` as the sole IQ writer. The browser owns only a transient `CaptureDraft` while a session is recording; it samples the already-published `radio_level.afc` state at most once per second. On stop, it sends one validated request to the backend. The backend verifies the named `.cu8` file against the recordings directory, writes a PNG sidecar if present, then atomically writes a JSON sidecar as the commit marker. Sidecars share the recording stem, so existing replay and download paths remain valid without copying multi-gigabyte IQ data.

Domain record:

```text
ReceptionSessionV1 {
  id: recording stem
  recording_name: listed .cu8 basename
  started_at, ended_at: UTC timestamps
  center_freq_hz, tuned_freq_hz, sample_rate_sps, bandwidth_hz
  demod, gain_db: number | "auto" | null
  sstv_mode: string | null
  dropped_blocks, lost_pct
  doppler_samples: [{elapsed_s, offset_hz: number | null, locked}]
  image_name: sidecar PNG basename | null
}
```

The API surface is `POST /api/sessions` to finalize, `GET /api/sessions` to list completed sessions, and the existing static recordings mount for the IQ, PNG, and JSON sidecars. The backend owns validation, path selection, atomic writes, and idempotency; the frontend never supplies a filesystem path. Existing recording deletion removes its sidecars too.

Deck controls reuse the existing frequency and gain state. The live toolbar keeps tuning, gain, and SSTV decode close to the display. Capture and replay actions sit in the Recording panel so they do not take room from the waterfall and image on short screens. Tune steps, the channel selector, and the capture/replay actions use 48 CSS-pixel touch targets in the Steam Deck profile.

## Alternatives considered

- Backend-owned active-session state could survive a browser reload, but would add a second recording lifecycle beside `DeviceManager` and require shared-state recovery. Rejected for this local single-user workflow; a browser interruption still leaves the raw IQ file recoverable.
- Copying or zipping each `.cu8` into a session directory would make a literal folder bundle but can duplicate gigabytes. Rejected; stem-matched sidecars create one review object without copying the recording.
- A gamepad-only control map would depend on Steam Input and physical Deck behavior not available in this environment. Rejected; touch-first toolbar controls are testable in Chromium and remain usable with the Deck touchscreen.

## Tradeoffs accepted

- A page reload during recording can lose the in-memory Doppler trace and automatic session finalization, but the IQ recording remains on disk and can still be replayed.
- The Doppler trace is measured carrier offset, not a predicted orbit or an RF tuner retune timeline.
- Sessions without a decoded image remain valid and show the recording plus metadata.

## Verification contract

Backend tests must prove safe recording-name validation, PNG validation, atomic/idempotent session saving, sidecar listing/deletion, and preservation of the raw recording. Frontend tests must prove one-Hz tracking sampling, capture start/stop payload contents, session rendering/replay action, and touch target sizes. The full backend suite, frontend unit/build/browser suites, and PR CI must pass. Physical Deck, gamepad, USB, and live RF behavior remain unverified without the hardware.
