// File system walking for the scan: allocated size (what deleting frees), never
// following links or crossing into another volume.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface Entry { name: string; path: string; directory: boolean; link: boolean }
export type Cancelled = () => boolean;

/** `com.apple.*` system data is TCC-protected since macOS 26: listing it pops an
 * authorization dialog, and it is the system's own anyway. Simulator device trees
 * are plain files whose caches are almost all named `com.apple.*`, so they keep them. */
export function skipsSystemData(directory: string, home: string): boolean {
  return !`${directory}/`.startsWith(`${home}/Library/Developer/CoreSimulator/Devices/`);
}
/** Direct children, or null when the directory cannot be read. */
export async function entries(directory: string, home: string): Promise<Entry[] | null> {
  let list;
  try { list = await readdir(directory, { withFileTypes: true }); } catch { return null; }
  const skip = skipsSystemData(directory, home);
  return list
    .filter(e => e.name !== '.DS_Store' && !(skip && e.name.startsWith('com.apple.')))
    .map(e => ({ name: e.name, path: path.join(directory, e.name), directory: e.isDirectory(), link: e.isSymbolicLink() }));
}
const allocated = (s: { blocks: number; size: number }) => (s.blocks ? s.blocks * 512 : s.size);

/** Bytes a removal would free, or -1 when the path is gone. Unreadable
 * subdirectories count as empty; the walk runs a bounded number of directories at once. */
export async function measure(root: string, cancelled: Cancelled = () => false): Promise<number> {
  const top = await lstat(root).catch(() => null);
  if (!top) return -1;
  let total = allocated(top);
  if (!top.isDirectory()) return total;
  const queue = [root];
  let active = 0;
  await new Promise<void>(resolve => {
    const pump = () => {
      if (cancelled()) queue.length = 0;
      if (!queue.length && !active) return resolve();
      while (active < 16 && queue.length) {
        const directory = queue.pop()!;
        active++;
        void visit(directory).finally(() => { active--; pump(); });
      }
    };
    const visit = async (directory: string) => {
      const names = await readdir(directory).catch(() => [] as string[]);
      for (let i = 0; i < names.length && !cancelled(); i += 256) {
        await Promise.all(names.slice(i, i + 256).map(async name => {
          const child = path.join(directory, name), s = await lstat(child).catch(() => null);
          if (!s) return;
          total += allocated(s);
          if (s.isDirectory() && s.dev === top.dev) queue.push(child);
        }));
      }
    };
    pump();
  });
  return total;
}
/** Expands `*` inside path segments (`~/Library/Caches/Google/Chrome*\/*\/Cache`). */
export async function glob(pattern: string, home: string): Promise<string[]> {
  const parts = pattern.split('/').filter(Boolean);
  let current = ['/'];
  for (const part of parts) {
    const next: string[] = [];
    if (!part.includes('*')) {
      for (const base of current) next.push(path.join(base, part));
    } else {
      const match = new RegExp(`^${part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      for (const base of current) for (const e of (await entries(base, home)) ?? []) if (!e.link && match.test(e.name)) next.push(e.path);
    }
    current = next;
    if (!current.length) break;
  }
  const exists = await Promise.all(current.map(p => lstat(p).then(() => true, () => false)));
  return current.filter((_, i) => exists[i]);
}
