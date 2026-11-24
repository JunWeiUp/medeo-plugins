// Pure recording domain model, 120Hz encoder recommendation, HUD/border/PiP layout math,
// telemetry/FPS health checks, and Issue bundle metadata builder (zero DOM/Node IO).
import { clamp, type Rect } from './geometry.ts';
import type { CaptureRecordV2, CaptureStartArgsV2, WindowBounds } from './platform.ts';

export type RecordingFps = 30 | 60 | 120;
export type RecordingCodec = 'auto' | 'h264' | 'hevc';
export type RecordingQuality = 'low' | 'medium' | 'high' | 'lossless';
export type RecordingFormat = 'mp4' | 'gif';
export type CountdownSeconds = 0 | 3 | 5;
export type CameraShape = 'circle' | 'rounded' | 'rect';
export type CameraCorner = 'bl' | 'br' | 'tl' | 'tr';
export type KeystrokePosition = 'bottom-center' | 'bottom-left' | 'bottom-right';
export type ClickSize = 'sm' | 'md' | 'lg';

export interface RecordingConfig {
  fps: RecordingFps;
  codec: RecordingCodec;
  quality: RecordingQuality;
  format: RecordingFormat;
  countdown: CountdownSeconds;
  showsCursor: boolean;
  separateAudio: boolean;
  systemAudio: { enabled: boolean; excludeSelf: boolean };
  microphone: { enabled: boolean; deviceId: string | null; mono: boolean };
  camera: {
    enabled: boolean;
    deviceId: string | null;
    shape: CameraShape;
    position: CameraCorner;
    mirror: boolean;
  };
  clicks: { enabled: boolean; color: string; size: ClickSize; sound: boolean };
  keystrokes: { enabled: boolean; shortcutsOnly: boolean; position: KeystrokePosition };
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  fps: 60,
  codec: 'auto',
  quality: 'high',
  format: 'mp4',
  countdown: 3,
  showsCursor: true,
  separateAudio: true,
  systemAudio: { enabled: true, excludeSelf: true },
  microphone: { enabled: false, deviceId: null, mono: true },
  camera: { enabled: false, deviceId: null, shape: 'circle', position: 'bl', mirror: true },
  clicks: { enabled: true, color: '#FF3B30', size: 'md', sound: false },
  keystrokes: { enabled: false, shortcutsOnly: true, position: 'bottom-center' },
};

