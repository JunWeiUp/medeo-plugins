// Messages between the worker and the plugin windows (overlay, HUD, border, countdown, review, pin, settings).
// The channel broadcasts to every window of the plugin, so each message names who it is for.
import type { Rect } from './geometry.ts';
import type { CaptureDevicesResult, CaptureRecordV2 } from './platform.ts';
import type { RecordingConfig } from './recording.ts';
import type { Settings, ShortcutKey } from './settings.ts';

/** area: select then edit · quick: save/copy immediately · ocr: read text · full: whole display · record / record-issue: 120Hz recording. */
export type Mode = 'area' | 'quick' | 'ocr' | 'full' | 'record' | 'record-issue';
/** drive: to Netdisk, into the folder it used last · drive-to: Netdisk asks where · pin: float on screen. */
export type Action = 'copy' | 'save' | 'ocr' | 'drive' | 'drive-to' | 'pin';
export interface Output { format: 'png' | 'jpeg'; downscale: boolean; enter: 'copy' | 'save'; drive: boolean }

/** One captured display: `width`/`height` in points, the PNG is `width*scale` pixels wide. */
export interface Shot {
  seq: number;
  mode: Mode;
  width: number;
  height: number;
  scale: number;
  displayId?: number;
  displayOrigin?: { x: number; y: number };
  refreshRate?: number;
  windows: Rect[];
  output: Output;
  recording?: RecordingConfig;
  devices?: CaptureDevicesResult | null;
}
export interface OcrResult { text: string; codes: string[] }

export interface HudState {
  id: string;
  status: string;
  paused: boolean;
  durationMs: number;
  bytes: number;
  targetFps: number;
  actualFps?: number;
  droppedFrames: number;
  codec?: string;
  micLevel: number;
  sysLevel: number;
  micEnabled: boolean;
  sysEnabled: boolean;
  micMuted: boolean;
  sysMuted: boolean;
  cameraEnabled: boolean;
  cameraFallback: boolean;
  clicksEnabled: boolean;
  keystrokesEnabled: boolean;
  telemetryEvents: number;
  issueMode: boolean;
}

export interface BorderState {
  status: 'countdown' | 'recording' | 'paused';
  label: string;
  fps: number;
  width: number;
  height: number;
}

export interface CountdownState {
  secondsLeft: number;
  fps: number;
}

export interface ReviewState {
  activeRecord: CaptureRecordV2 | null;
  history: CaptureRecordV2[];
  config: RecordingConfig;
  issueMode: boolean;
  saveDir: string;
  ffmpegAvailable: boolean;
  busyAction?: string | null;
}

export interface PinPayload {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}

export type ToOverlay =
  | { type: 'shot'; shot: Shot; parts: number }
  | { type: 'chunk'; seq: number; i: number; data: string }
  | { type: 'ocr'; seq: number; result: OcrResult | null }
  | { type: 'devices'; devices: CaptureDevicesResult }
  | { type: 'overlay-toast'; key: string; params?: Record<string, string> };

export type FromOverlay =
  | { type: 'overlay-ready' }
  | { type: 'result'; seq: number; action: Action; mime: string; i: number; parts: number; data: string; rect?: Rect }
  | { type: 'cancel'; seq: number }
  | { type: 'copy-text'; text: string }
  | { type: 'open-url'; url: string }
  | { type: 'hide-drive' }
  | { type: 'refresh-devices' }
  | { type: 'update-recording-config'; config: RecordingConfig }
  | { type: 'open-privacy-pane'; pane: 'screen' | 'mic' | 'camera' | 'input' }
  | { type: 'start-recording'; seq: number; rect: Rect; config: RecordingConfig; issueMode: boolean };

export type ToHud = { type: 'hud-state'; state: HudState };
export type FromHud =
  | { type: 'hud-ready' }
  | { type: 'hud-pause' }
  | { type: 'hud-resume' }
  | { type: 'hud-stop' }
  | { type: 'hud-cancel' }
  | { type: 'hud-toggle-mic' }
  | { type: 'hud-toggle-sys' };

export type ToBorder = { type: 'border-state'; state: BorderState };
export type FromBorder = { type: 'border-ready' };

export type ToCountdown = { type: 'countdown-state'; state: CountdownState };
export type FromCountdown = { type: 'countdown-ready' } | { type: 'countdown-cancel' };

export type ToReview =
  | { type: 'review-state'; state: ReviewState }
  | { type: 'review-toast'; tone: 'success' | 'error'; message: string };
export type FromReview =
  | { type: 'review-ready' }
  | { type: 'review-select'; id: string }
  | { type: 'review-export-start'; jobId: string; id: string; kind: 'save-mp4' | 'save-gif' | 'copy-file' | 'drive' | 'drive-to' | 'issue-pack'; trimStart?: number; trimEnd?: number; telemetryText?: string }
  | { type: 'review-export-chunk'; jobId: string; index: number; data: string }
  | { type: 'review-export-end'; jobId: string; ok: boolean }
  | { type: 'review-reveal'; id: string }
  | { type: 'review-record-new'; issueMode: boolean };

export type ToPin = { type: 'pin-data'; pin: PinPayload };
export type FromPin =
  | { type: 'pin-ready'; id: string }
  | { type: 'pin-close'; id: string }
  | { type: 'pin-copy'; id: string }
  | { type: 'pin-save'; id: string };

export interface SettingsState { settings: Settings; saveDir: string; errors: Partial<Record<ShortcutKey, string>> }

export type ToSettings = { type: 'settings'; state: SettingsState } | { type: 'toast'; tone: 'success' | 'error'; key: string };

export type FromSettings =
  | { type: 'settings-ready' }
  | { type: 'set'; patch: Partial<Settings> }
  | { type: 'choose-folder' }
  | { type: 'reveal-folder' }
  | { type: 'open-privacy'; pane?: 'screen' | 'mic' | 'camera' | 'input' }
  | { type: 'capture' }
  | { type: 'record' };

export type ToWindow = ToOverlay | ToSettings | ToHud | ToBorder | ToCountdown | ToReview | ToPin;
export type FromWindow = FromOverlay | FromSettings | FromHud | FromBorder | FromCountdown | FromReview | FromPin;

/** Under the 1 MiB channel limit with room for the envelope. */
export const CHUNK = 768 * 1024;
export const split = (b64: string) => { const out: string[] = []; for (let i = 0; i < b64.length; i += CHUNK) out.push(b64.slice(i, i + CHUNK)); return out.length ? out : ['']; };

/** Vision observations (normalized, bottom-left origin) → reading order, one text line per row. */
export function joinLines(lines: { t: string; x: number; y: number; h: number }[]): string {
  const sorted = [...lines].sort((a, b) => (b.y + b.h / 2) - (a.y + a.h / 2));
  const rows: { y: number; h: number; items: typeof lines }[] = [];
  for (const l of sorted) {
    const mid = l.y + l.h / 2, row = rows.find(r => Math.abs(r.y - mid) < Math.min(r.h, l.h) * 0.5);
    if (row) row.items.push(l); else rows.push({ y: mid, h: l.h, items: [l] });
  }
  return rows.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.t).join(' ')).join('\n');
}
