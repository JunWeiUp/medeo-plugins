// Pure helpers for the Netdisk window (no SDK, tested with node --test).

export interface Entry { path: string; name: string; kind: 'file' | 'directory' | 'blocked' | 'link'; size: number; revision: string; modified_ms?: number | null }
export type SyncState = 'synced' | 'pending' | 'uploading' | 'downloading' | 'failed' | 'cloud' | 'unknown';
export interface FileState { state: SyncState; progress?: number; reason?: string }
/** A granted root and the Medeo Drive folder it lives in (`prefix` = its path inside that folder). */
export interface Link { root: string; folder: string; prefix: string }

/** `a/b` + `c` → `a/b/c`; `` + `c` → `c`. */
export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const parent = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
/** Breadcrumb parts of a path inside a root: `[{name, path}]`. */
export function crumbs(path: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let at = '';
  for (const part of path.split('/').filter(Boolean)) { at = join(at, part); out.push({ name: part, path: at }); }
  return out;
}

/** Folders first, then by name (natural, case-insensitive). Hidden (dot) entries dropped. */
export function sortEntries(entries: Entry[]): Entry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return entries
    .filter(e => !e.name.startsWith('.') && e.kind !== 'blocked' && e.kind !== 'link')
    .sort((a, b) => (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1) || collator.compare(a.name, b.name));
}
export const matches = (entry: Entry, query: string) => !query.trim() || entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function size(bytes: number): string {
  let n = bytes, i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${n} B` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ${UNITS[i]}`;
}
export const speed = (bytesPerSec: number) => `${size(bytesPerSec)}/s`;
/** Today → HH:MM; this year → M-D; else YYYY-M-D. */
export function when(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const d = new Date(ms), n = new Date(now), pad = (x: number) => String(x).padStart(2, '0');
  if (d.toDateString() === n.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === n.getFullYear() ? `${d.getMonth() + 1}-${d.getDate()}` : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Locale message with `{name}` placeholders. */
export const format = (template: string | undefined, params: Record<string, string | number> = {}) =>
  (template ?? '').replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));

/** Which drive folder a granted root belongs to, from its display path: the last path segment equal to a
 * folder's name decides, and whatever follows is the prefix. Null when the root is not inside one. */
export function linkFor(rootName: string, folders: { id: string; name: string }[]): { folder: string; prefix: string } | null {
  const parts = rootName.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const folder = folders.find(f => f.name === parts[i]);
    if (folder) return { folder: folder.id, prefix: parts.slice(i + 1).join('/') };
  }
  return null;
}
/** The path inside the drive folder for a path inside a linked root. */
export const drivePath = (link: Pick<Link, 'prefix'>, path: string) => join(link.prefix, path);

/** Whether the view still needs a refresh of sync states (something is moving). */
export const busy = (states: Record<string, FileState>) => Object.values(states).some(s => s.state === 'uploading' || s.state === 'downloading' || s.state === 'pending');

/** Plugin errors that mean "no Medeo Drive here" rather than a failure to show. */
export function unavailable(error: unknown): 'signed_out' | 'unsupported' | 'unavailable' | null {
  const code = String((error as Error)?.message ?? error).split(': ').pop() ?? '';
  if (code.endsWith('drive_signed_out')) return 'signed_out';
  if (code.endsWith('capability_unavailable') || code.endsWith('provider_unavailable')) return 'unsupported';
  if (/drive_unavailable|native_tray_(unavailable|timeout|busy)/.test(code)) return 'unavailable';
  return null;
}
/** Error code from an SDK rejection (`Error invoking …: Error: code` → `code`). */
export const code = (error: unknown) => String((error as Error)?.message ?? error).split('Error: ').pop()!.trim();