export const ISSUE_RECORDING_PRESET: Partial<RecordingConfig> = {
  fps: 120,
  codec: 'auto',
  quality: 'high',
  format: 'mp4',
  countdown: 0,
  showsCursor: true,
  separateAudio: true,
  systemAudio: { enabled: true, excludeSelf: true },
  clicks: { enabled: true, color: '#FF3B30', size: 'md', sound: false },
  keystrokes: { enabled: true, shortcutsOnly: true, position: 'bottom-center' },
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function normalizeRecordingConfig(raw: unknown): RecordingConfig {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_RECORDING_CONFIG;
  const sys = v.systemAudio && typeof v.systemAudio === 'object' ? (v.systemAudio as Record<string, unknown>) : {};
  const mic = v.microphone && typeof v.microphone === 'object' ? (v.microphone as Record<string, unknown>) : {};
  const cam = v.camera && typeof v.camera === 'object' ? (v.camera as Record<string, unknown>) : {};
  const clk = v.clicks && typeof v.clicks === 'object' ? (v.clicks as Record<string, unknown>) : {};
  const key = v.keystrokes && typeof v.keystrokes === 'object' ? (v.keystrokes as Record<string, unknown>) : {};

  return {
    fps: v.fps === 30 || v.fps === 60 || v.fps === 120 ? v.fps : d.fps,
    codec: v.codec === 'auto' || v.codec === 'h264' || v.codec === 'hevc' ? v.codec : d.codec,
    quality:
      v.quality === 'low' || v.quality === 'medium' || v.quality === 'high' || v.quality === 'lossless'
        ? v.quality
        : d.quality,
    format: v.format === 'mp4' || v.format === 'gif' ? v.format : d.format,
    countdown: v.countdown === 0 || v.countdown === 3 || v.countdown === 5 ? v.countdown : d.countdown,
    showsCursor: typeof v.showsCursor === 'boolean' ? v.showsCursor : d.showsCursor,
    separateAudio: typeof v.separateAudio === 'boolean' ? v.separateAudio : d.separateAudio,
    systemAudio: {
      enabled: typeof sys.enabled === 'boolean' ? sys.enabled : d.systemAudio.enabled,
      excludeSelf: typeof sys.excludeSelf === 'boolean' ? sys.excludeSelf : d.systemAudio.excludeSelf,
    },
    microphone: {
      enabled: typeof mic.enabled === 'boolean' ? mic.enabled : d.microphone.enabled,
      deviceId: typeof mic.deviceId === 'string' && mic.deviceId.trim() ? mic.deviceId.trim() : null,
      mono: typeof mic.mono === 'boolean' ? mic.mono : d.microphone.mono,
    },
    camera: {
      enabled: typeof cam.enabled === 'boolean' ? cam.enabled : d.camera.enabled,
      deviceId: typeof cam.deviceId === 'string' && cam.deviceId.trim() ? cam.deviceId.trim() : null,
      shape: cam.shape === 'circle' || cam.shape === 'rounded' || cam.shape === 'rect' ? cam.shape : d.camera.shape,
      position:
        cam.position === 'bl' || cam.position === 'br' || cam.position === 'tl' || cam.position === 'tr'
          ? cam.position
          : d.camera.position,
      mirror: typeof cam.mirror === 'boolean' ? cam.mirror : d.camera.mirror,
    },
    clicks: {
      enabled: typeof clk.enabled === 'boolean' ? clk.enabled : d.clicks.enabled,
      color: typeof clk.color === 'string' && HEX_COLOR.test(clk.color) ? clk.color.toUpperCase() : d.clicks.color,
      size: clk.size === 'sm' || clk.size === 'md' || clk.size === 'lg' ? clk.size : d.clicks.size,
      sound: typeof clk.sound === 'boolean' ? clk.sound : d.clicks.sound,
    },
    keystrokes: {
      enabled: typeof key.enabled === 'boolean' ? key.enabled : d.keystrokes.enabled,
      shortcutsOnly: typeof key.shortcutsOnly === 'boolean' ? key.shortcutsOnly : d.keystrokes.shortcutsOnly,
      position:
        key.position === 'bottom-center' || key.position === 'bottom-left' || key.position === 'bottom-right'
          ? key.position
          : d.keystrokes.position,
    },
  };
}

/** Matches native VideoEncodingConfig.chooseCodec: >1080p at >=90fps auto-selects HEVC. */
export function effectiveCodec(cfg: RecordingConfig, widthPx: number, heightPx: number): 'h264' | 'hevc' {
  if (cfg.codec === 'hevc' || cfg.codec === 'h264') return cfg.codec;
  const pixels = Math.max(1, widthPx) * Math.max(1, heightPx);
  if (cfg.fps >= 90 && pixels > 1920 * 1080) return 'hevc';
  if (pixels > 2560 * 1440) return 'hevc';
  return 'h264';
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

export function detectFpsHealth(
  targetFps: number,
  actualFps?: number,
  droppedFrames = 0,
): 'ok' | 'warn' | 'drop' {
  if (droppedFrames >= 10) return 'drop';
  if (actualFps !== undefined && actualFps > 0) {
    if (actualFps < targetFps * 0.72) return 'drop';
    if (actualFps < targetFps * 0.88) return 'warn';
  }
  if (droppedFrames > 0) return 'warn';
  return 'ok';
}

/** Places the non-activating Recording HUD pill below the capture rect, then above, then bottom-center of display. */
export function computeHudBounds(
  region: WindowBounds,
  display: WindowBounds,
  hudSize: { width: number; height: number } = { width: 472, height: 48 },
): WindowBounds {
  const margin = 12;
  const x = Math.round(
    clamp(
      region.x + region.width / 2 - hudSize.width / 2,
      display.x + margin,
      display.x + display.width - hudSize.width - margin,
    ),
  );
  const belowY = region.y + region.height + margin;
  const aboveY = region.y - hudSize.height - margin;
  let y: number;
  if (belowY + hudSize.height <= display.y + display.height - margin) {
    y = belowY;
  } else if (aboveY >= display.y + margin) {
    y = aboveY;
  } else {
    y = display.y + display.height - hudSize.height - 20;
  }
  return { x, y: Math.round(y), width: hudSize.width, height: hudSize.height };
}

/** Inflates the capture region by `pad` px so the border frame stays completely outside recorded pixels. */
export function computeBorderBounds(region: WindowBounds, display: WindowBounds, pad = 4): WindowBounds {
  const x = Math.max(display.x, Math.floor(region.x - pad));
  const y = Math.max(display.y, Math.floor(region.y - pad));
  const right = Math.min(display.x + display.width, Math.ceil(region.x + region.width + pad));
  const bottom = Math.min(display.y + display.height, Math.ceil(region.y + region.height + pad));
  return {
    x,
    y,
    width: Math.max(48, right - x),
    height: Math.max(48, bottom - y),
  };
}

export function computeCameraPipBounds(
  region: WindowBounds,
  position: CameraCorner,
  size = 160,
  margin = 16,
): WindowBounds {
  const s = Math.min(size, Math.max(88, Math.floor(Math.min(region.width, region.height) * 0.28)));
  const x = position === 'tl' || position === 'bl' ? region.x + margin : region.x + region.width - s - margin;
  const y = position === 'tl' || position === 'tr' ? region.y + margin : region.y + region.height - s - margin;
  return { x: Math.round(x), y: Math.round(y), width: s, height: s };
}

/** Builds the exact `capture.start` payload from display-local selection + config. */
export function buildStartPayload(
  sourceId: string,
  localRect: Rect,
  display: { x: number; y: number; width: number; height: number },
  cfg: RecordingConfig,
): CaptureStartArgsV2 {
  const fullDisplay =
    Math.abs(localRect.x) <= 1 &&
    Math.abs(localRect.y) <= 1 &&
    Math.abs(localRect.w - display.width) <= 2 &&
    Math.abs(localRect.h - display.height) <= 2;

  const payload: CaptureStartArgsV2 = {
    source: sourceId,
    fps: cfg.fps,
    codec: cfg.codec,
    quality: cfg.quality,
    shows_cursor: cfg.showsCursor,
    exclude_plugin_windows: true,
    separate_audio: cfg.separateAudio,
    microphone: cfg.microphone.enabled
      ? { enabled: true, device_id: cfg.microphone.deviceId, mono: cfg.microphone.mono }
      : false,
    system_audio: cfg.systemAudio.enabled
      ? { enabled: true, exclude_self: cfg.systemAudio.excludeSelf }
      : false,
    camera: cfg.camera.enabled
      ? { enabled: true, device_id: cfg.camera.deviceId, mirror: cfg.camera.mirror }
      : false,
    telemetry: {
      cursor: cfg.clicks.enabled,
      keystrokes: {
        enabled: cfg.keystrokes.enabled,
        shortcuts_only: cfg.keystrokes.shortcutsOnly,
      },
    },
  };
  if (!fullDisplay) {
    payload.rect = {
      x: Math.round(display.x + localRect.x),
      y: Math.round(display.y + localRect.y),
      width: Math.max(16, Math.round(localRect.w)),
      height: Math.max(16, Math.round(localRect.h)),
    };
  }
  return payload;
}

export interface IssueBundleSummary {
  schema: 'medeo.issue-recording.v1';
  created_at: string;
  record_id: string;
  source_title: string;
  duration_ms: number;
  bytes: number;
  video: {
    width: number | null;
    height: number | null;
    target_fps: number;
    actual_fps: number | null;
    dropped_frames: number;
    codec: string | null;
  };
  tracks: Record<string, boolean>;
  telemetry_events: number;
  settings: {
    clicks: boolean;
    keystrokes: boolean;
    shortcuts_only: boolean;
    system_audio: boolean;
    microphone: boolean;
    camera: boolean;
  };
}

export function buildIssueSummary(record: CaptureRecordV2, cfg: RecordingConfig, now = new Date()): IssueBundleSummary {
  return {
    schema: 'medeo.issue-recording.v1',
    created_at: now.toISOString(),
    record_id: record.id,
    source_title: record.source_title,
    duration_ms: record.duration_ms,
    bytes: record.bytes,
    video: {
      width: record.width ?? null,
      height: record.height ?? null,
      target_fps: record.target_fps ?? cfg.fps,
      actual_fps: record.actual_fps ?? null,
      dropped_frames: record.dropped_frames ?? 0,
      codec: record.codec ?? null,
    },
    tracks: record.tracks ?? { 'capture.mp4': true },
    telemetry_events: record.telemetry_events ?? 0,
    settings: {
      clicks: cfg.clicks.enabled,
      keystrokes: cfg.keystrokes.enabled,
      shortcuts_only: cfg.keystrokes.shortcutsOnly,
      system_audio: cfg.systemAudio.enabled,
      microphone: cfg.microphone.enabled,
      camera: cfg.camera.enabled,
    },
  };
}
