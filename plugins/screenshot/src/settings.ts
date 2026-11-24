// Settings live in the plugin's private storagePath/settings.json; bad values fall back to defaults.
import { DEFAULT_RECORDING_CONFIG, normalizeRecordingConfig, type RecordingConfig } from './recording.ts';
import { valid } from './shortcuts.ts';

export const SHORTCUTS = [
  'shortcutArea',
  'shortcutRecord',
  'shortcutRecordIssue',
  'shortcutFull',
  'shortcutQuick',
  'shortcutOcr',
] as const;
export type ShortcutKey = typeof SHORTCUTS[number];

export interface Settings {
  /** Accelerators; null = no shortcut. */
  shortcutArea: string | null;
  shortcutRecord: string | null;
  shortcutRecordIssue: string | null;
  shortcutFull: string | null;
  shortcutQuick: string | null;
  shortcutOcr: string | null;
  /** What ↩ (and quick capture) does in screenshot mode. */
  enterAction: 'copy' | 'save';
  format: 'png' | 'jpeg';
  /** Save Retina captures at 1× (half the pixels). */
  downscale: boolean;
  /** `~/…` or absolute. */
  saveDir: string;
  openAfterSave: boolean;
  /** The toolbar's «Store to Medeo Drive» button (hidden with «Don't show again»). */
  showDrive: boolean;
  /** Persistent defaults for 120Hz screen recording (audio, camera, clicks, keystrokes). */
  recording: RecordingConfig;
}

export const DEFAULTS: Settings = {
  shortcutArea: 'Command+Shift+X',
  shortcutRecord: 'Command+Shift+R',
  shortcutRecordIssue: null,
  shortcutFull: null,
  shortcutQuick: null,
  shortcutOcr: null,
  enterAction: 'copy',
  format: 'png',
  downscale: false,
  saveDir: '~/Pictures/Medeo Screenshots',
  openAfterSave: false,
  showDrive: true,
  recording: { ...DEFAULT_RECORDING_CONFIG },
};

const shortcut = (v: unknown, d: string | null) => v === null ? null : typeof v === 'string' && valid(v) ? v : d;

export function normalize(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const out: Settings = { ...DEFAULTS, recording: normalizeRecordingConfig(v.recording) };
  // Earlier versions stored a single capture shortcut.
  const legacy = Object.hasOwn(v, 'shortcutCapture') && !Object.hasOwn(v, 'shortcutArea') ? { shortcutArea: v.shortcutCapture } : {};
  const all = { ...v, ...legacy } as Record<string, unknown>;
  const seen = new Set<string>();
  for (const k of SHORTCUTS) {
    const s = Object.hasOwn(all, k) ? shortcut(all[k], DEFAULTS[k]) : DEFAULTS[k];
    // One key never does two things: a later duplicate is dropped.
    out[k] = s && seen.has(s.toLowerCase()) ? null : s;
    if (out[k]) seen.add(out[k]!.toLowerCase());
  }
  if (v.enterAction === 'copy' || v.enterAction === 'save') out.enterAction = v.enterAction;
  if (v.format === 'png' || v.format === 'jpeg') out.format = v.format;
  if (typeof v.downscale === 'boolean') out.downscale = v.downscale;
  if (typeof v.saveDir === 'string' && v.saveDir.trim() && v.saveDir.length < 1024) out.saveDir = v.saveDir.trim();
  if (typeof v.openAfterSave === 'boolean') out.openAfterSave = v.openAfterSave;
  if (typeof v.showDrive === 'boolean') out.showDrive = v.showDrive;
  return out;
}
