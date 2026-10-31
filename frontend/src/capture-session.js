export const CAPTURE_SAMPLE_INTERVAL_MS = 1_000;
export const CAPTURE_SAMPLE_LIMIT = 7_200;

export function createCaptureDraft(metadata, startedAt = new Date(), monotonicStartMs = performance.now()) {
  return {
    metadata: { ...metadata },
    started_at: startedAt.toISOString(),
    monotonic_start_ms: monotonicStartMs,
    last_sample_ms: null,
    doppler_samples: [],
  };
}

export function addDopplerSample(draft, afc, monotonicNowMs) {
  if (!draft || draft.doppler_samples.length >= CAPTURE_SAMPLE_LIMIT) return draft;
  if (draft.last_sample_ms !== null && monotonicNowMs - draft.last_sample_ms < CAPTURE_SAMPLE_INTERVAL_MS) {
    return draft;
  }
  const elapsed = Math.max(0, (monotonicNowMs - draft.monotonic_start_ms) / 1_000);
  const locked = Boolean(afc?.lock && Number.isFinite(afc.hz));
  return {
    ...draft,
    last_sample_ms: monotonicNowMs,
    doppler_samples: [
      ...draft.doppler_samples,
      {
        elapsed_s: Math.round(elapsed * 10) / 10,
        offset_hz: locked ? afc.hz : null,
        locked,
      },
    ],
  };
}

export function finalizeCaptureDraft(draft, recording, endedAt = new Date(), imageDataUrl = null) {
  if (!draft) throw new TypeError("capture draft is required");
  return {
    ...draft.metadata,
    recording_name: recording.name,
    started_at: draft.started_at,
    ended_at: endedAt.toISOString(),
    dropped_blocks: recording.dropped ?? 0,
    lost_pct: recording.lost_pct ?? 0,
    doppler_samples: draft.doppler_samples.map((sample) => ({ ...sample })),
    image_data_url: imageDataUrl,
  };
}
