export type CaptureMetadata = {
  center_freq_hz: number;
  tuned_freq_hz: number;
  sample_rate_sps: number;
  bandwidth_hz: number;
  demod: "nfm" | "wfm" | "am" | "usb" | "lsb" | "cw";
  gain_db: number | "auto" | null;
  sstv_mode: string | null;
};

export type DopplerSample = {
  elapsed_s: number;
  offset_hz: number | null;
  locked: boolean;
};

export type CaptureDraft = {
  metadata: CaptureMetadata;
  started_at: string;
  monotonic_start_ms: number;
  last_sample_ms: number | null;
  doppler_samples: DopplerSample[];
};

export type CapturePayload = CaptureMetadata & {
  recording_name: string;
  started_at: string;
  ended_at: string;
  dropped_blocks: number;
  lost_pct: number;
  doppler_samples: DopplerSample[];
  image_data_url: string | null;
};

export const CAPTURE_SAMPLE_INTERVAL_MS: number;
export const CAPTURE_SAMPLE_LIMIT: number;
export function createCaptureDraft(metadata: CaptureMetadata, startedAt?: Date, monotonicStartMs?: number): CaptureDraft;
export function addDopplerSample(draft: CaptureDraft | null, afc: { lock: boolean; hz: number } | null, monotonicNowMs: number): CaptureDraft | null;
export function finalizeCaptureDraft(draft: CaptureDraft, recording: { name: string; dropped?: number; lost_pct?: number }, endedAt?: Date, imageDataUrl?: string | null): CapturePayload;
