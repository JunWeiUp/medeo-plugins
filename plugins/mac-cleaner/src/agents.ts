// Codex and Claude: what each leaves on disk that may go, by Mac Cleaner's own rules.
// Caches and failed or superseded installs are safe; old versions and worktree build
// output need a re-download or rebuild; sessions, stale worktrees and the Cowork VM
// disk are the user's and never ticked for them. Credentials, settings, histories,
// databases, skills, plugins, memories and generated files are never listed.
import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Risk } from './catalog.ts';
import { plistStrings } from './apps.ts';

/** Which app must be closed before an item goes: the Codex desktop app (ChatGPT.app or Codex.app), Codex in any form, or Claude desktop. */
export type Guard = 'codex-app' | 'codex' | 'claude-app';
export interface AgentTarget {
  rule: string; category: 'codex' | 'claude'; risk: Risk; path: string; name: string;
  guard?: Guard;
  /** A git dir whose worktree list is pruned after this worktree is removed. */
  prune?: string;
}
export interface AgentDeps {
  now: number;
  /** Runs git and returns stdout, or null when git fails or is missing. */
  git: (args: string[]) => Promise<string | null>;
  /** The installed Codex desktop build (CFBundleVersion), or null when unknown. */
  codexBuild: number | null;
  /** Codex sessions older than this many days are offered. */
  sessionDays: number;
}
const DAY = 86_400_000;
/** Crash reports and staging older than this are abandoned. */
const ORPHAN_DAYS = 30;
/** Desktop logs from the last week stay for diagnosis. */
const LOG_DAYS = 7;
/** A worktree untouched this long, clean and fully pushed or merged, may go as a whole. */
const WORKTREE_DAYS = 30;

const list = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);
const info = (p: string) => stat(p).catch(() => null);
const older = async (p: string, days: number, now: number) => { const s = await info(p); return !!s && now - s.mtimeMs > days * DAY; };
/** A `YYYY/MM/DD` (or `YYYY-MM-DD`) date, as local midnight. */
const dayOf = (y: string, m: string, d: string) => new Date(Number(y), Number(m) - 1, Number(d)).getTime();
const versionName = (s: string) => /^\d+(\.\d+)*$/.test(s);
const byVersion = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
/** Version folders other than the active one and the newest one before it; all kept when the active one is unknown. */
async function oldVersions(root: string, active: string | null): Promise<string[]> {
  if (!active) return [];
  // Native installs keep each version as one file; bundled ones as a folder.
  const names = (await list(root)).filter(e => (e.isDirectory() || e.isFile()) && versionName(e.name)).map(e => e.name).sort(byVersion);
  if (!names.includes(active)) return [];
  const previous = names.filter(n => byVersion(n, active) < 0).pop();
  return names.filter(n => n !== active && n !== previous).map(n => path.join(root, n));
}

