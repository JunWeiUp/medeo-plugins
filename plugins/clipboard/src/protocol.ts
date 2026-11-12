// Messages between the worker and the panel (channel.post, ≤ 1 MiB each).
import type { Entry, Filter } from './history.ts';
import type { Settings } from './settings.ts';

export type Row = Entry;
export interface State {
  ready: boolean;
  error: string | null;
  settings: Settings;
  /** Medeo may post ⌘V (Accessibility); null until checked. */
  trusted: boolean | null;
  /** Why the summon shortcut is not registered, if it is not. */
  shortcutError: string | null;
}
export type Request =
  | { type: 'hello' }
  | { type: 'paste'; id: string; plain?: boolean }
  | { type: 'copy'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'favorite'; id: string; favorite: boolean }
  | { type: 'note'; id: string; note: string }
  | { type: 'clear' }
  | { type: 'thumbs'; ids: string[] }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'grant' }
  | { type: 'hide' };
export type Reply =
  | { type: 'rows'; reset: boolean; rows: Row[] }
  | { type: 'added'; row: Row }
  | { type: 'updated'; row: Row }
  | { type: 'removed'; ids: string[] }
  | { type: 'thumb'; id: string; url: string | null }
  | { type: 'state'; state: State }
  /** The panel was summoned: start fresh on this category, or on the settings page. */
  | { type: 'opened'; filter: Filter; settings?: boolean }
  | { type: 'toast'; tone: 'success' | 'info' | 'error'; key: string; params?: Record<string, string> };
