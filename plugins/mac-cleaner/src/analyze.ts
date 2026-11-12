// Disk analysis, after DaisyDisk: the size of every folder under a root, by
// allocated blocks, never following links or leaving the root's volume. Small
// folders are folded (walked again when opened) so a whole disk fits in memory.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Cancelled } from './files.ts';
import type { DiskNode } from './disk.ts';

export type { DiskNode } from './disk.ts';
/** Folders smaller than this keep no children; opening one walks it again. */
export const FOLD_BYTES = 2 * 1024 * 1024;
/** Kept entries per folder: the largest `ALWAYS_KEPT`, then any as big as `KEEP_BYTES`,
 * at most `MAX_CHILDREN`; the rest are summed into one "smaller items" entry. */
export const MAX_CHILDREN = 200, ALWAYS_KEPT = 30, KEEP_BYTES = 512 * 1024;
/** Data volume of a split system install: `/Users` and friends are firmlinked into `/`. */
const DATA_VOLUME = '/System/Volumes/Data';

/** Reading these asks the user for access (macOS "data from other apps", Photos,
 * Mail…), so they are counted only when asked for. Relative to the home folder. */
export const PROTECTED = ['Library/Containers', 'Library/Group Containers', 'Library/Daemon Containers', 'Library/Mail', 'Library/Messages',
  'Library/Safari', 'Library/Cookies', 'Library/HomeKit', 'Library/Calendars', 'Library/Reminders', 'Library/Suggestions', 'Library/Biome',
  'Library/Accounts', 'Library/IdentityServices', 'Library/Sharing', 'Library/PersonalizationPortrait', 'Library/Metadata/CoreSpotlight',
  'Library/Application Support/AddressBook', 'Library/Application Support/CallHistoryDB', 'Library/Application Support/CallHistoryTransactions',
  'Library/Application Support/com.apple.TCC', 'Library/Application Support/FaceTime', 'Library/Application Support/Knowledge'];
export function restricted(p: string, home: string): boolean {
  if (p.endsWith('.photoslibrary')) return true;
  if (!p.startsWith(`${home}/`)) return false;
  const rel = p.slice(home.length + 1);
  if (PROTECTED.includes(rel)) return true;
  // `com.apple.*` system data under Library is TCC-protected since macOS 26 (as in files.ts), simulators excepted.
  return rel.startsWith('Library/') && path.basename(p).startsWith('com.apple.') && !rel.startsWith('Library/Developer/CoreSimulator/');
}

export interface AnalyzeOptions {
  root: string; home: string;
  /** Walk the locations that ask for access too. */
  includeProtected: boolean;
  cancelled: Cancelled;
  /** Called after each folder is read: running totals and the folder. */
  progress?: (files: number, bytes: number, folder: string) => void;
  /** The tree as soon as the walk starts; it fills in while the walk runs. */
  live?: (root: DiskNode) => void;
}
const allocated = (s: { blocks: number; size: number }) => (s.blocks ? s.blocks * 512 : s.size);

/** Runs at most `n` tasks at once. A folder holds a slot only while reading, never while its children walk.
 * The newest waiter goes first, so the walk runs depth first and few folders are open at a time. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try { return await task(); } finally { active--; waiting.pop()?.(); }
  };
}

/** Largest first; what is not kept (see `MAX_CHILDREN`) becomes one `other` entry. */
export function trim(children: DiskNode[], parent: string): DiskNode[] {
  const list = children.filter(c => c.kind !== 'other').sort((a, b) => b.bytes - a.bytes);
  const kept: DiskNode[] = [], rest = children.filter(c => c.kind === 'other');
  // Protected folders have no size yet but must stay openable.
  for (const [i, c] of list.entries()) (kept.length < MAX_CHILDREN - 1 && (i < ALWAYS_KEPT || c.bytes >= KEEP_BYTES || c.kind === 'restricted') ? kept : rest).push(c);
  if (rest.length === 1) kept.push(rest[0]);
  if (rest.length <= 1) return kept.sort((a, b) => b.bytes - a.bytes);
  const count = rest.reduce((n, c) => n + (c.kind === 'other' ? c.count ?? 0 : 1), 0);
  kept.push({ name: '', path: `${parent}/`, kind: 'other', bytes: rest.reduce((n, c) => n + c.bytes, 0), files: rest.reduce((n, c) => n + c.files, 0), modified: null, count });
  return kept.sort((a, b) => b.bytes - a.bytes);
}