export async function codexTargets(home: string, deps: AgentDeps): Promise<{ targets: AgentTarget[]; worktrees: string[] }> {
  const out: AgentTarget[] = [], add = (t: Omit<AgentTarget, 'category'>) => out.push({ ...t, category: 'codex' });
  const lib = path.join(home, 'Library'), codex = path.join(home, '.codex');

  // Browser caches of the desktop app (Chromium Cache / Code Cache only).
  const caches = path.join(lib, 'Caches/Codex');
  const profiles = [path.join(caches, 'Default'), path.join(caches, 'codex-browser-app'),
    ...(await list(path.join(caches, 'Default/Partitions'))).filter(e => e.isDirectory()).map(e => path.join(caches, 'Default/Partitions', e.name))];
  for (const profile of profiles) for (const leaf of ['Cache', 'Code Cache']) {
    const p = path.join(profile, leaf);
    if (await info(p)) add({ rule: 'codex.browser-cache', risk: 'safe', path: p, name: `${path.basename(profile)}/${leaf}`, guard: 'codex-app' });
  }
  // Desktop logs by day: whole days older than a week.
  const logs = path.join(lib, 'Logs/com.openai.codex');
  for (const y of await list(logs)) for (const m of await list(path.join(logs, y.name))) for (const d of await list(path.join(logs, y.name, m.name))) {
    if (!/^\d{4}$/.test(y.name) || !/^\d{2}$/.test(m.name) || !/^\d{2}$/.test(d.name)) continue;
    if (deps.now - dayOf(y.name, m.name, d.name) > (LOG_DAYS + 1) * DAY)
      add({ rule: 'codex.logs', risk: 'safe', path: path.join(logs, y.name, m.name, d.name), name: `${y.name}-${m.name}-${d.name}` });
  }
  // Runtime installs that never finished: no runtime.json and no dependencies, or a temporary name.
  const runtimes = path.join(home, '.cache/codex-runtimes');
  for (const e of await list(runtimes)) {
    if (!e.isDirectory()) continue;
    const p = path.join(runtimes, e.name);
    const temporary = /^(tmp|temp|incomplete|partial)|(\.tmp|[.-]incomplete|\.partial)$/i.test(e.name);
    if (temporary || (!(await info(path.join(p, 'runtime.json'))) && !(await info(path.join(p, 'dependencies')))))
      // Abandoned installs: nothing runs from them, so no running check.
      add({ rule: 'codex.runtime-partial', risk: 'safe', path: p, name: e.name });
  }
  // Update packages Sparkle staged: superseded by the installed build; when either version is unknown, only old ones.
  const staging = path.join(lib, 'Caches/com.openai.codex/org.sparkle-project.Sparkle/Installation');
  for (const e of await list(staging)) {
    if (!e.isDirectory()) continue;
    const p = path.join(staging, e.name);
    const plist = (await list(p)).find(x => x.name.endsWith('.app'));
    const staged = plist ? Number(plistStrings(await readFile(path.join(p, plist.name, 'Contents/Info.plist'), 'utf8').catch(() => '')).CFBundleVersion) : NaN;
    const superseded = deps.codexBuild !== null && Number.isFinite(staged) ? staged <= deps.codexBuild : await older(p, ORPHAN_DAYS, deps.now);
    if (superseded) add({ rule: 'codex.update', risk: 'safe', path: p, name: e.name });
  }
  // Crash reports never uploaded, and marketplace staging, after a month.
  const pending = path.join(lib, 'Application Support/Codex/Crashpad/pending');
  for (const e of await list(pending)) if (e.isFile() && await older(path.join(pending, e.name), ORPHAN_DAYS, deps.now))
    add({ rule: 'codex.crash', risk: 'safe', path: path.join(pending, e.name), name: e.name });
  for (const [dir, prefixes] of [['.tmp/bundled-marketplaces', ['openai-bundled.staging-']], ['.tmp/marketplaces/.staging', ['marketplace-upgrade-', 'marketplace-add-']]] as const) {
    const root = path.join(codex, dir);
    for (const e of await list(root)) if (prefixes.some(x => e.name.startsWith(x)) && await older(path.join(root, e.name), ORPHAN_DAYS, deps.now))
      add({ rule: 'codex.marketplace', risk: 'safe', path: path.join(root, e.name), name: e.name });
  }
  // Background service releases other than the current one and a pending auto-update.
  const daemon = path.join(codex, 'packages/app-server-daemon');
  const current = await realpath(path.join(daemon, 'current')).catch(() => null);
  if (current) {
    const pendingUpdate = (await readFile(path.join(daemon, 'auto-update-version'), 'utf8').catch(() => '')).trim();
    for (const e of await list(path.join(daemon, 'releases'))) {
      const p = path.join(daemon, 'releases', e.name);
      if (e.isDirectory() && p !== current && e.name !== pendingUpdate) add({ rule: 'codex.daemon', risk: 'review', path: p, name: e.name, guard: 'codex' });
    }
  }
  // Sessions: whole days older than the limit, and archived sessions dated before it.
  const cutoff = deps.now - deps.sessionDays * DAY, sessions = path.join(codex, 'sessions');
  for (const y of await list(sessions)) for (const m of await list(path.join(sessions, y.name))) for (const d of await list(path.join(sessions, y.name, m.name))) {
    if (/^\d{4}$/.test(y.name) && /^\d{2}$/.test(m.name) && /^\d{2}$/.test(d.name) && dayOf(y.name, m.name, d.name) + DAY < cutoff)
      add({ rule: 'codex.sessions', risk: 'caution', path: path.join(sessions, y.name, m.name, d.name), name: `${y.name}-${m.name}-${d.name}` });
  }
  const archived = path.join(codex, 'archived_sessions');
  for (const e of await list(archived)) {
    const m = /^rollout-(\d{4})-(\d{2})-(\d{2})T/.exec(e.name);
    if (e.isFile() && m && dayOf(m[1], m[2], m[3]) + DAY < cutoff) add({ rule: 'codex.archived', risk: 'caution', path: path.join(archived, e.name), name: e.name });
  }
  // Worktrees: stale and safe ones go whole; the rest are scanned for build output.
  const { stale, active } = await worktrees([path.join(codex, 'worktrees')], deps);
  for (const w of stale) add({ rule: 'codex.worktree', risk: 'caution', path: w.path, name: path.relative(path.join(codex, 'worktrees'), w.path), prune: w.gitDir });
  return { targets: out, worktrees: active };
}

