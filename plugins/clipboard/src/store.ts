// The history on disk, under the plugin's private storagePath:
//   history.json            the entries (metadata and search text), newest first
//   blobs/<hash>.json       full text / HTML / RTF of an entry
//   blobs/<hash>.png        an image, with blobs/<hash>.thumb.jpg for its row
//   incoming/               where the pasteboard helper drops images and write requests
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { annotate, htmlText, LIMITS, prune, SEARCH_CHARS, upsert, type Entry, type Kind, type Limits } from './history.ts';

/** One line of `pasteboard.js watch`. */
export interface Copy {
  count?: string; types?: string[]; app?: string | null; bundle?: string | null;
  text?: string | null; html?: string | null; rtf?: string | null; image?: string; files?: string[];
  skipped?: string; error?: string; ready?: string;
}
/** What `pasteboard.js write` puts back. */
export interface Body { text?: string | null; html?: string | null; rtf?: string | null; image?: string; files?: string[] }

const sha = (kind: Kind, content: string | Buffer) => createHash('sha256').update(kind).update('\0').update(content).digest('hex');
const run = (exe: string, args: string[]) => new Promise<string | null>(resolve =>
  execFile(exe, args, { timeout: 15_000 }, (error, stdout) => resolve(error ? null : String(stdout))));

export class Store {
  entries: Entry[] = [];
  readonly dir: string;
  readonly blobs: string;
  readonly incoming: string;
  private readonly now: () => number;
  private limits: Limits = LIMITS;
  private saving: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string, now = () => Date.now()) {
    this.dir = dir; this.now = now;
    this.blobs = path.join(dir, 'blobs');
    this.incoming = path.join(dir, 'incoming');
  }

  async load(): Promise<void> {
    await mkdir(this.blobs, { recursive: true });
    await rm(this.incoming, { recursive: true, force: true });
    await mkdir(this.incoming, { recursive: true });
    try {
      const data = JSON.parse(await readFile(path.join(this.dir, 'history.json'), 'utf8'));
      this.entries = Array.isArray(data?.entries) ? data.entries.filter((e: Entry) => e && typeof e.hash === 'string') : [];
    } catch { this.entries = []; }
    await this.trim();
  }

  /** Turns a copy into an entry, or null when there is nothing worth keeping. */
  async ingest(copy: Copy): Promise<{ entry: Entry; duplicate: boolean; removed: Entry[] } | null> {
    if (copy.skipped || copy.error || copy.ready !== undefined) return null;
    const at = this.now();
    const base = { id: randomUUID(), app: copy.app ?? null, bundle: copy.bundle ?? null, createdAt: at, copiedAt: at };
    let entry: Entry, body: Body | null = null;
    if (copy.files?.length) {
      const joined = copy.files.join('\n');
      entry = { ...base, kind: 'files', hash: sha('files', joined), text: joined.slice(0, SEARCH_CHARS), size: copy.files.length, files: copy.files };
    } else if (copy.image) {
      const bytes = await readFile(copy.image).catch(() => null);
      if (!bytes?.length) return null;
      const hash = sha('image', bytes), file = path.join(this.blobs, `${hash}.png`);
      await rename(copy.image, file);
      const dims = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
      const width = Number(/pixelWidth: (\d+)/.exec(dims ?? '')?.[1]) || undefined, height = Number(/pixelHeight: (\d+)/.exec(dims ?? '')?.[1]) || undefined;
      await run('/usr/bin/sips', ['-Z', '240', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', file, '--out', path.join(this.blobs, `${hash}.thumb.jpg`)]);
      entry = { ...base, kind: 'image', hash, text: '', size: bytes.length, width, height };
    } else {
      const kind: Kind = copy.html ? 'html' : copy.rtf ? 'rtf' : 'text';
      const text = copy.text ?? (copy.html ? htmlText(copy.html) : '');
      if (!text.trim() && !copy.html && !copy.rtf) return null;
      const content = kind === 'html' ? copy.html! : kind === 'rtf' ? copy.rtf! : text;
      entry = { ...base, kind, hash: sha(kind, content), text: text.slice(0, SEARCH_CHARS), size: [...text].length };
      body = { text, html: copy.html ?? null, rtf: copy.rtf ?? null };
    }
    const result = upsert(this.entries, entry);
    if (!result.duplicate && body) await writeFile(path.join(this.blobs, `${entry.hash}.json`), JSON.stringify(body));
    this.entries = result.entries;
    const removed = await this.trim();
    this.save();
    return { entry: result.entry, duplicate: result.duplicate, removed };
  }

  /** What to put back on the pasteboard for an entry. */
  async body(entry: Entry): Promise<Body | null> {
    if (entry.kind === 'files') return { files: entry.files ?? [] };
    if (entry.kind === 'image') return { image: path.join(this.blobs, `${entry.hash}.png`) };
    try { return JSON.parse(await readFile(path.join(this.blobs, `${entry.hash}.json`), 'utf8')); }
    catch { return entry.kind === 'text' ? { text: entry.text } : null; }
  }

  async thumbnail(entry: Entry): Promise<string | null> {
    if (entry.kind !== 'image') return null;
    const bytes = await readFile(path.join(this.blobs, `${entry.hash}.thumb.jpg`)).catch(() => null);
    return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
  }

  async remove(ids: string[] | 'all'): Promise<Entry[]> {
    const gone = ids === 'all' ? this.entries : this.entries.filter(e => ids.includes(e.id));
    this.entries = this.entries.filter(e => !gone.includes(e));
    await this.sweep();
    this.save();
    return gone;
  }

  /** Stars or annotates an entry; the updated entry, or null when it is gone. */
  annotate(id: string, patch: { favorite?: boolean; note?: string }): Entry | null {
    const next = annotate(this.entries, id, patch);
    if (!next) return null;
    this.entries = next;
    this.save();
    return next.find(e => e.id === id)!;
  }

  /** New limits apply at once; returns what they pruned. */
  async setLimits(limits: Limits): Promise<Entry[]> {
    this.limits = limits;
    return this.trim();
  }

  /** Applies the age and count limits. */
  private async trim(): Promise<Entry[]> {
    const { kept, removed } = prune(this.entries, this.now(), this.limits);
    this.entries = kept;
    if (removed.length) { await this.sweep(); this.save(); }
    return removed;
  }

  /** Deletes blobs no entry refers to any more. */
  private async sweep(): Promise<void> {
    const live = new Set(this.entries.map(e => e.hash));
    for (const name of await readdir(this.blobs).catch(() => [] as string[])) {
      if (!live.has(name.split('.')[0])) await rm(path.join(this.blobs, name), { force: true });
    }
  }

  /** Coalesced, atomic write of history.json. */
  save(): void {
    this.timer ??= setTimeout(() => { this.timer = null; void this.flush(); }, 300);
  }
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const data = JSON.stringify({ version: 1, entries: this.entries });
    this.saving = this.saving.then(async () => {
      const tmp = path.join(this.dir, 'history.json.tmp');
      await writeFile(tmp, data);
      await rename(tmp, path.join(this.dir, 'history.json'));
    }).catch(error => console.error('saving history failed:', error));
    return this.saving;
  }
}
