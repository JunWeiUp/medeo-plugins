// Messages between the worker and the two windows (overlay editor, settings). The channel
// broadcasts to every window of the plugin, so each message names who it is for.
import type { Rect } from './geometry.ts';
import type { Settings, ShortcutKey } from './settings.ts';

/** area: select then edit · quick: save/copy as soon as the selection is made · ocr: read text · full: whole display. */
export type Mode = 'area' | 'quick' | 'ocr' | 'full';
export type Action = 'copy' | 'save' | 'ocr';
export interface Output { format: 'png' | 'jpeg'; downscale: boolean; enter: 'copy' | 'save' }

/** One captured display: `width`/`height` in points, the PNG is `width*scale` pixels wide. */
export interface Shot { seq: number; mode: Mode; width: number; height: number; scale: number; windows: Rect[]; output: Output }
export interface OcrResult { text: string; codes: string[] }

export type ToOverlay =
  | { type: 'shot'; shot: Shot; parts: number }
  | { type: 'chunk'; seq: number; i: number; data: string }
  | { type: 'ocr'; seq: number; result: OcrResult | null }
  | { type: 'overlay-toast'; key: string; params?: Record<string, string> };

export type FromOverlay =
  | { type: 'overlay-ready' }
  | { type: 'result'; seq: number; action: Action; mime: string; i: number; parts: number; data: string }
  | { type: 'cancel'; seq: number }
  | { type: 'copy-text'; text: string }
  | { type: 'open-url'; url: string };

export interface SettingsState { settings: Settings; saveDir: string; errors: Partial<Record<ShortcutKey, string>> }

export type ToSettings = { type: 'settings'; state: SettingsState } | { type: 'toast'; tone: 'success' | 'error'; key: string };

export type FromSettings =
  | { type: 'settings-ready' }
  | { type: 'set'; patch: Partial<Settings> }
  | { type: 'choose-folder' }
  | { type: 'reveal-folder' }
  | { type: 'open-privacy' }
  | { type: 'capture' };

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
