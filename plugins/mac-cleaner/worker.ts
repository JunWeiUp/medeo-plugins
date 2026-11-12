// Mac Cleaner: a Node plugin. It scans and removes with plain Node and asks the
// platform only for what Node cannot do (moving files to the Trash).
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { channel, config, definePlugin, i18n, launcher, trash } from '@medeo-plugin/sdk';
import { size } from './src/view.ts';
import { clean, type Method } from './src/clean.ts';
import { copy, reveal, terminal } from './src/actions.ts';
import { isProtected } from './src/protect.ts';
import { chooseDirectories, normalizeRoot, parseRoots, rootIdentity, suggestions } from './src/project-roots.ts';
import { scan, scopeOf, type Item, type Scope } from './src/scan.ts';
import { analyze, graft, locate, prune } from './src/analyze.ts';
import { DISK_IDLE, view, type DiskNode, type DiskState } from './src/disk.ts';
import type { Reply, Request, State } from './src/protocol.ts';

const home = os.homedir();
/** Under the 1 MiB channel limit with room for the envelope. */
const CHUNK_BUDGET = 800_000;
let state: State = { status: 'idle', home, scope: 'developer', scanned: { developer: null, general: null }, roots: [], suggestions: [], picking: false, method: 'trash', commands: true, sessionDays: 90, progress: { done: 0, total: 0 }, outcomes: [], free: null, capacity: null };
let items: Item[] = [], unsent: Item[] = [], reset: Scope | 'all' | null = null;
let cancelled = false, timer: ReturnType<typeof setTimeout> | null = null, queue = Promise.resolve();

/** Messages go out one after another so the window sees them in order. */
const post = (message: Reply) => { queue = queue.then(() => channel.post(message)).catch(() => {}); };
function chunks(list: Item[]): Item[][] {
  const out: Item[][] = [];
  let chunk: Item[] = [], size = 0;
  for (const item of list) {
    const bytes = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (chunk.length && size + bytes > CHUNK_BUDGET) { out.push(chunk); chunk = []; size = 0; }
    chunk.push(item); size += bytes;
  }
  if (chunk.length || !out.length) out.push(chunk);
  return out;
}
function publishNow() {
  timer = null;
  if (reset || unsent.length) {
    chunks(unsent).forEach((list, i) => post({ type: 'items', reset: i === 0 ? reset : null, items: list }));
    reset = null; unsent = [];
  }
  post({ type: 'state', state });
}
/** At most five updates a second while a scan streams items. */
const publish = (now = false) => { if (now) { if (timer) clearTimeout(timer); publishNow(); } else timer ??= setTimeout(publishNow, 200); };
const set = (patch: Partial<State>, now = true) => { state = { ...state, ...patch }; publish(now); };
/** The window (re)opened: send the whole list again. */
const resend = () => { reset = 'all'; unsent = items.slice(); };

async function loadSettings() {
  const values = await config.all();
  const roots = parseRoots(values.project_roots);
  const candidates = await suggestions(roots, home);
  const method: Method = values.clean_method === 'delete' ? 'delete' : 'trash';
  const days = Number(values.codex_session_days);
  return { roots, suggestions: candidates, method, commands: values.include_commands !== false, sessionDays: Number.isFinite(days) && days >= 7 ? Math.round(days) : 90 };
}
const volume = () => statfs(home).then(s => ({ free: s.bavail * s.bsize, capacity: s.blocks * s.bsize }), () => ({ free: null, capacity: null }));

