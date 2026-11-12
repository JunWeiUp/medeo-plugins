// Shortcut bookkeeping as plain data: defaults, the user's overrides, recording keys into
// accelerators and showing them. No SDK, so it is unit-tested with `node --test`.
import { BINDINGS } from './protocol.ts';

/** What the user changed: an accelerator, or null for "no shortcut". Missing = the default. */
export type Overrides = Record<string, string | null>;

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'] as const;
const SYMBOLS: Record<string, string> = {
  Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Left: '←', Right: '→', Up: '↑', Down: '↓',
  Enter: '↩', Space: 'Space', Backspace: '⌫', Tab: '⇥', Plus: '+',
};
const PUNCTUATION: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
};
const NAMED: Record<string, string> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Backspace: 'Backspace', Tab: 'Tab',
};

/** The accelerator each binding uses now: the user's choice, else the default. */
export function effective(overrides: Overrides): Record<string, string | null> {
  return Object.fromEntries(BINDINGS.map(b => [b.id, Object.hasOwn(overrides, b.id) ? overrides[b.id] : b.accelerator]));
}

/** Drops unknown ids, malformed values and overrides equal to the default (so "reset" leaves nothing behind). */
export function clean(value: unknown): Overrides {
  const out: Overrides = {};
  if (!value || typeof value !== 'object') return out;
  for (const b of BINDINGS) {
    if (!Object.hasOwn(value, b.id)) continue;
    const v = (value as Record<string, unknown>)[b.id];
    if (v === null || (typeof v === 'string' && valid(v) && same(v, b.accelerator) === false)) out[b.id] = v as string | null;
  }
  return out;
}

const canonical = (accelerator: string) => {
  const parts = accelerator.split('+'), key = parts.pop()!;
  return [...MODIFIERS.filter(m => parts.includes(m)), key].join('+');
};
export const same = (a: string, b: string) => canonical(a).toLowerCase() === canonical(b).toLowerCase();

/** A global shortcut needs ⌃, ⌥ or ⌘ (⇧ alone would eat ordinary typing) and one non-modifier key. */
export function valid(accelerator: string): boolean {
  const parts = accelerator.split('+'), key = parts.pop();
  if (!key || (MODIFIERS as readonly string[]).includes(key)) return false;
  if (parts.some(p => !(MODIFIERS as readonly string[]).includes(p)) || new Set(parts).size !== parts.length) return false;
  return parts.some(p => p !== 'Shift');
}

/** A keydown while recording → an accelerator, `null` while only modifiers are held. */
export function fromKey(event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d)|(F(?:[1-9]|1\d|20)))$/.exec(event.code);
  const key = m ? (m[1] ?? m[2] ?? m[3]) : NAMED[event.code] ?? PUNCTUATION[event.code];
  if (!key) return null;
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Command'].filter(Boolean) as string[];
  return [...mods, key].join('+');
}

/** ⌃⌥← style, in the macOS modifier order. */
export function symbols(accelerator: string): string[] {
  const parts = canonical(accelerator).split('+');
  return parts.map(p => SYMBOLS[p] ?? p);
}

/** Another binding already using `accelerator`, so one key never does two things. */
export function duplicateOf(id: string, accelerator: string, current: Record<string, string | null>): string | undefined {
  return Object.entries(current).find(([other, value]) => other !== id && value !== null && same(value, accelerator))?.[0];
}
