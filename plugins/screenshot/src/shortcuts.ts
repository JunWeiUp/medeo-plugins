// Recording keys into Electron accelerators and showing them (after Window Ring). No SDK.
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'] as const;
const SYMBOLS: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: '↩', Space: 'Space', Backspace: '⌫', Tab: '⇥' };
const PUNCTUATION: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' };
const NAMED: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Backspace: 'Backspace', Tab: 'Tab' };

const canonical = (accelerator: string) => { const parts = accelerator.split('+'), key = parts.pop()!; return [...MODIFIERS.filter(m => parts.includes(m)), key].join('+'); };
export const same = (a: string, b: string) => canonical(a).toLowerCase() === canonical(b).toLowerCase();

/** One non-modifier key plus ⌃, ⌥ or ⌘ (⇧ alone would eat ordinary typing); F-keys may stand alone. */
export function valid(accelerator: string): boolean {
  const parts = accelerator.split('+'), key = parts.pop();
  if (!key || (MODIFIERS as readonly string[]).includes(key)) return false;
  if (parts.some(p => !(MODIFIERS as readonly string[]).includes(p)) || new Set(parts).size !== parts.length) return false;
  return /^F(?:[1-9]|1\d|20)$/.test(key) || parts.some(p => p !== 'Shift');
}

export function fromKey(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d)|(F(?:[1-9]|1\d|20)))$/.exec(e.code);
  const key = m ? (m[1] ?? m[2] ?? m[3]) : NAMED[e.code] ?? PUNCTUATION[e.code];
  if (!key) return null;
  return [...[e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean) as string[], key].join('+');
}

export const symbols = (accelerator: string) => canonical(accelerator).split('+').map(p => SYMBOLS[p] ?? p).join('');
