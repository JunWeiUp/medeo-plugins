// The scan: every path rule, the build artifacts under the user's project
// folders, and the tools' own clean commands, reported item by item as measured.
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { COMMAND_RULES, PATH_RULES, type PathRule, type Risk } from './catalog.ts';
import { resolvePath, type Env } from './env.ts';
import { entries, glob, measure, type Cancelled } from './files.ts';
import { isProtected } from './protect.ts';
import { locate } from './tools.ts';
import { appJunk, appleLanguages, APP_ROOTS, discoverApps, unusedLocalizations } from './apps.ts';
import { claudeTargets, codexBuild, codexTargets, git, running, type AgentDeps, type Guard } from './agents.ts';

import { scopeOf, type Scope } from './scope.ts';
export { GENERAL_CATEGORIES, scopeOf, type Scope } from './scope.ts';
export const INSTALLER_EXTENSIONS = ['dmg', 'iso', 'pkg', 'ipa'];
export const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'tgz', 'gz', 'bz2', 'xz'];

export interface Item {
  /** Stable within a scan: the rule and the path (or the command). */
  id: string;
  rule: string;
  category: string;
  risk: Risk;
  kind: 'path' | 'command';
  /** The path to remove, or the executable a command runs. */
  path: string;
  /** Child or glob name; empty for a directory rule (shown with the rule title). */
  name: string;
  bytes: number;
  /** When the item itself last changed (ms); null for commands. */
  modified: number | null;
  /** Command items: the command line shown to the user. */
  command?: string;
  /** App junk and localizations: the app they belong to. */
  app?: string;
  /** Localizations: the language code (`fr`, `pt-BR`). */
  language?: string;
  /** The app that must not run when this goes, and whether it ran at scan time. */
  guard?: Guard;
  running?: boolean;
  /** A git dir whose worktree list is pruned after this worktree is removed. */
  prune?: string;
}
export interface ScanOptions {
  scope: Scope; home: string; env: Env; projectRoots: string[]; commands: boolean; cancelled: Cancelled;
  /** The languages the system can select (`defaults read -g AppleLanguages`); read when not given. */
  systemLanguages?: string[];
  /** An app's own language override; read with `defaults` when not given. */
  appLanguages?: (id: string) => Promise<string[]>;
  appRoots?: string[];
  /** Codex and Claude: injected in tests; read from this Mac otherwise. */
  agents?: Partial<AgentDeps> & { running?: Set<Guard> };
}

/** Rebuildable folders inside projects; a few need a re-download or reconfiguration. */
export const PROJECT_JUNK = ['node_modules', '.dart_tool', '.gradle', 'Pods', 'DerivedData', 'build', 'dist', 'out', '.next', '.nuxt',
  '.turbo', '.parcel-cache', '.angular', '.svelte-kit', '.expo', '.vercel', 'target', 'cmake-build-debug', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'vendor'];
const REVIEWED = new Set(['target', 'out', 'vendor', '.venv', '.tox', 'dist']);
const MAX_PROJECT_DEPTH = 8;

async function targets(rule: PathRule, opts: ScanOptions): Promise<{ path: string; name: string }[]> {
  const base = resolvePath(rule.path, opts.env, opts.home);
  if (rule.target === 'directory') return [{ path: base, name: '' }];
  if (rule.target === 'children') return ((await entries(base, opts.home)) ?? []).filter(e => !e.link).map(e => ({ path: e.path, name: e.name }));
  return (await glob(base, opts.home)).map(p => ({ path: p, name: `${path.basename(path.dirname(p))}/${path.basename(p)}` }));
}
/** Folders named like build output, not descending into one once found. */
async function projectJunk(root: string, opts: ScanOptions, found: (p: string, name: string) => Promise<void>, depth = 0): Promise<void> {
  if (depth > MAX_PROJECT_DEPTH || opts.cancelled()) return;
  for (const e of (await entries(root, opts.home)) ?? []) {
    if (!e.directory || e.link) continue;
    if (PROJECT_JUNK.includes(e.name)) await found(e.path, e.name);
    else if (!e.name.startsWith('.') && e.name !== 'Library') await projectJunk(e.path, opts, found, depth + 1);
  }
}
/** Bounded parallelism over a list. */
async function each<T>(list: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while (next < list.length) await work(list[next++]); }));
}

