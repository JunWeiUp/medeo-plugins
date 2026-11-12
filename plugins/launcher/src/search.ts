// Ranking for apps and plugin commands. Pure, no IO.
export interface Searchable { key: string; title: string; keywords?: string[] }

const words = (text: string) => text.toLowerCase().split(/[\s\-_.·/:()]+/).filter(Boolean);
/** "Visual Studio Code" → "vsc"; camelCase counts as words: "FaceTime" → "ft". */
export function initials(title: string): string {
  return title.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_.·/:()]+/).filter(Boolean).map(w => w[0].toLowerCase()).join('');
}
/** Characters of `query` appear in order in `text`; a tighter match scores higher (0..1). */
function subsequence(text: string, query: string): number {
  let at = -1, first = -1, gaps = 0;
  for (const c of query) {
    const next = text.indexOf(c, at + 1);
    if (next < 0) return 0;
    if (first < 0) first = next;
    else gaps += next - at - 1;
    at = next;
  }
  return 1 / (1 + gaps + first * 0.5);
}

/** How well `item` matches `query` (0 = no match). */
export function score(item: Searchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = item.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 90 - Math.min(9, title.length - q.length) * 0.1;
  const parts = words(item.title);
  if (parts.some(w => w.startsWith(q))) return 80;
  if (!q.includes(' ') && q.length >= 2 && initials(item.title).startsWith(q)) return 75;
  const qs = q.split(/\s+/).filter(Boolean);
  if (qs.length > 1 && qs.every(p => parts.some(w => w.startsWith(p)))) return 72;
  if (title.includes(q)) return 60;
  const keywords = (item.keywords ?? []).map(k => k.toLowerCase());
  if (keywords.some(k => k.startsWith(q))) return 55;
  if (qs.every(p => title.includes(p) || keywords.some(k => k.includes(p)))) return 45;
  const fuzzy = subsequence(title, q.replace(/\s+/g, ''));
  return q.length >= 2 && fuzzy > 0 ? 10 + fuzzy * 20 : 0;
}

/** Best matches first; within a score band the more often and recently used wins. */
export function rank<T extends Searchable>(items: T[], query: string, usage: Usage, limit = 40): T[] {
  const scored: [number, T][] = [];
  for (const item of items) {
    const s = score(item, query);
    if (s > 0) scored.push([s + usage.boost(item.key), item]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
  return scored.slice(0, limit).map(s => s[1]);
}

/** Launch counts with a recency decay, persisted by the caller as plain JSON. */
export class Usage {
  entries: Record<string, { count: number; last: number }>;
  private now: () => number;
  constructor(entries: Record<string, { count: number; last: number }> = {}, now = () => Date.now()) { this.entries = entries; this.now = now; }
  used(key: string) {
    const e = this.entries[key] ?? { count: 0, last: 0 };
    this.entries[key] = { count: Math.min(e.count + 1, 1000), last: this.now() };
    const keys = Object.keys(this.entries);
    if (keys.length > 500) {
      keys.sort((a, b) => this.entries[a].last - this.entries[b].last);
      for (const old of keys.slice(0, keys.length - 500)) delete this.entries[old];
    }
  }
  /** Up to ~8 points: enough to reorder close matches, never to beat a much better one. */
  boost(key: string): number {
    const e = this.entries[key];
    if (!e) return 0;
    const days = (this.now() - e.last) / 86_400_000;
    return Math.min(8, Math.log2(1 + e.count) * 2 / (1 + days / 7));
  }
  recent(limit: number): string[] {
    return Object.keys(this.entries).sort((a, b) => this.entries[b].last - this.entries[a].last).slice(0, limit);
  }
}
