// The plugin's own preferences, edited in the panel's settings page and kept in
// storagePath/settings.json. Unknown or bad values fall back to the defaults.
export interface Settings {
  paused: boolean;
  /** Electron accelerator for the summon shortcut; empty = none. */
  shortcut: string;
  /** Pressing ↩ pastes into the app the user was in (needs Accessibility); otherwise it only copies. */
  autoPaste: boolean;
  maxItems: number;
  /** 0 = keep forever. */
  retentionDays: number;
}
export const DEFAULTS: Settings = { paused: false, shortcut: 'Alt+C', autoPaste: true, maxItems: 1000, retentionDays: 30 };
export const MAX_ITEMS = [200, 500, 1000, 5000];
export const RETENTION_DAYS = [1, 7, 30, 90, 365, 0];

const ACCELERATOR = /^((Command|Control|Alt|Shift)\+){1,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right)$/;
export const validShortcut = (value: string) => value === '' || ACCELERATOR.test(value);

export function normalize(raw: unknown): Settings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    paused: v.paused === true,
    shortcut: typeof v.shortcut === 'string' && validShortcut(v.shortcut) ? v.shortcut : DEFAULTS.shortcut,
    autoPaste: typeof v.autoPaste === 'boolean' ? v.autoPaste : DEFAULTS.autoPaste,
    maxItems: MAX_ITEMS.includes(v.maxItems as number) ? v.maxItems as number : DEFAULTS.maxItems,
    retentionDays: RETENTION_DAYS.includes(v.retentionDays as number) ? v.retentionDays as number : DEFAULTS.retentionDays,
  };
}
export const limitsOf = (s: Settings) => ({ maxItems: s.maxItems, maxAgeMs: s.retentionDays ? s.retentionDays * 24 * 3600 * 1000 : Number.POSITIVE_INFINITY });

/** An Electron accelerator from a key press, or null while only modifiers are down. */
export function acceleratorOf(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string }): string | null {
  const mods = [e.metaKey && 'Command', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code
    : code === 'Space' ? 'Space' : code === 'Tab' ? 'Tab' : code.startsWith('Arrow') ? code.slice(5) : null;
  if (!key || !mods.length) return null;
  const accelerator = `${mods.join('+')}+${key}`;
  return validShortcut(accelerator) ? accelerator : null;
}
/** ⌥⌘C-style label for an accelerator. */
export function shortcutLabel(accelerator: string): string {
  if (!accelerator) return '';
  const sym: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Space: 'Space', Up: '↑', Down: '↓', Left: '←', Right: '→', Tab: '⇥' };
  const parts = accelerator.split('+'), key = parts.pop()!;
  const order = ['Control', 'Alt', 'Shift', 'Command'];
  return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(m => sym[m]).join('') + (sym[key] ?? key);
}