export async function scan(opts: ScanOptions, report: (item: Item) => void): Promise<void> {
  const seen = new Set<string>();
  const add = async (item: Omit<Item, 'bytes' | 'id' | 'modified'>) => {
    if (opts.cancelled() || seen.has(item.path) || isProtected(item.path, opts.home)) return;
    seen.add(item.path);
    const bytes = await measure(item.path, opts.cancelled);
    const modified = (await lstat(item.path).catch(() => null))?.mtimeMs ?? null;
    if (bytes > 0 && !opts.cancelled()) report({ ...item, id: `${item.rule}:${item.path}`, bytes, modified: modified && Math.round(modified) });
  };
  const rules = PATH_RULES.filter(r => scopeOf(r.category) === opts.scope);
  if (opts.scope === 'general') {
    // Apps first, so their logs and crash reports are attributed to them rather than to the generic rows.
    const apps = await discoverApps((opts.appRoots ?? APP_ROOTS).map(r => resolvePath(r, opts.env, opts.home)), opts.home);
    const system = opts.systemLanguages ?? await appleLanguages('-g');
    await each(apps, 4, async app => {
      for (const p of await appJunk(app, opts.home)) await add({ rule: 'app.junk', category: 'appJunk', risk: 'safe', kind: 'path', path: p, name: path.basename(p), app: app.name });
      for (const l of await unusedLocalizations(app, system, opts.appLanguages ?? appleLanguages))
        await add({ rule: 'language.lproj', category: 'language', risk: 'review', kind: 'path', path: l.path, name: path.basename(l.path), app: app.name, language: l.language });
    });
    // Installers and archives directly in Downloads.
    const downloads = path.join(opts.home, 'Downloads');
    for (const e of (await entries(downloads, opts.home)) ?? []) {
      if (e.directory || e.link) continue;
      const ext = e.name.split('.').pop()!.toLowerCase();
      const rule = INSTALLER_EXTENSIONS.includes(ext) ? 'downloads.installer' : ARCHIVE_EXTENSIONS.includes(ext) ? 'downloads.archive' : null;
      if (rule) await add({ rule, category: 'downloads', risk: 'caution', kind: 'path', path: e.path, name: e.name });
    }
  }
  await each(rules, 4, async rule => {
    for (const t of await targets(rule, opts)) await add({ rule: rule.id, category: rule.category, risk: rule.risk, kind: 'path', path: t.path, name: t.name });
  });
  if (opts.scope === 'general') return;
  // Codex and Claude, by our own rules (agents.ts); their worktrees' build output like a project's.
  const deps: AgentDeps = { now: Date.now(), git, sessionDays: 90, codexBuild: null, ...opts.agents } as AgentDeps;
  if (!opts.agents || !('codexBuild' in opts.agents)) deps.codexBuild = await codexBuild(opts.home);
  const live = opts.agents?.running ?? await running();
  const codex = await codexTargets(opts.home, deps), claude = await claudeTargets(opts.home, deps);
  for (const t of [...codex.targets, ...claude]) {
    await add({ rule: t.rule, category: t.category, risk: t.risk, kind: 'path', path: t.path, name: t.name,
      ...(t.guard ? { guard: t.guard, running: live.has(t.guard) } : {}), ...(t.prune ? { prune: t.prune } : {}) });
  }
  await each(codex.worktrees, 2, root => projectJunk(root, opts, (p, name) =>
    add({ rule: 'codex.artifacts', category: 'codex', risk: 'review', kind: 'path', path: p, name: path.relative(path.join(opts.home, '.codex/worktrees'), p) || name })));
  await each(opts.projectRoots.map(r => resolvePath(r, opts.env, opts.home)), 2, root => projectJunk(root, opts, (p, name) =>
    add({ rule: `projects.${name}`, category: 'projects', risk: REVIEWED.has(name) ? 'review' : 'safe', kind: 'path', path: p, name: path.relative(root, p) || name })));
  if (!opts.commands) return;
  await each(COMMAND_RULES, 4, async rule => {
    const executable = locate(rule.executable, opts.home);
    if (!executable || opts.cancelled()) return;
    let bytes = 0;
    for (const hint of rule.size_hints) bytes += Math.max(0, await measure(resolvePath(hint, opts.env, opts.home), opts.cancelled));
    // A tool's clean is offered even when its cache size is unknown (no hint) but not when it is known to be empty.
    if (rule.size_hints.length && !bytes) return;
    if (!opts.cancelled()) report({ id: rule.id, rule: rule.id, category: rule.category, risk: rule.risk, kind: 'command', path: executable, name: '', bytes, modified: null, command: rule.title });
  });
}
