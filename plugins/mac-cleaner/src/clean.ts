// Removing what the user selected: to the Trash (the default, reversible) or for
// good; command items run the tool's own clean. Everything is re-checked here.
import { lstat, rm } from 'node:fs/promises';
import { COMMAND_RULES } from './catalog.ts';
import { isProtected } from './protect.ts';
import { run as runTool, type RunResult } from './tools.ts';
import type { Item } from './scan.ts';
import { git as runGit, running as runningNow, type Guard } from './agents.ts';

export type Method = 'trash' | 'delete';
export interface Outcome { id: string; ok: boolean; freed: number; error?: string }
export interface TrashResult { path: string; trashed: boolean; error?: string }
export interface CleanDeps {
  home: string;
  trash(paths: string[]): Promise<TrashResult[]>;
  run?: (executable: string, args: string[], home: string) => Promise<RunResult>;
  /** Apps running now (checked once per clean); items of a running app are skipped. */
  running?: () => Promise<Set<Guard>>;
  git?: (args: string[]) => Promise<string | null>;
}
/** A platform request is at most 64 KiB, and `trash` takes at most 256 paths. */
export function trashBatches(paths: string[], maxBytes = 48 * 1024, maxPaths = 256): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [], size = 0;
  for (const p of paths) {
    const bytes = Buffer.byteLength(JSON.stringify(p)) + 1;
    if (batch.length && (batch.length >= maxPaths || size + bytes > maxBytes)) { batches.push(batch); batch = []; size = 0; }
    batch.push(p); size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
const exists = (p: string) => lstat(p).then(() => true, () => false);

export async function clean(items: Item[], method: Method, deps: CleanDeps, progress: (done: number) => void = () => {}): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let done = 0;
  const finish = (o: Outcome) => { outcomes.push(o); progress(++done); };
  const toTrash: Item[] = [];
  const live = items.some(i => i.guard) ? await (deps.running ?? runningNow)() : new Set<Guard>();
  for (const item of items) {
    if (item.guard && live.has(item.guard)) { finish({ id: item.id, ok: false, freed: 0, error: 'running' }); continue; }
    if (item.kind === 'command') {
      const rule = COMMAND_RULES.find(r => r.id === item.rule);
      if (!rule) { finish({ id: item.id, ok: false, freed: 0, error: 'unknown_rule' }); continue; }
      const result = await (deps.run ?? runTool)(item.path, rule.arguments, deps.home);
      finish({ id: item.id, ok: result.code === 0, freed: result.code === 0 ? item.bytes : 0, error: result.code === 0 ? undefined : result.output || `exit ${result.code}` });
      continue;
    }
    if (isProtected(item.path, deps.home)) { finish({ id: item.id, ok: false, freed: 0, error: 'protected' }); continue; }
    if (!await exists(item.path)) { finish({ id: item.id, ok: true, freed: 0 }); continue; }
    // What is already in the Trash can only be removed for good.
    if (method === 'delete' || item.path.startsWith(`${deps.home}/.Trash/`)) {
      try { await rm(item.path, { recursive: true, force: true }); finish({ id: item.id, ok: true, freed: item.bytes }); }
      catch (error) { finish({ id: item.id, ok: false, freed: 0, error: (error as NodeJS.ErrnoException).code ?? String(error) }); }
    } else toTrash.push(item);
  }
  const byPath = new Map(toTrash.map(i => [i.path, i]));
  for (const batch of trashBatches(toTrash.map(i => i.path))) {
    let results: TrashResult[];
    try { results = await deps.trash(batch); }
    catch (error) { results = batch.map(p => ({ path: p, trashed: false, error: error instanceof Error ? error.message : String(error) })); }
    for (const r of results) {
      const item = byPath.get(r.path);
      if (item) finish({ id: item.id, ok: r.trashed, freed: r.trashed ? item.bytes : 0, error: r.trashed ? undefined : r.error ?? 'trash_failed' });
    }
  }
  // A removed worktree is forgotten by its repository too.
  const pruned = new Set<string>();
  for (const item of items) {
    if (!item.prune || pruned.has(item.prune) || !outcomes.find(o => o.id === item.id)?.ok) continue;
    pruned.add(item.prune);
    await (deps.git ?? runGit)(['--git-dir', item.prune, 'worktree', 'prune']);
  }
  return outcomes;
}
