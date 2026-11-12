// The junk cleanup page, after Mackit's GeneralCleanLayout: three groups of rows,
// each row rolling up one or more rules; app junk splits by app, localizations by language.
import type { Risk } from './catalog.ts';
import type { Item } from './scan.ts';

export interface Row {
  id: string;
  /** Catalog key of the title and note: `rule.<id>` or another prefix with `.title` / `.note`. */
  title: string; note: string;
  rules: string[]; risk: Risk;
  sub?: 'app' | 'language';
  /** Ticked after a scan by default: everything up to "review", but not localizations. */
  preChecked: boolean;
}
export interface Group { id: 'system' | 'appJunk' | 'browser'; icon: string; tint: string; rows: Row[] }
const rule = (id: string, risk: Risk, extra: Partial<Row> = {}): Row =>
  ({ id, title: `rule.${id}.title`, note: `rule.${id}.note`, rules: [id], risk, preChecked: risk !== 'caution', ...extra });
const browser = (name: string): Row => rule(`browser.${name}-cache`, 'safe', { id: `browser.${name}`, rules: [`browser.${name}-cache`, `browser.${name}-code-cache`] });

export const GROUPS: Group[] = [
  { id: 'system', icon: 'drive', tint: 'var(--orange)', rows: [
    rule('system.logs', 'safe'), rule('system.crashreporter', 'safe'), rule('system.saved-state', 'safe'),
    rule('system.autosave', 'caution'), rule('system.itunes-ipsw', 'review'),
    { id: 'language', title: 'category.language.title', note: 'category.language.summary', rules: ['language.lproj'], risk: 'review', sub: 'language', preChecked: false },
    { id: 'downloads', title: 'general.row.downloads.title', note: 'general.row.downloads.note', rules: ['downloads.installer', 'downloads.archive'], risk: 'caution', preChecked: false },
    rule('system.ios-backups', 'caution'), rule('trash.home', 'caution'),
  ] },
  { id: 'appJunk', icon: 'stack', tint: 'var(--purple)', rows: [
    { id: 'app.junk', title: 'category.appJunk.title', note: 'category.appJunk.summary', rules: ['app.junk'], risk: 'safe', sub: 'app', preChecked: true },
  ] },
  { id: 'browser', icon: 'globe', tint: 'var(--accent)', rows: [
    browser('chrome'), browser('edge'), browser('chromium'), browser('brave'), browser('arc'), browser('opera'), browser('qqbrowser'),
    rule('browser.firefox-cache', 'safe'),
  ] },
];
export const rowItems = (row: Row, items: Item[]) => items.filter(i => row.rules.includes(i.rule));
/** Sub-rows keyed by app name or language code, in that order of appearance. */
export function subRows(row: Row, items: Item[]): { key: string; items: Item[] }[] {
  if (!row.sub) return [];
  const by = new Map<string, Item[]>();
  for (const item of rowItems(row, items)) {
    const key = (row.sub === 'app' ? item.app : item.language) ?? '';
    by.set(key, [...(by.get(key) ?? []), item]);
  }
  return [...by].map(([key, list]) => ({ key, items: list })).sort((a, b) => a.key.localeCompare(b.key));
}
/** The ids ticked after a scan: the rows remembered by the user, or the built-in defaults. */
export function defaultSelection(items: Item[], remembered: string[] | null): string[] {
  const rows = GROUPS.flatMap(g => g.rows).filter(r => (remembered ? remembered.includes(r.id) : r.preChecked));
  return rows.flatMap(r => rowItems(r, items).map(i => i.id));
}
/** Fully, partly or not ticked. */
export function tick(ids: string[], selected: Set<string>): 'all' | 'some' | 'none' {
  const n = ids.filter(id => selected.has(id)).length;
  return n && n === ids.length ? 'all' : n ? 'some' : 'none';
}
