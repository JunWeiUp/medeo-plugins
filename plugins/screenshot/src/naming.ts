// `Medeo_20261109_140501.png`; a second file in the same second gets `_1`, `_2`… never overwriting.
const pad = (n: number) => String(n).padStart(2, '0');
export function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
export function fileName(prefix: string, d: Date, exists: (name: string) => boolean, ext = 'png'): string {
  const base = `${prefix}_${stamp(d)}`;
  for (let i = 0; ; i++) {
    const name = i ? `${base}_${i}.${ext}` : `${base}.${ext}`;
    if (!exists(name)) return name;
  }
}
/** `~/x` → `<home>/x`; anything that is not absolute falls back to `fallback`. */
export function expandHome(dir: string, home: string, fallback: string): string {
  const v = dir.trim();
  if (v === '~') return home;
  if (v.startsWith('~/')) return home + v.slice(1);
  return v.startsWith('/') ? v : fallback;
}
