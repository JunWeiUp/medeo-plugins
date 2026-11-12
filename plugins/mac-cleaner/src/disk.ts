// Disk analysis, shared by the worker and the window (no Node imports here):
// the tree's shape, the slice of it the window shows, and the treemap layout.

export interface DiskNode {
  name: string;
  path: string;
  /** `other`: entries past the kept ones, summed; `restricted`: not read without asking (see analyze.ts). */
  kind: 'directory' | 'file' | 'other' | 'restricted';
  /** Allocated bytes: what removing it frees. */
  bytes: number;
  /** Files inside (1 for a file). */
  files: number;
  modified: number | null;
  /** Folders: largest first. Undefined on a folded (small) folder, which is walked again when opened. */
  children?: DiskNode[];
  /** `other`: how many entries it stands for. */
  count?: number;
  /** Still being walked: its size is growing and its entries are not trimmed yet. */
  pending?: true;
}
/** What the window draws: one folder, its entries and, for the treemap, their largest entries. */
export interface DiskEntry {
  name: string; path: string; kind: DiskNode['kind']; bytes: number; files: number; modified: number | null; count?: number;
  /** A folder whose entries are not known yet (folded or protected). */
  folded?: boolean;
  /** Still being counted. */
  pending?: boolean;
  /** Treemap detail: the folder's largest entries. */
  inner?: { name: string; kind: DiskNode['kind']; bytes: number }[];
}
export interface DiskView { path: string; name: string; bytes: number; files: number; pending: boolean; entries: DiskEntry[] }
export type DiskStatus = 'idle' | 'scanning' | 'opening' | 'done';
export interface DiskState {
  status: DiskStatus;
  /** The root of the last (or current) analysis. */
  root: string | null;
  includeProtected: boolean;
  /** Running totals while scanning, and the folder being read. */
  files: number; bytes: number; current: string;
  /** When the last analysis finished, and how long it took (ms). */
  finished: number | null; took: number | null;
  /** The user stopped it: the totals cover only what was read. */
  partial: boolean;
}
export const DISK_IDLE: DiskState = { status: 'idle', root: null, includeProtected: false, files: 0, bytes: 0, current: '', finished: null, took: null, partial: false };

const INNER = 12, INNER_FOR = 60, SHOWN = 300;
const largest = (list: DiskNode[]) => [...list].sort((a, b) => b.bytes - a.bytes);
/** The slice of one folder sent to the window; during a walk the lists are unsorted and untrimmed, so sort and cap here. */
export function view(node: DiskNode): DiskView {
  let list = largest(node.children ?? []);
  if (list.length > SHOWN) {
    const rest = list.slice(SHOWN - 1);
    list = list.slice(0, SHOWN - 1).concat({ name: '', path: `${node.path}/`, kind: 'other', modified: null, bytes: rest.reduce((n, c) => n + c.bytes, 0),
      files: rest.reduce((n, c) => n + c.files, 0), count: rest.reduce((n, c) => n + (c.kind === 'other' ? c.count ?? 0 : 1), 0) });
  }
  const entries = list.map((c, i): DiskEntry => {
    const e: DiskEntry = { name: c.name, path: c.path, kind: c.kind, bytes: c.bytes, files: c.files, modified: c.modified };
    if (c.count !== undefined) e.count = c.count;
    if (c.kind === 'restricted' || c.kind === 'directory' && !c.children) e.folded = true;
    if (c.pending) e.pending = true;
    if (c.children && i < INNER_FOR) e.inner = largest(c.children).slice(0, INNER).map(g => ({ name: g.name, kind: g.kind, bytes: g.bytes }));
    return e;
  });
  return { path: node.path, name: node.name, bytes: node.bytes, files: node.files, pending: !!node.pending, entries };
}

export interface Rect { x: number; y: number; w: number; h: number }
/** Squarified treemap (Bruls et al.): rectangles for `sizes` (largest first) filling `box`, in the same order. */
export function squarify(sizes: number[], box: Rect): Rect[] {
  const out: Rect[] = new Array(sizes.length);
  const sum = sizes.reduce((n, s) => n + Math.max(0, s), 0);
  if (!sum || box.w <= 0 || box.h <= 0) return sizes.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const scale = (box.w * box.h) / sum, area = sizes.map(s => Math.max(0, s) * scale);
  let { x, y, w, h } = box, i = 0;
  const worst = (row: number[], side: number) => {
    const s = row.reduce((n, a) => n + a, 0), max = Math.max(...row), min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < area.length) {
    const side = Math.min(w, h), row = [area[i]];
    let j = i + 1;
    while (j < area.length && area[j] > 0 && worst([...row, area[j]], side) <= worst(row, side)) row.push(area[j++]);
    const s = row.reduce((n, a) => n + a, 0);
    // Lay the row along the shorter side, then shrink the box.
    if (w >= h) {
      const width = h ? s / h : 0;
      let yy = y;
      for (let k = 0; k < row.length; k++) { const hh = width ? row[k] / width : 0; out[i + k] = { x, y: yy, w: width, h: hh }; yy += hh; }
      x += width; w -= width;
    } else {
      const height = w ? s / w : 0;
      let xx = x;
      for (let k = 0; k < row.length; k++) { const ww = height ? row[k] / height : 0; out[i + k] = { x: xx, y, w: ww, h: height }; xx += ww; }
      y += height; h -= height;
    }
    i = j;
    // Zero-size entries left at the end get empty boxes.
    while (i < area.length && area[i] <= 0) out[i++] = { x, y, w: 0, h: 0 };
  }
  return out;
}

/** Breadcrumb from the analysis root down to `target`: [{name, path}]. */
export function crumbs(root: string, target: string): { name: string; path: string }[] {
  const out = [{ name: root === '/' ? '/' : root.split('/').pop() || root, path: root }];
  if (target === root || !target.startsWith(root === '/' ? '/' : `${root}/`)) return out;
  let at = root;
  for (const part of target.slice(root === '/' ? 1 : root.length + 1).split('/').filter(Boolean)) {
    at = at === '/' ? `/${part}` : `${at}/${part}`;
    out.push({ name: part, path: at });
  }
  return out;
}
/** Treemap colour for an entry: folders by position, files by type. */
const EXT: [RegExp, string][] = [
  [/\.(mov|mp4|m4v|avi|mkv|webm|mpg)$/i, '#ff375f'], [/\.(jpe?g|png|gif|heic|tiff?|raw|cr2|nef|psd|webp)$/i, '#ff9f0a'],
  [/\.(mp3|m4a|aac|wav|flac|aiff?)$/i, '#bf5af2'], [/\.(zip|rar|7z|tar|t?gz|bz2|xz|dmg|iso|pkg|ipa)$/i, '#ac8e68'],
  [/\.(app|dylib|so|o|a|framework)$/i, '#64d2ff'],
];
export const PALETTE = ['#0a84ff', '#30d158', '#5e5ce6', '#ffd60a', '#40c8e0', '#ff6961', '#66d4cf', '#d4a017', '#9b87f5', '#7dc95e'];
export function tint(kind: DiskNode['kind'], name: string, index: number): string {
  if (kind === 'other' || kind === 'restricted') return '#8e8e93';
  if (kind === 'file') return EXT.find(([re]) => re.test(name))?.[1] ?? '#98989d';
  return PALETTE[index % PALETTE.length];
}
