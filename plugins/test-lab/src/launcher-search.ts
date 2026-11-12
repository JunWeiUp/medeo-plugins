// Launcher ranking: plugin policy, not Host behavior. Pure, no IO.
export interface Searchable { id: string; title: string; path: string; bundle_id: string }
/** Exact title, title prefix, title substring, then every word anywhere; recent first within a score. */
export function search<T extends Searchable>(entries: T[], query: string, recent: Map<string, number>, limit = 100): T[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const scored: [number, number, T][] = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase(), detail = `${entry.bundle_id} · ${entry.path}`.toLowerCase();
    let score: number;
    if (!q) score = 0;
    else if (title === q) score = 4;
    else if (title.startsWith(q)) score = 3;
    else if (title.includes(q)) score = 2;
    else if (words.every(w => title.includes(w) || detail.includes(w))) score = 1;
    else continue;
    scored.push([score, recent.get(entry.path) ?? 0, entry]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2].title.toLowerCase().localeCompare(b[2].title.toLowerCase()));
  return scored.slice(0, limit).map(s => s[2]);
}
/** Session recency, bounded like the native launcher's history. */
export class Recent {
  private sequence = 0;
  readonly order = new Map<string, number>();
  used(path: string) {
    this.order.set(path, ++this.sequence);
    if (this.order.size > 1000) {
      const oldest = [...this.order.entries()].sort((a, b) => a[1] - b[1])[0][0];
      this.order.delete(oldest);
    }
  }
}
