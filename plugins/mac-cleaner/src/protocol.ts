// Messages between the Node worker (which scans and cleans) and the window.
import type { RootSuggestion } from './project-roots.ts';
import type { Method, Outcome } from './clean.ts';
import type { Item, Scope } from './scan.ts';
import type { DiskState, DiskView } from './disk.ts';

export type Status = 'idle' | 'scanning' | 'cleaning' | 'done';
/** Everything but the items, which travel separately (`items` / `removed`). */
export interface State {
  status: Status;
  /** Shown as `~` in paths. */
  home: string;
  /** The scope being scanned, or last scanned. */
  scope: Scope;
  /** When each scope last finished a scan. */
  scanned: Record<Scope, number | null>;
  /** Project folders scanned for build artifacts, as configured. */
  roots: string[];
  /** Common project folders that exist and are not added yet. */
  suggestions: RootSuggestion[];
  picking: boolean;
  method: Method;
  /** Whether the tools' own clean commands are offered. */
  commands: boolean;
  /** Codex sessions older than this many days are listed. */
  sessionDays: number;
  progress: { done: number; total: number };
  outcomes: Outcome[];
  /** The home volume, in bytes. */
  free: number | null;
  capacity: number | null;
}
export type Request =
  | { type: 'hello' }
  | { type: 'scan'; scope: Scope }
  | { type: 'cancel' }
  | { type: 'clean'; ids: string[]; method: Method }
  | { type: 'roots'; action: 'add' | 'remove'; roots: string[] }
  | { type: 'choose-roots' }
  | { type: 'settings'; method?: Method; commands?: boolean; sessionDays?: number }
  /** Context menu actions on one item. */
  | { type: 'item'; action: 'reveal' | 'terminal' | 'copy' | 'trash'; id: string }
  /** Disk analysis: walk a folder (absolute path), or pick one first; open a folder in the tree; act on an entry. */
  | { type: 'disk-scan'; root: string; includeProtected: boolean }
  | { type: 'disk-choose'; includeProtected: boolean }
  | { type: 'disk-cancel' }
  | { type: 'disk-open'; path: string }
  | { type: 'disk-item'; action: 'reveal' | 'terminal' | 'copy' | 'trash'; path: string };
/** Items arrive in chunks under the 1 MiB channel limit; `reset` drops a scope's (or every) earlier item first. */
export type Reply =
  | { type: 'state'; state: State }
  | { type: 'items'; reset: Scope | 'all' | null; items: Item[] }
  | { type: 'removed'; ids: string[] }
  /** A short notice at the bottom of the window: a catalog key and its placeholders. */
  | { type: 'toast'; tone: 'success' | 'info' | 'error'; key: string; params?: Record<string, string> }
  | { type: 'disk'; state: DiskState }
  /** The folder the disk analysis shows now. */
  | { type: 'disk-view'; view: DiskView };
