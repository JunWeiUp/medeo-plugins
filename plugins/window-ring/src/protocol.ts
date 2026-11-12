// Messages between the worker and the plugin's windows (main window and the ring overlay).
import type { Action, Frame, Screen } from './layout.ts';

/** Default shortcuts: ⌃⌥ plus a key, Rectangle/Loop style. 16 is the host's per-plugin limit.
 * Not ⌃⌥Space for the ring: macOS uses it for "next input source" and swallows it. */
export const BINDINGS: { id: string; accelerator: string; action: Action | 'ring' }[] = [
  { id: 'ring', accelerator: 'Control+Alt+R', action: 'ring' },
  { id: 'left-half', accelerator: 'Control+Alt+Left', action: 'left-half' },
  { id: 'right-half', accelerator: 'Control+Alt+Right', action: 'right-half' },
  { id: 'top-half', accelerator: 'Control+Alt+Up', action: 'top-half' },
  { id: 'bottom-half', accelerator: 'Control+Alt+Down', action: 'bottom-half' },
  { id: 'maximize', accelerator: 'Control+Alt+Enter', action: 'maximize' },
  { id: 'center', accelerator: 'Control+Alt+C', action: 'center' },
  { id: 'top-left', accelerator: 'Control+Alt+U', action: 'top-left' },
  { id: 'top-right', accelerator: 'Control+Alt+I', action: 'top-right' },
  { id: 'bottom-left', accelerator: 'Control+Alt+J', action: 'bottom-left' },
  { id: 'bottom-right', accelerator: 'Control+Alt+K', action: 'bottom-right' },
  { id: 'left-third', accelerator: 'Control+Alt+D', action: 'left-third' },
  { id: 'center-third', accelerator: 'Control+Alt+F', action: 'center-third' },
  { id: 'right-third', accelerator: 'Control+Alt+G', action: 'right-third' },
  { id: 'next-display', accelerator: 'Control+Alt+N', action: 'next-display' },
  { id: 'undo', accelerator: 'Control+Alt+Backspace', action: 'undo' },
];

/** `none`: the user cleared it. */
export type BindingState = 'registered' | 'conflict' | 'denied' | 'off' | 'none';
export interface Status {
  /** The plugin's `window_management` grant, then macOS Accessibility for Medeo. */
  plugin: boolean;
  os: 'granted' | 'denied' | 'unknown';
  bindings: Record<string, BindingState>;
  /** The accelerator each binding uses now (null: none), and which ones differ from the default. */
  accelerators: Record<string, string | null>;
  customized: string[];
  /** The menu-bar icon is on. */
  tray: boolean;
  /** `storage` is not granted: changes cannot be kept. */
  storage: boolean;
  last?: { action: Action | 'ring'; ok: boolean; error?: string };
}

/** Sent to the ring each time it opens. Coordinates are global points. */
export interface RingSession {
  type: 'ring';
  session: number;
  pointer: { x: number; y: number };
  /** The display under the pointer: where the window goes. */
  screen: Screen;
  window: Frame;
  gap: number;
}

export type ToWorker =
  | { type: 'hello'; from: 'main' | 'ring' }
  | { type: 'apply'; session: number; action: Action }
  | { type: 'cancel'; session: number }
  | { type: 'grant' }
  /** The page records a shortcut: the plugin's own shortcuts pause so the keys reach it. */
  | { type: 'record'; active: boolean }
  /** `accelerator: null` clears it; `reset` puts back the default (or all defaults with no id). */
  | { type: 'set-shortcut'; id: string; accelerator: string | null }
  | { type: 'reset-shortcuts'; id?: string }
  | { type: 'tray'; visible: boolean };
export type ShortcutError = 'invalid' | 'duplicate' | 'conflict' | 'denied' | 'storage' | 'failed';
export type FromWorker = RingSession | { type: 'status'; status: Status } | { type: 'closed'; session: number }
  | { type: 'shortcut-result'; id: string; ok: boolean; error?: ShortcutError; other?: string }
  /** A layout was just applied (shortcut, ring or menu): the page plays it on its diagram. */
  | { type: 'applied'; action: Action };
