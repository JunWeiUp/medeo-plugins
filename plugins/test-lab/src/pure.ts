// Dependency-free helpers of the tabs, unit-tested under node.
/** The loudest of each of `count` slices, so 240 peaks fit any width. */
export function resample(values: number[], count: number) {
  if (!values.length || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const a = Math.floor(i * values.length / count), b = Math.max(a + 1, Math.floor((i + 1) * values.length / count));
    let max = 0; for (let j = a; j < Math.min(b, values.length); j++) max = Math.max(max, values[j]);
    return max;
  });
}
/** Peaks scaled so the loudest bar fills the height; near-silence stays small instead of being blown up. */
export function normalize(values: number[]) {
  const top = Math.max(0.05, ...values);
  return values.map(v => Math.min(1, v / top));
}
const KEYS: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };
/** An Electron accelerator for a key press, or undefined while only modifiers are held. Letters,
 * digits, F-keys and named keys only: the Host accepts `[A-Za-z0-9+_-]`. Needs a modifier unless it is an F-key. */
export function accelerator(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | undefined {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else key = KEYS[e.key];
  if (!key) return undefined;
  const mods = [e.metaKey && 'Command', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  if (!mods.length && !/^F\d+$/.test(key)) return undefined;
  return [...mods, key].join('+');
}