// The window drives scans; a launcher command drives one too, reporting progress so it may take longer than 30 s.
async function runScan(scope: Scope): Promise<void> {
  if (state.picking || state.status === 'scanning' || state.status === 'cleaning') return;
  cancelled = false;
  const settings = await loadSettings();
  // A scan replaces only its own scope's items.
  items = items.filter(i => scopeOf(i.category) !== scope); unsent = []; reset = scope;
  set({ status: 'scanning', scope, outcomes: [], roots: settings.roots, suggestions: settings.suggestions, method: settings.method, commands: settings.commands, sessionDays: settings.sessionDays });
  const started = Date.now();
  console.log(`scan started (${scope}): ${settings.roots.length} project folders, commands ${settings.commands ? 'on' : 'off'}`);
  let found = 0;
  await scan({ scope, home, env: process.env, projectRoots: settings.roots, commands: settings.commands, agents: { sessionDays: settings.sessionDays }, cancelled: () => cancelled },
    item => { found++; items.push(item); unsent.push(item); publish(); });
  console.log(`scan ${cancelled ? 'cancelled' : 'finished'} (${scope}): ${found} items in ${Date.now() - started} ms`);
  set({ status: cancelled ? 'idle' : 'done', scanned: { ...state.scanned, [scope]: Date.now() }, ...(await volume()) });
}
async function runClean(ids: string[], method: Method) {
  if (state.picking || state.status === 'scanning' || state.status === 'cleaning') return;
  const wanted = new Set(ids), chosen = items.filter(i => wanted.has(i.id));
  if (!chosen.length) return;
  set({ status: 'cleaning', progress: { done: 0, total: chosen.length }, outcomes: [] });
  const outcomes = await clean(chosen, method, { home, trash }, done => { state = { ...state, progress: { done, total: chosen.length } }; publish(); });
  const removed = new Set(outcomes.filter(o => o.ok).map(o => o.id));
  items = items.filter(i => !removed.has(i.id));
  post({ type: 'removed', ids: [...removed] });
  forget(chosen.filter(i => removed.has(i.id) && i.kind === 'path').map(i => i.path));
  set({ status: 'done', outcomes, ...(await volume()) });
}

// Disk analysis: one tree at a time, independent of the cleaner's scans.
let disk: DiskState = DISK_IDLE, tree: DiskNode | null = null, at = '', diskCancelled = false;
const busyDisk = () => disk.status === 'scanning' || disk.status === 'opening';
const postDisk = () => post({ type: 'disk', state: disk });
function showFolder(target: string) {
  const node = tree && locate(tree, target)?.at(-1);
  if (node) { at = node.path; post({ type: 'disk-view', view: view(node) }); }
}
async function runAnalyze(root: string, includeProtected: boolean) {
  if (busyDisk() || !path.isAbsolute(root)) return;
  const before = { disk, tree, at }, started = Date.now();
  let last = 0, result: DiskNode | null = null;
  diskCancelled = false;
  disk = { ...DISK_IDLE, status: 'scanning', root, includeProtected }; postDisk();
  console.log(`disk analysis started: ${root}${includeProtected ? ' (with protected locations)' : ''}`);
  // The window watches the tree grow: the folder it shows, a few times a second.
  const ticker = setInterval(() => { if (tree) showFolder(at); }, 600);
  try {
    result = await analyze({ root, home, includeProtected, cancelled: () => diskCancelled,
      live: growing => { tree = growing; at = growing.path; showFolder(at); },
      progress: (files, bytes, current) => {
        disk = { ...disk, files, bytes, current };
        if (Date.now() - last > 250) { last = Date.now(); postDisk(); }
      } });
  } finally { clearInterval(ticker); }
  if (!result) {
    ({ disk, tree, at } = before); postDisk();
    if (tree) showFolder(at);
    toast('error', 'disk.toast.unreadable', { path: root });
    console.log(`disk analysis failed: ${root}`);
    return;
  }
  // A stopped walk keeps what it read, marked as partial.
  tree = result;
  disk = { ...disk, status: 'done', files: result.files, bytes: result.bytes, current: '', finished: Date.now(), took: Date.now() - started, partial: diskCancelled };
  console.log(`disk analysis ${diskCancelled ? 'stopped' : 'finished'}: ${result.files} files, ${result.bytes} bytes in ${disk.took} ms`);
  postDisk(); showFolder(locate(result, at) ? at : result.path);
  set({ ...(await volume()) });
}
/** Opens a folder; a folded or protected one is walked first (protected ones only now, on the user's click).
 * While an analysis runs, only folders already in the growing tree open. */
