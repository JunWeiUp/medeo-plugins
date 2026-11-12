// A calculation or conversion, and installed apps, as panel rows. Pure, no IO.
import { calculate, formatNumber } from './calc.ts';
import { convert } from './units.ts';
import type { Entry } from './model.ts';

export interface AppEntry { id: string; title: string; path: string; bundle_id: string }

export const appEntries = (apps: AppEntry[]): Entry[] => apps.map(a => ({
  kind: 'app', key: `app:${a.bundle_id || a.path}`, appId: a.id, appPath: a.path, title: a.title,
  subtitle: a.path.replace(/^\/Users\/[^/]+/, '~'), keywords: [a.bundle_id, a.path.split('/').pop()?.replace(/\.app$/i, '') ?? ''],
  data: { type: 'application', value: a.path, title: a.title },
}));

/** Grouping like "12,345.6789" for the row; the copied value stays plain. */
export function display(value: number, locale?: string): string {
  const plain = formatNumber(value);
  if (/e/.test(plain)) return plain;
  const [int, frac] = plain.split('.');
  const grouped = Number(int).toLocaleString(locale ?? 'en', { maximumFractionDigits: 0 });
  return frac ? `${grouped}.${frac}` : grouped;
}

/** The row for a calculation or a unit conversion, or null. */
export function answer(query: string, labels: { calc: string; convert: string }, locale?: string): Entry | null {
  const conversion = convert(query);
  if (conversion) {
    const copy = formatNumber(conversion.result);
    return { kind: 'answer', key: 'answer', title: `${display(conversion.result, locale)} ${conversion.to}`, subtitle: `${display(conversion.value, locale)} ${conversion.from} · ${labels.convert}`, keywords: [], copy,
      data: { type: 'text', value: copy, title: copy } };
  }
  const value = calculate(query);
  if (value === null) return null;
  const copy = formatNumber(value);
  return { kind: 'answer', key: 'answer', title: display(value, locale), subtitle: `${query.trim()} = · ${labels.calc}`, keywords: [], copy, data: { type: 'text', value: copy, title: copy } };
}