/**
 * Agent worktrees (`<root>/<id>/<repo>` or `<root>/<name>`). One goes as a whole only when
 * nothing would be lost: no uncommitted change, HEAD on a remote branch or merged into the
 * main checkout, and no commit or change for a month. Anything git cannot answer stays.
 */
export async function worktrees(roots: string[], deps: AgentDeps): Promise<{ stale: { path: string; gitDir: string }[]; active: string[] }> {
  const stale: { path: string; gitDir: string }[] = [], active: string[] = [];
  const checkout = async (dir: string) => /^gitdir: /.test(await readFile(path.join(dir, '.git'), 'utf8').catch(() => ''));
  for (const root of roots) for (const e of await list(root)) {
    if (!e.isDirectory()) continue;
    const top = path.join(root, e.name);
    const inner = await checkout(top) ? [top] : (await Promise.all((await list(top)).filter(x => x.isDirectory()).map(async x => (await checkout(path.join(top, x.name)) ? path.join(top, x.name) : null)))).filter((x): x is string => !!x);
    if (!inner.length) { active.push(top); continue; }
    const verdicts = await Promise.all(inner.map(w => worktreeVerdict(w, deps)));
    // A single-checkout folder goes with its checkout; otherwise each checkout separately.
    if (inner.length === 1 && inner[0] !== top && verdicts[0]) stale.push({ path: top, gitDir: verdicts[0] });
    else inner.forEach((w, i) => verdicts[i] ? stale.push({ path: w, gitDir: verdicts[i]! }) : active.push(w));
    if (inner.length === 1 && inner[0] !== top && !verdicts[0]) active.push(inner[0]);
  }
  return { stale, active };
}
/** The main repository's git dir when the worktree may go, else null. */
async function worktreeVerdict(dir: string, deps: AgentDeps): Promise<string | null> {
  // Read-only: a plain `git status` rewrites the index, which would make every scanned worktree look fresh.
  const g = (...args: string[]) => deps.git(['--no-optional-locks', '-C', dir, ...args]);
  const common = (await g('rev-parse', '--path-format=absolute', '--git-common-dir'))?.trim();
  const own = (await g('rev-parse', '--path-format=absolute', '--git-dir'))?.trim();
  if (!common || !own) return null;
  const index = (await info(path.join(own, 'index')))?.mtimeMs ?? 0;
  const last = Number((await g('log', '-1', '--format=%ct'))?.trim()) * 1000;
  if (!last || deps.now - Math.max(last, index) < WORKTREE_DAYS * DAY) return null;
  if ((await g('status', '--porcelain', '--untracked-files=normal')) !== '') return null;
  // HEAD is safe when a remote branch has it, or the main checkout's HEAD contains it.
  const unpushed = await g('rev-list', '-n', '1', 'HEAD', '--not', '--remotes');
  if (unpushed === '') return common;
  const main = (await deps.git(['--git-dir', common, 'rev-parse', 'HEAD']))?.trim();
  if (main && (await g('merge-base', '--is-ancestor', 'HEAD', main)) !== null) return common;
  return null;
}