// ---------- v2: kinds, sorting, selection ----------
export type Kind = 'folder' | 'img' | 'video' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'fig' | 'zip' | 'txt' | 'code' | 'other';
const EXT: Record<string, Kind> = {
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', heic: 'img', bmp: 'img', tif: 'img', tiff: 'img', svg: 'img', psd: 'img',
  mov: 'video', mp4: 'video', m4v: 'video', avi: 'video', mkv: 'video', webm: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', aiff: 'audio',
  pdf: 'pdf', doc: 'doc', docx: 'doc', pages: 'doc', rtf: 'doc',
  xls: 'sheet', xlsx: 'sheet', numbers: 'sheet', csv: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides',
  fig: 'fig', sketch: 'fig', xd: 'fig',
  zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', dmg: 'zip',
  txt: 'txt', md: 'txt', log: 'txt',
  js: 'code', ts: 'code', json: 'code', html: 'code', css: 'code', py: 'code', swift: 'code', rs: 'code', sh: 'code',
};
export const ext = (name: string) => (name.includes('.') && !name.startsWith('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
export const kindOf = (entry: Pick<Entry, 'name' | 'kind'>): Kind => entry.kind === 'directory' ? 'folder' : EXT[ext(entry.name)] ?? 'other';
/** Badge text on a document icon: the extension, up to 4 letters. */
export const badgeText = (entry: Pick<Entry, 'name'>) => (ext(entry.name) || 'FILE').slice(0, 4).toUpperCase();

export type SortKey = 'name' | 'modified' | 'size' | 'kind';
export interface Sort { key: SortKey; desc: boolean }
/** Folders first; then by `sort`, name as the tie-breaker. Hidden, blocked and link entries dropped. */
export function arrange(entries: Entry[], sort: Sort = { key: 'name', desc: false }): Entry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const by = (a: Entry, b: Entry) => {
    switch (sort.key) {
      case 'modified': return (a.modified_ms ?? 0) - (b.modified_ms ?? 0);
      case 'size': return a.size - b.size;
      case 'kind': return collator.compare(kindOf(a) + ext(a.name), kindOf(b) + ext(b.name));
      default: return 0;
    }
  };
  return sortEntries(entries).sort((a, b) => {
    const dirs = (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1);
    if (dirs) return dirs;
    const order = by(a, b) || collator.compare(a.name, b.name);
    return sort.desc ? -order : order;
  });
}
/** Shift-click: everything between the anchor and the clicked item, in display order. */
export function range(order: string[], anchor: string | null, to: string): string[] {
  const a = anchor ? order.indexOf(anchor) : -1, b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
export const total = (entries: Entry[], paths: Iterable<string>) => { const set = new Set(paths); return entries.filter(e => set.has(e.path) && e.kind === 'file').reduce((n, e) => n + e.size, 0); };
/** A new folder name not yet taken: `name`, `name 2`, `name 3`… */
export function freeName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let n = 2; ; n++) if (!set.has(`${name} ${n}`)) return `${name} ${n}`;
}
/** Badge for a sync state in the icon corner. */
export function badge(st: FileState | undefined): { cls: string; glyph: string; progress?: number } | null {
  switch (st?.state) {
    case 'synced': return { cls: 'ok', glyph: '✓' };
    case 'failed': return { cls: 'bad', glyph: '!' };
    case 'cloud': return { cls: 'cloud', glyph: '☁' };
    case 'pending': return { cls: 'wait', glyph: '…' };
    case 'uploading': case 'downloading': return { cls: 'up', glyph: '', progress: Math.round((st.progress ?? 0) * 100) };
    default: return null;
  }
}

/** The file name a sent item is stored under. */
export function nameFor(input: { type: string; value: string; title?: string; file?: { name: string } }): string {
  if (input.file?.name) return input.file.name;
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (input.type === 'url') {
    let host = '';
    try { host = new URL(input.value).hostname; } catch { /* not a URL */ }
    return `${clean(input.title ?? '') || clean(host) || 'Link'}.webloc`;
  }
  return `${clean(input.title ?? '') || clean(input.value) || 'Text'}.txt`;
}
export const webloc = (url: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${url.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string></dict></plist>\n`;