async function openFolder(target: string) {
  if (!tree || disk.status === 'opening') return;
  const node = locate(tree, target)?.at(-1);
  if (!node || node.kind === 'file' || node.kind === 'other') return;
  if (node.children) return showFolder(node.path);
  if (disk.status === 'scanning') return;
  diskCancelled = false;
  disk = { ...disk, status: 'opening', current: node.path }; postDisk();
  const fresh = await analyze({ root: node.path, home, includeProtected: disk.includeProtected || node.kind === 'restricted', cancelled: () => diskCancelled });
  disk = { ...disk, status: 'done', current: '' };
  if (fresh && tree) { graft(tree, fresh); disk = { ...disk, files: tree.files, bytes: tree.bytes }; }
  else toast('error', 'disk.toast.unreadable', { path: node.path });
  postDisk(); showFolder(fresh ? node.path : at);
}
async function chooseAndAnalyze(includeProtected: boolean) {
  if (busyDisk() || state.picking) return;
  set({ picking: true });
  let picked: string[] = [];
  try { picked = await chooseDirectories(); } catch { toast('error', 'settings.projects.chooseFailed'); }
  finally { set({ picking: false }); }
  if (picked[0]) await runAnalyze(picked[0], includeProtected);
}
/** Something left the disk: forget it in the tree and in the cleaner's lists. */
function forget(paths: string[]) {
  if (tree) {
    for (const p of paths) prune(tree, p);
    disk = { ...disk, files: tree.files, bytes: tree.bytes }; postDisk();
    showFolder(locate(tree, at) ? at : tree.path);
  }
}
async function diskAction(action: 'reveal' | 'terminal' | 'copy' | 'trash', target: string) {
  const node = tree && locate(tree, target)?.at(-1);
  if (!tree || !node || node.kind === 'other') return;
  if (action === 'copy') return void ((await copy(node.path)) ? toast('success', 'toast.copied') : toast('error', 'toast.copyFailed'));
  if (action === 'reveal') return void ((await reveal(node.path)) || toast('error', 'toast.revealFailed'));
  if (action === 'terminal') return void ((await terminal(node.path)) || toast('error', 'toast.terminalFailed'));
  if (busyDisk() || node === tree) return;
  if (isProtected(node.path, home)) return toast('error', 'toast.protectedPath');
  if (node.path.startsWith(`${home}/.Trash/`)) return toast('info', 'toast.alreadyInTrash');
  const [result] = await trash([node.path]).catch(() => [{ path: node.path, trashed: false }]);
  if (!result?.trashed) return toast('error', 'toast.trashFailed');
  forget([node.path]);
  const gone = items.filter(i => i.kind === 'path' && (i.path === node.path || i.path.startsWith(`${node.path}/`))).map(i => i.id);
  if (gone.length) { const ids = new Set(gone); items = items.filter(i => !ids.has(i.id)); post({ type: 'removed', ids: gone }); }
  set({ ...(await volume()) });
  toast('success', 'toast.trashed', { name: node.name });
}

const toast = (tone: 'success' | 'info' | 'error', key: string, params?: Record<string, string>) => post({ type: 'toast', tone, key, params });
const APP: Record<string, string> = { 'codex-app': 'Codex', codex: 'Codex', 'claude-app': 'Claude' };
/** One item from the context menu. Moving to the Trash asks nothing (as in Mackit and Finder), so it refuses what needs the clean flow. */
async function itemAction(action: 'reveal' | 'terminal' | 'copy' | 'trash', id: string) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  if (action === 'copy') return void ((await copy(item.kind === 'command' ? item.command ?? item.path : item.path)) ? toast('success', 'toast.copied') : toast('error', 'toast.copyFailed'));
  if (item.kind === 'command') return;
  if (action === 'reveal') return void ((await reveal(item.path)) || toast('error', 'toast.revealFailed'));
  if (action === 'terminal') return void ((await terminal(item.path)) || toast('error', 'toast.terminalFailed'));
  if (state.picking || state.status === 'scanning' || state.status === 'cleaning') return;
  if (isProtected(item.path, home)) return toast('error', 'toast.protectedPath');
  if (item.path.startsWith(`${home}/.Trash/`)) return toast('info', 'toast.alreadyInTrash');
  const [outcome] = await clean([item], 'trash', { home, trash });
  if (outcome?.ok) {
    items = items.filter(i => i.id !== id);
    post({ type: 'removed', ids: [id] }); forget([item.path]); set({ ...(await volume()) });
    toast('success', 'toast.trashed', { name: item.name || path.basename(item.path) });
  } else if (outcome?.error === 'running') toast('error', 'toast.running', { app: APP[item.guard ?? ''] ?? '' });
  else toast('error', 'toast.trashFailed');
}