export async function claudeTargets(home: string, deps: AgentDeps): Promise<AgentTarget[]> {
  const out: AgentTarget[] = [], add = (t: Omit<AgentTarget, 'category'>) => out.push({ ...t, category: 'claude' });
  const lib = path.join(home, 'Library');
  // The desktop app keeps its data in "Claude" (and "Claude-3p" for its other build).
  for (const base of ['Claude', 'Claude-3p'].map(b => path.join(lib, 'Application Support', b))) {
    for (const leaf of ['Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GraphiteDawnCache']) {
      const p = path.join(base, leaf);
      if (await info(p)) add({ rule: 'claude.desktop-cache', risk: 'safe', path: p, name: `${path.basename(base)}/${leaf}`, guard: 'claude-app' });
    }
    const pending = path.join(base, 'Crashpad/pending');
    for (const e of await list(pending)) if (e.isFile() && await older(path.join(pending, e.name), ORPHAN_DAYS, deps.now))
      add({ rule: 'claude.crash', risk: 'safe', path: path.join(pending, e.name), name: e.name });
    // Claude Code builds the desktop app carries: keep the one in use and the one before it.
    const active = (await readFile(path.join(base, 'claude-code-vm/.sdk-version'), 'utf8').catch(() => '')).trim();
    for (const dir of ['claude-code', 'claude-code-vm'])
      for (const p of await oldVersions(path.join(base, dir), versionName(active) ? active : null))
        add({ rule: 'claude.bundled', risk: 'review', path: p, name: `${dir} ${path.basename(p)}`, guard: 'claude-app' });
    // The Cowork virtual machine's disk: Claude unpacks it again from its download, but what was inside is gone.
    for (const e of await list(path.join(base, 'vm_bundles'))) {
      const p = path.join(base, 'vm_bundles', e.name, 'rootfs.img');
      if (e.isDirectory() && await info(p)) add({ rule: 'claude.vm', risk: 'caution', path: p, name: `${e.name}/rootfs.img`, guard: 'claude-app' });
    }
  }
  for (const dir of (await list(path.join(lib, 'Caches'))).filter(e => e.name.startsWith('com.anthropic.claudefordesktop')))
    for (const e of await list(path.join(lib, 'Caches', dir.name))) add({ rule: 'claude.desktop-cache', risk: 'safe', path: path.join(lib, 'Caches', dir.name, e.name), name: `${dir.name}/${e.name}`, guard: 'claude-app' });
  for (const dir of (await list(path.join(lib, 'Logs'))).filter(e => /^Claude(-3p)?$/.test(e.name)))
    for (const e of await list(path.join(lib, 'Logs', dir.name))) add({ rule: 'claude.logs', risk: 'safe', path: path.join(lib, 'Logs', dir.name, e.name), name: `${dir.name}/${e.name}` });
  // Claude Code's own cache (MCP logs and the like), as one row.
  const cliCache = path.join(lib, 'Caches/claude-cli-nodejs');
  if ((await list(cliCache)).length) add({ rule: 'claude.cli-cache', risk: 'safe', path: cliCache, name: '' });
  // Native Claude Code installs: keep the version ~/.local/bin/claude points to and the one before it.
  const versions = path.join(home, '.local/share/claude/versions');
  const link = await readlink(path.join(home, '.local/bin/claude')).catch(() => null);
  const target = link ? path.resolve(path.join(home, '.local/bin'), link) : null;
  const active = target && path.dirname(target) === versions ? path.basename(target) : null;
  for (const p of await oldVersions(versions, active)) add({ rule: 'claude.cli-versions', risk: 'review', path: p, name: path.basename(p) });
  return out;
}

/** Which guarded apps run now, from one process listing; unknown counts as running. */
export function running(): Promise<Set<Guard>> {
  return new Promise(resolve => execFile('/bin/ps', ['-axo', 'comm='], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
    if (error) return resolve(new Set(['codex-app', 'codex', 'claude-app']));
    const set = new Set<Guard>();
    for (const line of out.split('\n')) {
      if (/\/(ChatGPT|Codex)\.app\//.test(line)) set.add('codex-app').add('codex');
      else if (path.basename(line.trim()) === 'codex') set.add('codex');
      if (/\/Claude\.app\//.test(line)) set.add('claude-app');
    }
    resolve(set);
  }));
}
/** The installed Codex desktop build: ChatGPT.app now carries it (bundle id com.openai.codex), Codex.app before. */
export async function codexBuild(home: string): Promise<number | null> {
  for (const app of ['/Applications/ChatGPT.app', '/Applications/Codex.app', path.join(home, 'Applications/ChatGPT.app'), path.join(home, 'Applications/Codex.app')]) {
    const xml = await new Promise<string>(resolve => execFile('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', path.join(app, 'Contents/Info.plist')], (e, out) => resolve(e ? '' : out)));
    const info = plistStrings(xml);
    if (info.CFBundleIdentifier === 'com.openai.codex' && /^\d+$/.test(info.CFBundleVersion ?? '')) return Number(info.CFBundleVersion);
  }
  return null;
}
/** Whether a real git is installed: without the command line tools /usr/bin/git only asks to install them. */
let gitInstalled: Promise<boolean> | null = null;
function hasGit(): Promise<boolean> {
  gitInstalled ??= (async () => {
    const dir = await new Promise<string>(resolve => execFile('/usr/bin/xcode-select', ['-p'], (error, out) => resolve(error ? '' : out.trim())));
    return !!dir && !!(await info(path.join(dir, 'usr/bin/git')));
  })();
  return gitInstalled;
}
/** git, or null when it fails or is not installed. */
export async function git(args: string[]): Promise<string | null> {
  if (!(await hasGit())) return null;
  return new Promise(resolve => execFile('/usr/bin/git', ['-c', 'core.fsmonitor=false', ...args], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
    (error, out) => resolve(error ? null : out.trim())));
}
