// Clipboard history as Medeo Launcher Protocol results (spec/launcher-v1.md). Pure, no IO.
import type { LauncherItem } from '@medeo-plugin/sdk';
import { matchesQuery, type Entry } from './history.ts';

export interface Labels { paste: string; copy: string; plain: string; star: string; unstar: string; remove: string; image: string; files: string; from: string; copied: string; note: string; kind: string; kinds: Record<string, string> }

const firstLine = (text: string) => text.split(/\r?\n/).find(l => l.trim())?.trim() ?? text.trim();
/** "5 min" style age, short enough for a subtitle. */
export function age(ms: number, now: number, locale: string): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}
/** The newest entries that match, as launcher results. Global searches need at least two characters. */
export function launcherItems(entries: Entry[], query: string, options: { scoped: boolean; limit: number; now: number; locale: string; blobs: string; labels: Labels }): LauncherItem[] {
  const q = query.trim();
  if (!options.scoped && q.length < 2) return [];
  const { labels: l } = options;
  return entries.filter(e => matchesQuery(e, q)).slice(0, options.limit).map(e => {
    const url = e.kind !== 'image' && e.kind !== 'files' && /^https?:\/\/\S+$/.test(e.text.trim());
    const title = e.kind === 'image' ? `${l.image} ${e.width ?? '?'}×${e.height ?? '?'}` : e.kind === 'files'
      ? (e.files ?? []).map(f => f.split('/').pop()).join(', ') || l.files : firstLine(e.text).slice(0, 200);
    const meta = [
      { label: l.kind, value: l.kinds[e.kind] ?? e.kind },
      ...(e.app ? [{ label: l.from, value: e.app }] : []),
      { label: l.copied, value: age(e.copiedAt, options.now, options.locale) },
      ...(e.note ? [{ label: l.note, value: e.note }] : []),
    ];
    const item: LauncherItem = {
      id: e.id, title: title || '—',
      subtitle: [e.favorite ? '★' : '', e.app ?? '', age(e.copiedAt, options.now, options.locale), e.note ?? ''].filter(Boolean).join(' · '),
      icon: { symbol: e.kind === 'image' ? 'image' : e.kind === 'files' ? 'file' : url ? 'link' : 'text' },
      keywords: e.note ? [e.note] : [],
      detail: { ...(e.kind === 'image' ? {} : { text: e.text.slice(0, 8000) }), metadata: meta },
      actions: [
        { id: 'paste', title: l.paste },
        { id: 'copy', title: l.copy, shortcut: 'Cmd+C' },
        ...(e.kind === 'text' || e.kind === 'html' || e.kind === 'rtf' ? [{ id: 'plain', title: l.plain }] : []),
        { id: 'star', title: e.favorite ? l.unstar : l.star, shortcut: 'Cmd+S' },
        { id: 'delete', title: l.remove, style: 'destructive' as const },
      ],
    };
    if (e.kind === 'files' && e.files?.[0]) Object.assign(item, { type: 'file', data: e.files[0] });
    else if (e.kind === 'image') Object.assign(item, { type: 'image', data: `${options.blobs}/${e.hash}.png` });
    else if (e.text) Object.assign(item, { type: url ? 'url' : 'text', data: e.text.slice(0, 16000) });
    return item;
  });
}