// Serialize incremental edits: two rapid clicks must never overwrite each other.
let rootQueue = Promise.resolve();
async function changeRoots(action: 'add' | 'remove', values: string[]) {
  if (state.status === 'scanning' || state.status === 'cleaning') return;
  const current = parseRoots((await config.all()).project_roots);
  let next = current.slice();
  const identities = new Set(await Promise.all(current.map(r => rootIdentity(r, home))));
  let invalid = false;
  for (const value of values) {
    if (action === 'remove') { next = next.filter(r => r !== value); continue; }
    try {
      const root = await normalizeRoot(value, home);
      if (!identities.has(root)) { identities.add(root); next.push(root); }
    } catch { invalid = true; toast('error', 'settings.projects.invalid', { path: value }); }
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    await config.set('project_roots', next.join('\n'));
    // Old project results no longer describe the configured scope.
    const removed = items.filter(i => i.category === 'projects').map(i => i.id);
    items = items.filter(i => i.category !== 'projects');
    post({ type: 'removed', ids: removed });
    const settings = await loadSettings(); set({ roots: settings.roots, suggestions: settings.suggestions });
    if (!invalid) toast('success', 'settings.projects.updated');
  } else if (!invalid && action === 'add' && values.length) toast('info', 'settings.projects.duplicate');
}
function editRoots(action: 'add' | 'remove', values: string[]) {
  rootQueue = rootQueue.then(() => changeRoots(action, values)).catch(error => { console.error(error); toast('error', 'settings.projects.saveFailed'); });
  return rootQueue;
}
async function pickRoots() {
  if (state.picking || state.status === 'scanning' || state.status === 'cleaning') return;
  set({ picking: true });
  try { const paths = await chooseDirectories(); if (paths.length) await editRoots('add', paths); }
  catch { toast('error', 'settings.projects.chooseFailed'); }
  finally { set({ picking: false }); }
}

/** A scan or clean that throws must not leave the window stuck on "scanning". */
function failed(error: unknown) {
  console.error('cleaner failed:', error instanceof Error ? error.stack ?? error.message : String(error));
  set({ status: state.scanned[state.scope] ? 'done' : 'idle' });
}

function diskFailed(error: unknown) {
  console.error('disk analysis failed:', error instanceof Error ? error.stack ?? error.message : String(error));
  disk = { ...disk, status: tree ? 'done' : 'idle', current: '' }; postDisk();
}

