// Pure view helpers for the window: formatting, grouping, sorting and selection rules.
import type { Risk } from './catalog.ts';
import type { Item } from './scan.ts';

export const CATEGORY_ORDER = ['projects', 'xcode', 'simulator', 'android', 'node', 'flutter', 'go', 'rust', 'python', 'pods',
  'ide', 'codex', 'claude', 'browser', 'homebrew', 'system', 'trash'];
export const RISKS: Risk[] = ['safe', 'review', 'caution'];
/** Category marks (ui/icons) and tints, after Mackit: the toolchain's logo when it has one. */
export const CATEGORY_STYLE: Record<string, { icon: string; tint: string }> = {
  projects: { icon: 'folder', tint: '#5e5ce6' }, xcode: { icon: 'xcode', tint: '#0a84ff' }, simulator: { icon: 'phone', tint: '#bf5af2' },
  android: { icon: 'android', tint: '#30d158' }, go: { icon: 'go', tint: '#64d2ff' }, node: { icon: 'nodedotjs', tint: '#63e6e2' },
  flutter: { icon: 'flutter', tint: '#40c8e0' }, rust: { icon: 'rust', tint: '#ff9f0a' }, python: { icon: 'python', tint: '#ffd60a' },
  pods: { icon: 'cocoapods', tint: '#ac8e68' }, ide: { icon: 'puzzle', tint: '#ff375f' }, browser: { icon: 'globe', tint: '#0a84ff' },
  homebrew: { icon: 'homebrew', tint: '#ff453a' }, system: { icon: 'drive', tint: '#98989d' }, trash: { icon: 'trash', tint: '#8e8e93' },
  codex: { icon: 'codex', tint: '#10a37f' }, claude: { icon: 'claude', tint: '#d97757' },
  appJunk: { icon: 'stack', tint: '#bf5af2' }, language: { icon: 'book', tint: '#63e6e2' }, downloads: { icon: 'download', tint: '#ff9f0a' },
};

/** Decimal units like Finder: KB whole, MB one decimal, GB and up two (trailing zeros dropped). */
export function size(bytes: number, locale = 'en'): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'], digits = [0, 1, 2, 2];
  let value = bytes / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits[unit] }).format(value)} ${units[unit]}`;
}
/** What removing these frees. A command's size is the cache it usually clears, which the
 * path rules list too (`pnpm store prune` and the pnpm store), so commands are not added. */
export const total = (items: Item[]) => items.reduce((n, i) => n + (i.kind === 'command' ? 0 : i.bytes), 0);

export interface Group { category: string; items: Item[]; bytes: number }
/** Categories in a fixed order; empty categories are left out. */
export function groups(items: Item[]): Group[] {
  const by = new Map<string, Item[]>();
  for (const item of items) by.set(item.category, [...(by.get(item.category) ?? []), item]);
  const order = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; };
  return [...by].sort(([a], [b]) => order(a) - order(b)).map(([category, list]) => ({ category, items: list, bytes: total(list) }));
}
export type Sort = 'sizeDescending' | 'sizeAscending' | 'nameAscending' | 'nameDescending' | 'dateDescending' | 'dateAscending';
export const SORTS: Sort[] = ['sizeDescending', 'sizeAscending', 'nameAscending', 'nameDescending', 'dateDescending', 'dateAscending'];
export function sorted(items: Item[], sort: Sort, title: (i: Item) => string): Item[] {
  const by: Record<Sort, (a: Item, b: Item) => number> = {
    sizeDescending: (a, b) => b.bytes - a.bytes, sizeAscending: (a, b) => a.bytes - b.bytes,
    nameAscending: (a, b) => title(a).localeCompare(title(b)), nameDescending: (a, b) => title(b).localeCompare(title(a)),
    // Commands have no date and sort last either way.
    dateDescending: (a, b) => (b.modified ?? -Infinity) - (a.modified ?? -Infinity), dateAscending: (a, b) => (a.modified ?? Infinity) - (b.modified ?? Infinity),
  };
  return [...items].sort(by[sort]);
}
export function matches(item: Item, query: string, title: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [title, item.name, item.path, item.command ?? ''].some(s => s.toLowerCase().includes(q));
}
/** "Select all safe" picks only safe path items; commands and riskier items stay a deliberate choice. */
export const safeIds = (items: Item[]) => items.filter(i => i.risk === 'safe' && i.kind === 'path').map(i => i.id);
/** `~/…` for paths in the home folder. */
export const abbreviate = (path: string, home: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);
/** "26 minutes ago", "2 weeks ago" in the plugin's language. */
export function relative(ms: number | null, locale: string, now = Date.now()): string {
  if (ms === null) return '—';
  const seconds = (ms - now) / 1000, f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]];
  let value = seconds;
  for (const [unit, next] of steps) { if (Math.abs(value) < next) return f.format(Math.round(value), unit); value /= next; }
  return f.format(Math.round(value), 'year');
}
/** Placeholders `{name}` in a catalog message. */
export const format = (message: string, params: Record<string, string | number>) =>
  message.replace(/\{(\w+)\}/g, (token, key: string) => (key in params ? String(params[key]) : token));
