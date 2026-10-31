import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_SAMPLE_LIMIT,
  addDopplerSample,
  createCaptureDraft,
  finalizeCaptureDraft,
} from "../src/capture-session.js";

const metadata = {
  center_freq_hz: 438_150_000,
  tuned_freq_hz: 437_550_000,
  sample_rate_sps: 2_400_000,
  bandwidth_hz: 36_000,
  demod: "nfm",
  gain_db: "auto",
  sstv_mode: "Robot 36",
};

const startTime = new Date("2026-10-31T01:30:00.000Z");

test("capture draft stores at most one measured Doppler sample per second", () => {
  let draft = createCaptureDraft(metadata, startTime, 500);
  draft = addDopplerSample(draft, { lock: true, hz: -125.5 }, 500);
  const firstSample = draft;
  const sameDraft = addDopplerSample(draft, { lock: true, hz: -124 }, 1_499);
  assert.equal(sameDraft, firstSample);

  draft = addDopplerSample(draft, { lock: true, hz: -120 }, 1_500);
  draft = addDopplerSample(draft, null, 2_500);

  assert.deepEqual(draft.doppler_samples, [
    { elapsed_s: 0, offset_hz: -125.5, locked: true },
    { elapsed_s: 1, offset_hz: -120, locked: true },
    { elapsed_s: 2, offset_hz: null, locked: false },
  ]);
});

test("capture finalization creates the backend request without browser-only state", () => {
  let draft = createCaptureDraft(metadata, startTime, 0);
  draft = addDopplerSample(draft, { lock: true, hz: 55 }, 1_000);
  const payload = finalizeCaptureDraft(
    draft,
    { name: "iq_20261031-103000_437550000Hz_2400000sps.cu8", dropped: 2, lost_pct: 0.5 },
    new Date("2026-10-31T01:32:00.000Z"),
    "data:image/png;base64,abc",
  );

  assert.deepEqual(payload, {
    ...metadata,
    recording_name: "iq_20261031-103000_437550000Hz_2400000sps.cu8",
    started_at: "2026-10-31T01:30:00.000Z",
    ended_at: "2026-10-31T01:32:00.000Z",
    dropped_blocks: 2,
    lost_pct: 0.5,
    doppler_samples: [{ elapsed_s: 1, offset_hz: 55, locked: true }],
    image_data_url: "data:image/png;base64,abc",
  });
  assert.equal("monotonic_start_ms" in payload, false);
  assert.equal(CAPTURE_SAMPLE_LIMIT, 7_200);
});

test("capture draft caps the trace at the API sample limit", () => {
  let draft = createCaptureDraft(metadata, startTime, 0);
  for (let i = 0; i < CAPTURE_SAMPLE_LIMIT; i++) {
    draft = addDopplerSample(draft, null, i * 1_000);
  }
  const capped = addDopplerSample(draft, { lock: true, hz: 1 }, CAPTURE_SAMPLE_LIMIT * 1_000);

  assert.equal(capped.doppler_samples.length, CAPTURE_SAMPLE_LIMIT);
  assert.equal(capped, draft);
});