// ------------------------------------------------------------------ Medeo Launcher Protocol
// One-click cleaning from any launcher: scan, ask with a confirm view, move only safe items to
// the Trash with progress, then show what was freed. The window's state follows along.
const QUICK: Scope[] = ['general', 'developer'];
const RECENT_SCAN_MS = 30 * 60_000;
async function launcherClean(args: unknown, scopes: Scope[]): Promise<unknown> {
  const session = launcher.session(args);
  // Deleting needs the user's eyes: without a launcher to ask in, the window is the place.
  if (!session) return { ok: false, error: 'launcher_only' };
  if (state.picking || state.status === 'scanning' || state.status === 'cleaning') {
    await session.result({ tone: 'warning', title: await i18n.t('launcher.busy') });
    return { ok: false, error: 'busy' };
  }
  const locale = (await i18n.state().catch(() => null))?.locale ?? 'en';
  const t = (key: string, params: Record<string, string | number> = {}) => i18n.t(key, params).catch(() => key);
  let phase = { title: await t('launcher.scanning'), message: '' as string | undefined, value: undefined as number | undefined };
  const show = () => session.progress(phase.title, { message: phase.message, value: phase.value }).catch(() => {});
  // The command stays alive only while it keeps the launcher informed: report at least every few seconds.
  const beat = setInterval(() => {
    if (state.status === 'scanning') {
      const found = items.filter(i => scopes.includes(scopeOf(i.category)));
      void t('launcher.found', { count: found.length, size: size(found.reduce((n, i) => n + i.bytes, 0), locale) }).then(m => { phase.message = m; void show(); });
    } else if (state.status === 'cleaning') {
      phase.value = state.progress.total ? state.progress.done / state.progress.total : undefined;
      void show();
    } else void show();
  }, 1500);
  try {
    // A scan from the last half hour is reused: the launcher should not make the user wait minutes twice.
    for (const scope of scopes) {
      if ((state.scanned[scope] ?? 0) > Date.now() - RECENT_SCAN_MS) continue;
      phase.message = await t(`scope.${scope}.title`); await show(); await runScan(scope);
    }
    const chosen = items.filter(i => scopes.includes(scopeOf(i.category)) && i.risk === 'safe' && i.kind === 'path' && !i.running && i.bytes > 0);
    if (!chosen.length) { await session.result({ tone: 'info', title: await t('launcher.nothing') }); return { ok: true, freed: 0 }; }
    const groups = new Map<string, { bytes: number; count: number }>();
    for (const item of chosen) { const g = groups.get(item.category) ?? { bytes: 0, count: 0 }; g.bytes += item.bytes; g.count++; groups.set(item.category, g); }
    const ordered = [...groups].sort((a, b) => b[1].bytes - a[1].bytes);
    const total = chosen.reduce((n, i) => n + i.bytes, 0);
    const answer = await session.confirm({
      title: await t('launcher.confirm', { size: size(total, locale) }),
      message: await t('launcher.confirm_note'),
      items: await Promise.all(ordered.map(async ([category, g]) => ({
        id: category, title: await t(`category.${category}.title`), subtitle: await t('launcher.items', { count: g.count }),
        accessory: { text: size(g.bytes, locale) }, checked: true,
      }))),
      confirm: await t('launcher.go'), style: 'destructive',
    });
    if (!answer.confirmed) return { ok: false, cancelled: true };
    const picked = new Set(answer.selected ?? ordered.map(([c]) => c));
    const ids = chosen.filter(i => picked.has(i.category)).map(i => i.id);
    if (!ids.length) return { ok: false, cancelled: true };
    phase = { title: await t('launcher.cleaning'), message: undefined, value: 0 };
    await show();
    // Always the Trash from a launcher, whatever the window's clean method: everything can be put back.
    await runClean(ids, 'trash');
    const outcomes = state.outcomes, freed = outcomes.filter(o => o.ok).reduce((n, o) => n + o.freed, 0), failed = outcomes.filter(o => !o.ok).length;
    await session.result({
      tone: failed ? 'warning' : 'success',
      title: await t('launcher.freed', { size: size(freed, locale) }),
      message: failed ? await t('launcher.failed', { count: failed }) : await t('launcher.trash_note'),
    });
    return { ok: true, freed, failed };
  } finally {
    clearInterval(beat);
  }
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    context.commands.register('cleaner.quick', args => launcherClean(args, QUICK));
    context.commands.register('cleaner.scope', args => {
      const scope = (args as { scope?: unknown } | undefined)?.scope;
      return launcherClean(args, scope === 'general' || scope === 'developer' ? [scope] : QUICK);
    });
    context.subscriptions.push({ dispose: channel.onMessage<Request>(message => {
      switch (message?.type) {
        case 'hello': resend(); postDisk(); if (tree) showFolder(at); void loadSettings().then(async s => set({ roots: s.roots, suggestions: s.suggestions, method: s.method, commands: s.commands, sessionDays: s.sessionDays, ...(await volume()) })); break;
        case 'scan': void runScan(message.scope === 'general' ? 'general' : 'developer').catch(failed); break;
        case 'cancel': cancelled = true; break;
        case 'item': if (['reveal', 'terminal', 'copy', 'trash'].includes(message.action)) void itemAction(message.action, String(message.id)).catch(failed); break;
        case 'clean': if (Array.isArray(message.ids)) void runClean(message.ids.map(String), message.method === 'delete' ? 'delete' : 'trash').catch(failed); break;
        case 'settings':
          void (async () => {
            if (message.method === 'trash' || message.method === 'delete') await config.set('clean_method', message.method);
            if (typeof message.commands === 'boolean') await config.set('include_commands', message.commands);
            if (typeof message.sessionDays === 'number' && message.sessionDays >= 7) await config.set('codex_session_days', Math.round(message.sessionDays));
            const s = await loadSettings(); set({ method: s.method, commands: s.commands, sessionDays: s.sessionDays });
          })().catch(failed);
          break;
        case 'choose-roots': void pickRoots(); break;
        case 'disk-scan': if (typeof message.root === 'string') void runAnalyze(message.root, message.includeProtected === true).catch(diskFailed); break;
        case 'disk-choose': void chooseAndAnalyze(message.includeProtected === true).catch(diskFailed); break;
        case 'disk-cancel': diskCancelled = true; break;
        case 'disk-open': if (typeof message.path === 'string') void openFolder(message.path).catch(diskFailed); break;
        case 'disk-item': if (['reveal', 'terminal', 'copy', 'trash'].includes(message.action) && typeof message.path === 'string') void diskAction(message.action, message.path).catch(diskFailed); break;
        case 'roots': if (['add', 'remove'].includes(message.action) && Array.isArray(message.roots) && message.roots.every(r => typeof r === 'string')) void editRoots(message.action, message.roots); break;
      }
    }) });
    context.subscriptions.push({ dispose: config.onDidChange(() => void loadSettings().then(s => set({ roots: s.roots, suggestions: s.suggestions, method: s.method, commands: s.commands, sessionDays: s.sessionDays }))) });
  },
  deactivate() { cancelled = true; diskCancelled = true; },
});