/** The tree under `root`, or null when it cannot be read at all. */
export async function analyze(opts: AnalyzeOptions): Promise<DiskNode | null> {
  const root = opts.root.length > 1 ? opts.root.replace(/\/+$/, '') : opts.root;
  const top = await lstat(root).catch(() => null);
  if (!top) return null;
  const node = (p: string, s: { mtimeMs: number }, kind: DiskNode['kind'], bytes: number): DiskNode =>
    ({ name: path.basename(p) || p, path: p, kind, bytes, files: kind === 'file' ? 1 : 0, modified: Math.round(s.mtimeMs) });
  if (!top.isDirectory()) return node(root, top, 'file', allocated(top));
  const devices = new Set([top.dev]);
  if (root === '/') { const data = await lstat(DATA_VOLUME).catch(() => null); if (data) devices.add(data.dev); }
  // Hard links count once, as in `du`.
  const linked = new Set<string>();
  const run = limiter(24);
  let files = 0, bytes = 0;

  // Folders hang in the tree as soon as they are found and sizes add up the chain
  // above as each folder is read, so the tree is a live picture while it grows.
  type Up = { node: DiskNode; up: Up } | null;
  type Self = { mtimeMs: number; blocks: number; size: number };
  const walk = async (folder: DiskNode, up: Up, depth: number, self: Self): Promise<DiskNode> => {
    const link = { node: folder, up }, subdirs: [DiskNode, Self][] = [];
    await run(async () => {
      const dir = folder.path, names = opts.cancelled() ? [] : await readdir(dir).catch(() => [] as string[]);
      const kept: DiskNode[] = [];
      let found = allocated(self), count = 0;
      for (let i = 0; i < names.length && !opts.cancelled(); i += 256) {
        await Promise.all(names.slice(i, i + 256).map(async name => {
          const p = dir === '/' ? `/${name}` : `${dir}/${name}`, s = await lstat(p).catch(() => null);
          if (!s) return;
          if (s.isDirectory()) {
            if (!devices.has(s.dev) || p === DATA_VOLUME) return;
            if (!opts.includeProtected && restricted(p, opts.home)) { kept.push(node(p, s, 'restricted', 0)); return; }
            subdirs.push([{ ...node(p, s, 'directory', 0), children: [], pending: true }, { mtimeMs: s.mtimeMs, blocks: s.blocks, size: s.size }]); return;
          }
          let size = allocated(s);
          if (s.nlink > 1 && !s.isSymbolicLink()) { const key = `${s.dev}:${s.ino}`; if (linked.has(key)) size = 0; else linked.add(key); }
          count++; found += size;
          kept.push(node(p, s, 'file', size));
        }));
      }
      for (let u: Up = link; u; u = u.up) { u.node.bytes += found; u.node.files += count; }
      files += count; bytes += found;
      // Only the largest files stay while the subfolders walk.
      folder.children!.push(...trim(kept, dir), ...subdirs.map(([n]) => n));
      opts.progress?.(files, bytes, dir);
    });
    await Promise.all(subdirs.map(([n, s]) => walk(n, link, depth + 1, s)));
    delete folder.pending;
    // A small folder keeps only its totals; the root of a walk always keeps its children.
    folder.children = depth > 0 && folder.bytes < FOLD_BYTES ? undefined : trim(folder.children!, folder.path);
    return folder;
  };
  const tree: DiskNode = { ...node(root, top, 'directory', 0), children: [], pending: true };
  opts.live?.(tree);
  return walk(tree, null, 0, top);
}

/** The node at `target` and the folders above it, root first; null when not in the tree. */
export function locate(root: DiskNode, target: string): DiskNode[] | null {
  const trail = [root];
  let at = root;
  while (at.path !== target) {
    const next = at.children?.find(c => c.kind !== 'other' && (target === c.path || target.startsWith(c.path === '/' ? '/' : `${c.path}/`)));
    if (!next) return null;
    trail.push(next); at = next;
  }
  return trail;
}
/** Puts a fresh walk of a folder in place of the old one, keeping the totals above it right. */
export function graft(root: DiskNode, fresh: DiskNode): boolean {
  const trail = locate(root, fresh.path);
  if (!trail) return false;
  const old = trail[trail.length - 1];
  if (old === root) { Object.assign(root, fresh); return true; }
  const parent = trail[trail.length - 2], db = fresh.bytes - old.bytes, df = fresh.files - old.files;
  parent.children = parent.children!.map(c => (c === old ? fresh : c));
  for (const n of trail.slice(0, -1)) { n.bytes += db; n.files += df; }
  return true;
}
/** Drops a removed entry and subtracts it from every folder above. */
export function prune(root: DiskNode, target: string): DiskNode | null {
  const trail = locate(root, target);
  if (!trail || trail.length < 2) return null;
  const gone = trail[trail.length - 1], parent = trail[trail.length - 2];
  parent.children = parent.children!.filter(c => c !== gone);
  for (const n of trail.slice(0, -1)) { n.bytes -= gone.bytes; n.files -= gone.files; }
  return gone;
}
