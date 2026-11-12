// The history itself, as plain data: dedupe, order, prune, filter, search. No Node or
// SDK imports, so the window can share the filters and `node --test` covers it all.

export type Kind = 'text' | 'html' | 'rtf' | 'image' | 'files';
export type Filter = 'all' | 'text' | 'rich' | 'image' | 'files' | 'favorite';
export const FILTERS: Filter[] = ['all', 'text', 'rich', 'image', 'files', 'favorite'];

export interface Entry {
  id: string;
  kind: Kind;
  /** sha256 of the kind and its content: the same copy twice is one entry. */
  hash: string;
  /** Plain text to search and show (paths for files), at most SEARCH_CHARS. */
  text: string;
  /** Characters of text, or bytes of an image. */
  size: number;
  files?: string[];
  width?: number;
  height?: number;
  app: string | null;
  bundle: string | null;
  createdAt: number;
  /** Last time it was copied; the list is ordered by this. */
  copiedAt: number;
  /** Starred entries are never pruned. */
  favorite?: boolean;
  note?: string;
}

export const SEARCH_CHARS = 4000;
export const NOTE_CHARS = 500;
export interface Limits { maxItems: number; maxAgeMs: number }
export const LIMITS: Limits = { maxItems: 1000, maxAgeMs: 30 * 24 * 3600 * 1000 };

export const filterOf = (kind: Kind): Exclude<Filter, 'all' | 'favorite'> => kind === 'html' || kind === 'rtf' ? 'rich' : kind;
export const matchesFilter = (entry: Entry, filter: Filter) => filter === 'all' || (filter === 'favorite' ? !!entry.favorite : filterOf(entry.kind) === filter);

/** Every word must appear (case-insensitive) in the text, a file path, the note or the app. */
export function matchesQuery(entry: Entry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${entry.text}\n${entry.note ?? ''}\n${entry.app ?? ''}`.toLowerCase();
  return words.every(w => haystack.includes(w));
}
export const search = (entries: Entry[], query: string, filter: Filter) => entries.filter(e => matchesFilter(e, filter) && matchesQuery(e, query));
export function counts(entries: Entry[]): Record<Filter, number> {
  const out: Record<Filter, number> = { all: entries.length, text: 0, rich: 0, image: 0, files: 0, favorite: 0 };
  for (const e of entries) { out[filterOf(e.kind)]++; if (e.favorite) out.favorite++; }
  return out;
}

/** Newest first. A copy already in the history moves to the top and keeps its id and origin. */
export function upsert(entries: Entry[], incoming: Entry): { entries: Entry[]; entry: Entry; duplicate: boolean } {
  const old = entries.find(e => e.hash === incoming.hash);
  const entry = old ? { ...old, copiedAt: incoming.copiedAt } : incoming;
  return { entries: [entry, ...entries.filter(e => e !== old)], entry, duplicate: !!old };
}

/** Drops what is past the age or count limit (favorites never, nor do they count); returns the survivors and the dropped. */
export function prune(entries: Entry[], now: number, limits = LIMITS): { kept: Entry[]; removed: Entry[] } {
  const kept: Entry[] = [], removed: Entry[] = [];
  let count = 0;
  for (const e of [...entries].sort((a, b) => b.copiedAt - a.copiedAt)) {
    if (e.favorite) kept.push(e);
    else if (count < limits.maxItems && now - e.copiedAt <= limits.maxAgeMs) { kept.push(e); count++; }
    else removed.push(e);
  }
  return { kept, removed };
}

/** Patches an entry's star or note; null when the id is unknown. */
export function annotate(entries: Entry[], id: string, patch: { favorite?: boolean; note?: string }): Entry[] | null {
  if (!entries.some(e => e.id === id)) return null;
  return entries.map(e => {
    if (e.id !== id) return e;
    const next = { ...e };
    if (patch.favorite !== undefined) { if (patch.favorite) next.favorite = true; else delete next.favorite; }
    if (patch.note !== undefined) { const note = patch.note.trim().slice(0, NOTE_CHARS); if (note) next.note = note; else delete next.note; }
    return next;
  });
}

/** The first lines of an entry, whitespace runs folded, for a two-line row. */
export function preview(text: string, max = 280): string {
  const folded = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n[\s]*/g, '\n').trim();
  return folded.length > max ? `${folded.slice(0, max)}…` : folded;
}
export const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/** Rough visible text of an HTML fragment, for entries copied without a plain-text flavor. */
export function htmlText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
