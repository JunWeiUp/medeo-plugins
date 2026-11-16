// Netdisk: a file manager for the user's Medeo Drive folders (design: docs/ai-plugin-chat-design.html, 网盘插件 v22).
// Everything runs in this window. Bytes and real paths never pass through here: Medeo copies files in and out,
// hands them to the system for opening and dragging, and confirms folder access and deletions itself.
import { drive, events, files, i18n, operations, resources, storage, type FileSource } from '@medeo-plugin/sdk';
import {
  arrange, badge, badgeText, busy, code, crumbs, drivePath, format, freeName, join, kindOf, linkFor, matches, range, size, total, unavailable, when,
  type Entry, type FileState, type Kind, type Sort, type SortKey,
} from '../src/logic';

type View = 'loading' | 'signed_out' | 'unsupported' | 'unavailable' | 'pick' | 'files' | 'failed';
type Layout = 'grid' | 'list';
type Folder = Awaited<ReturnType<typeof drive.folders>>[number];
interface Root { id: string; name: string; label: string; folder: string; prefix: string }
interface Job { name: string; path: string; root: string; done: number; total: number; stage: 'copying' | 'stored' | 'failed'; error?: string }
interface Place { root: string; path: string }

const $ = (id: string) => document.getElementById(id)!;
const app = $('app'), menuBox = $('menu'), toastBox = $('toast');
let T: Record<string, string> = {};
const t = (key: string, params: Record<string, string | number> = {}) => format(T[key] ?? key, params);

const s = {
  view: 'loading' as View,
  folders: [] as Folder[],
  roots: [] as Root[],
  root: null as Root | null,
  path: '',
  entries: [] as Entry[],
  states: {} as Record<string, FileState>,
  selected: new Set<string>(),
  anchor: null as string | null,
  query: '',
  filter: 'all' as 'all' | 'cloud',
  renaming: null as string | null,
  layouts: {} as Record<string, Layout>,
  sort: { key: 'name', desc: false } as Sort,
  info: false,
  jobs: [] as Job[],
  xferOpen: true,
  failed: [] as Awaited<ReturnType<typeof drive.failed>>,
  up: 0, down: 0,
  status: null as Awaited<ReturnType<typeof drive.state>>['status'],
  recent: [] as string[],
  back: [] as Place[], forward: [] as Place[],
  pick: { first: true, query: '', by: 'name' as 'name' | 'files', checked: new Set<string>(), showAdded: false },
  switcher: null as null | { query: string; index: number },
  dropping: false,
};
let watch: string | null = null, refreshTimer = 0, listToken = 0, dragOut = false;
const layout = (): Layout => (s.root && s.layouts[s.root.name]) || 'grid';

// ---------- DOM helpers (no innerHTML) ----------
type Child = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'test') node.dataset.testid = `netdisk.${v}`;
    else if (k === 'class') node.className = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k in node) (node as any)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) node.append(c);
  return node;
}
const NS = 'http://www.w3.org/2000/svg';
function svg(viewBox: string, ...parts: [string, Record<string, string | number>, string?][]): SVGSVGElement {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', viewBox);
  for (const [tag, attrs, text] of parts) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text) node.textContent = text;
    root.append(node);
  }
  return root;
}
/** Toolbar glyphs: one stroke icon set (16 px, 1.6 stroke), so they line up in every font and theme. */
const GLYPH: Record<string, string[]> = {
  back: ['M10 3.5 5.5 8l4.5 4.5'], forward: ['M6 3.5 10.5 8 6 12.5'],
  grid: ['M2.5 2.5h4.5v4.5H2.5z', 'M9 2.5h4.5v4.5H9z', 'M2.5 9h4.5v4.5H2.5z', 'M9 9h4.5v4.5H9z'],
  list: ['M5.5 4h8', 'M5.5 8h8', 'M5.5 12h8', 'M2.5 4h.01', 'M2.5 8h.01', 'M2.5 12h.01'],
  sort: ['M4.5 2.5v11', 'M2 11l2.5 2.5L7 11', 'M11.5 13.5v-11', 'M9 5l2.5-2.5L14 5'],
  search: ['M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M10.6 10.6 14 14'],
  info: ['M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M8 7.2v4', 'M8 4.8h.01'],
  folderPlus: ['M1.8 4.2a1.2 1.2 0 0 1 1.2-1.2h3l1.5 1.5H13a1.2 1.2 0 0 1 1.2 1.2v6.6A1.2 1.2 0 0 1 13 13.5H3a1.2 1.2 0 0 1-1.2-1.2z', 'M8 7v4', 'M6 9h4'],
  plus: ['M8 3v10', 'M3 8h10'],
};
function glyph(name: string): SVGSVGElement {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 16 16'); root.setAttribute('class', 'glyph'); root.setAttribute('aria-hidden', 'true');
  for (const d of GLYPH[name]) { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); root.append(path); }
  return root;
}
const COLOR: Record<Kind, string> = { folder: '#4aa3ff', img: '#a855f7', video: '#2f8bff', audio: '#f59e0b', pdf: '#e5484d', doc: '#3b82f6', sheet: '#16a34a', slides: '#f97316', fig: '#f24e1e', zip: '#8e8e93', txt: '#64748b', code: '#0ea5e9', other: '#8e8e93' };
function typeIcon(entry: Pick<Entry, 'name' | 'kind'>): SVGSVGElement {
  const kind = kindOf(entry);
  if (kind === 'folder') return svg('0 0 64 54', ['path', { d: 'M4 10a6 6 0 0 1 6-6h14l6 6h24a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z', fill: '#4aa3ff' }], ['path', { d: 'M4 18h56v26a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6z', fill: '#6cb6ff' }]);
  return svg('0 0 52 64',
    ['path', { d: 'M6 2h28l14 14v42a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z', fill: '#f5f5f7', stroke: 'rgba(0,0,0,.14)' }],
    ['path', { d: 'M34 2v10a4 4 0 0 0 4 4h10', fill: '#e2e2e8' }],
    ['rect', { x: 2, y: 40, width: 46, height: 14, fill: COLOR[kind] }],
    ['text', { x: 25, y: 51, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: '#fff', 'font-family': 'system-ui,sans-serif' }, badgeText(entry)]);
}
function badgeEl(st: FileState | undefined) {
  const b = badge(st);
  if (!b) return null;
  return el('span', { class: `badge ${b.cls}`, title: stateText(st), style: b.progress !== undefined ? `--p:${b.progress}%` : undefined }, b.glyph);
}
function stateText(st: FileState | undefined): string {
  if (!st) return '';
  const p = Math.round((st.progress ?? 0) * 100);
  return st.state === 'uploading' || st.state === 'downloading' ? t(`st_${st.state}`, { p }) : st.state === 'unknown' ? '' : t(`st_${st.state}`);
}
const reasonText = (reason: string) => T[`r_${reason}`] ?? t('r_other');
const kindText = (entry: Entry) => (kindOf(entry) === 'img' ? `${badgeText(entry)} ` : '') + t(`k_${kindOf(entry)}`);
function toast(text: string, action?: { label: string; run: () => void }) {
  toastBox.replaceChildren(el('span', {}, text), ...(action ? [el('button', { class: 'secondary', onclick: () => { toastBox.hidden = true; action.run(); } }, action.label)] : []));
  toastBox.hidden = false;
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => { toastBox.hidden = true; }, 5000);
}
/** What went wrong in words: known codes have their own message (`e_<code>`), the rest show the code. */
function fail(error: unknown) {
  const c = code(error);
  if (c === 'cancelled') return;
  if (c === 'file_exists') return toast(t('name_taken'));
  const folders = s.folders.map(f => `「${f.name}」`).join('、');
  toast(T[`e_${c}`] ? t(`e_${c}`, { folders }) : t('error', { code: c }));
}

// ---------- loading ----------
async function start() {
  T = await i18n.catalog().catch(() => ({}));
  document.title = t('plugin.name');
  try {
    const state = await drive.state();
    if (!state.signedIn) return show('signed_out');
    if (state.engine !== 'ready') return show('unavailable');
    s.status = state.status;
    s.folders = await drive.folders();
    s.layouts = (await storage.get<Record<string, Layout>>('layouts')) ?? {};
    s.sort = (await storage.get<Sort>('sort')) ?? s.sort;
    s.recent = (await storage.get<string[]>('recent')) ?? [];
    await loadRoots();
    if (!s.roots.length) { s.pick.first = true; return show('pick'); }
    if (!s.root) s.root = s.roots.find(r => r.name === s.recent[0]) ?? s.roots[0];
    await openPath(s.root, s.path, false);
  } catch (error) {
    show(unavailable(error) ?? 'unavailable');
    if (!unavailable(error)) fail(error);
  }
}
/** Granted roots that live in a Medeo Drive folder, linked by root name (a root's id changes whenever roots are listed). */
async function loadRoots() {
  const listed = (await files.result(await files.roots())).filter(r => r.available && r.id);
  const links = (await storage.get<Record<string, { folder: string; prefix: string }>>('links')) ?? {};
  s.roots = listed.flatMap(r => {
    const link = links[r.name] ?? linkFor(r.name, s.folders);
    const folder = link && s.folders.find(f => f.id === link.folder);
    return folder ? [{ id: r.id!, name: r.name, folder: folder.id, prefix: link!.prefix, label: link!.prefix ? link!.prefix.split('/').pop()! : folder.name }] : [];
  });
  if (s.root) s.root = s.roots.find(r => r.name === s.root!.name) ?? null;
}
/** A root id lasts until roots are listed again: on `invalid_resource`, list again, find the same root by name, retry once. */
async function rooted<T>(run: (root: string) => Promise<T>, root = s.root): Promise<T> {
  try { return await run(root!.id); }
  catch (error) {
    if (code(error) !== 'invalid_resource' || !root) throw error;
    const name = root.name;
    await loadRoots();
    const again = s.roots.find(r => r.name === name);
    if (!again) throw error;
    return run(again.id);
  }
}
/** Add drive folders: Medeo confirms each (a named folder) or shows its picker (none). */
async function addFolders(ids: string[] | null) {
  try {
    const links = (await storage.get<Record<string, { folder: string; prefix: string }>>('links')) ?? {};
    const names = async () => new Set((await files.result(await files.roots())).map(r => r.name));
    for (const id of ids ?? [null]) {
      const before = await names();
      try { await drive.requestFolder(t('reason'), id ?? undefined); } catch (error) { if (code(error) === 'cancelled') continue; throw error; }
      const fresh = [...await names()].filter(n => !before.has(n));
      for (const name of fresh) links[name] = id ? { folder: id, prefix: '' } : linkFor(name, s.folders) ?? links[name];
      if (fresh[0] && !s.root) s.recent.unshift(fresh[0]);
    }
    await storage.set('links', links);
    await storage.set('recent', s.recent.slice(0, 50));
    s.pick.checked.clear();
    await start();
  } catch (error) { fail(error); }
}
async function removeRoot(root: Root) {
  try {
    const grant = (await resources.list()).find(r => r.name === root.name);
    if (grant) await resources.revoke(grant.id);
    const links = (await storage.get<Record<string, { folder: string; prefix: string }>>('links')) ?? {};
    delete links[root.name];
    await storage.set('links', links);
    if (s.root?.name === root.name) { s.root = null; s.path = ''; }
    await start();
  } catch (error) { fail(error); }
}
async function openPath(root: Root, path: string, remember = true) {
  if (remember && s.root && (s.root.name !== root.name || s.path !== path)) { s.back.push({ root: s.root.name, path: s.path }); s.forward = []; }
  s.root = root; s.path = path; s.selected.clear(); s.anchor = null; s.renaming = null; s.view = 'files'; s.filter = 'all';
  s.recent = [root.name, ...s.recent.filter(n => n !== root.name)].slice(0, 50);
  void storage.set('recent', s.recent);
  await reload();
  await follow();
}
async function reload() {
  const mine = ++listToken;
  try {
    const listed = await files.result(await rooted(id => files.list(id, s.path))) as Entry[];
    if (mine !== listToken) return;
    s.entries = listed;
    render();
    await refreshStates();
  } catch (error) { if (unavailable(error)) return show(unavailable(error)!); fail(error); }
}
async function go(place: Place | undefined, stack: Place[], other: Place[]) {
  const root = place && s.roots.find(r => r.name === place.root);
  if (!root || !s.root) return;
  other.push({ root: s.root.name, path: s.path });
  stack.pop();
  await openPath(root, place!.path, false);
}
/** Reload when the folder changes on disk (Medeo's file watch), not on a timer. */
async function follow() {
  if (watch) { await files.unwatch(watch).catch(() => {}); watch = null; }
  try { watch = (await rooted(id => files.watch(id, s.path, false))).id; } catch { /* a listing still works */ }
}
events.onSignal('files.watch', async () => {
  if (!watch || s.view !== 'files') return;
  const changed = await files.events(watch, 0).catch(() => null);
  if (changed?.events.some(e => e.kind !== 'ready')) await reload();
});
/** Sync states, speeds and failures. Only while something moves does it check again (3 s, window visible). */
async function refreshStates() {
  clearTimeout(refreshTimer);
  const root = s.root;
  if (!root || (s.view !== 'files' && s.view !== 'failed')) return;
  const paths = [...new Set([...s.entries.slice(0, 480).map(e => e.path), ...s.jobs.filter(j => j.root === root.name && j.stage === 'stored').map(j => j.path)])];
  try {
    const [states, transfers, failed, state] = await Promise.all([
      paths.length ? drive.fileStates(root.folder, paths.map(p => drivePath(root, p))) : Promise.resolve({} as Record<string, FileState>),
      drive.transfers(), drive.failed(), drive.state(),
    ]);
    s.states = Object.fromEntries(paths.map(p => [p, (states as Record<string, FileState>)[drivePath(root, p)] ?? { state: 'unknown' as const }]));
    s.up = transfers.uploadBytesPerSec; s.down = transfers.downloadBytesPerSec;
    s.failed = failed.filter(f => s.roots.some(r => r.folder === f.folder));
    s.status = state.status;
    if (!state.signedIn) return show('signed_out');
    render();
  } catch (error) { if (unavailable(error)) return show(unavailable(error)!); }
  const moving = busy(s.states) || s.jobs.some(j => j.stage === 'copying') || s.up > 0 || s.down > 0;
  if (moving) refreshTimer = window.setTimeout(() => (document.visibilityState === 'visible' ? void refreshStates() : document.addEventListener('visibilitychange', () => void refreshStates(), { once: true })), 3000);
}
function show(view: View) { s.view = view; render(); }

// ---------- actions ----------
const shown = () => arrange(s.entries, s.sort).filter(e => matches(e, s.query) && (s.filter === 'all' || s.states[e.path]?.state === 'cloud'));
const selection = () => shown().filter(e => s.selected.has(e.path));
async function store(sources: FileSource[], target = s.root!, dir = s.path) {
  if (!sources.length) return;
  s.xferOpen = true;
  for (const src of sources) {
    if (!src.source) { toast(t('job_failed', { error: src.error ?? 'source_unreadable' })); continue; }
    const job: Job = { name: src.name ?? '', path: join(dir, src.name ?? 'file'), root: target.name, done: 0, total: src.size ?? 0, stage: 'copying' };
    s.jobs.unshift(job); render();
    try {
      let state = await rooted(id => files.import(id, join(dir, src.name ?? 'file'), src.source!, { keepBoth: true }), target);
      while (state.status === 'running') {
        await new Promise(r => setTimeout(r, 250));
        state = await operations.state(state.id) as typeof state;
        if (state.progress) { job.done = state.progress.done; job.total = state.progress.total; renderXfer(); }
      }
      if (state.status !== 'completed') throw new Error(state.error ?? state.status);
      const entry = state.result as Entry | null;
      if (entry?.path) { job.path = entry.path; job.name = entry.name; }
      await operations.release(state.id).catch(() => {});
      job.stage = 'stored'; job.done = job.total;
    } catch (error) { job.stage = 'failed'; job.error = code(error); }
    renderXfer();
  }
  if (target.name === s.root?.name && dir === s.path) await reload(); else await refreshStates();
}
async function newFolder() {
  const name = freeName(t('new_folder_name'), s.entries.map(e => e.name));
  try {
    await files.result(await rooted(id => files.mkdir(id, join(s.path, name))));
    await reload();
    s.selected = new Set([join(s.path, name)]); s.renaming = join(s.path, name); render();
  } catch (error) { fail(error); }
}
async function rename(entry: Entry, name: string) {
  if (s.renaming !== entry.path) return; // Enter and blur both commit: only the first counts.
  s.renaming = null;
  name = name.trim();
  if (!name || name === entry.name) return render();
  if (name.includes('/') || name.startsWith('.') || name.length > 255) { toast(t('rename_invalid')); return render(); }
  try { await files.result(await rooted(id => files.move(id, entry.path, join(s.path, name), entry.revision))); s.selected = new Set([join(s.path, name)]); } catch (error) { fail(error); }
  await reload();
}
async function trash(paths: string[]) {
  if (!paths.length) return;
  try {
    for (const path of paths) {
      const preview = await files.result(await rooted(id => files.trashPreview(id, path)));
      await files.result(await files.trash(preview.id)); // Medeo confirms; inside a synced folder it says the cloud copy goes too.
    }
  } catch (error) { fail(error); }
  s.selected.clear();
  await reload();
}
async function takeOut(paths: string[]) {
  const filesOnly = paths.filter(p => s.entries.find(e => e.path === p)?.kind === 'file');
  if (!filesOnly.length) return;
  try {
    const out = await rooted(id => files.export(id, filesOnly));
    if (out.exported.length) toast(t('exported', { n: out.exported.length, folder: out.folder ?? '' }), { label: t('reveal'), run: () => void reveal(filesOnly[0]) });
  } catch (error) { fail(error); }
}
const reveal = (path: string) => rooted(id => files.reveal(id, path)).catch(fail);
async function download(paths: string[]) { try { for (const p of paths) await drive.download(s.root!.folder, drivePath(s.root!, p)); await refreshStates(); } catch (error) { fail(error); } }
async function retry(folders: string[]) { try { for (const f of new Set(folders)) await drive.retry(f); await refreshStates(); } catch (error) { fail(error); } }
async function activate(entry: Entry) {
  if (entry.kind === 'directory') return openPath(s.root!, entry.path);
  if (s.states[entry.path]?.state === 'cloud') return download([entry.path]);
  try { await rooted(id => files.open(id, entry.path)); } catch (error) { fail(error); }
}
function setLayout(next: Layout) { if (!s.root) return; s.layouts[s.root.name] = next; void storage.set('layouts', s.layouts); render(); }
function setSort(key: SortKey) { s.sort = { key, desc: s.sort.key === key ? !s.sort.desc : false }; void storage.set('sort', s.sort); render(); }
function choose(entry: Entry, e: MouseEvent | KeyboardEvent) {
  const order = shown().map(x => x.path);
  if (e.shiftKey) s.selected = new Set(range(order, s.anchor, entry.path));
  else if (e.metaKey) { if (s.selected.has(entry.path)) s.selected.delete(entry.path); else s.selected.add(entry.path); s.anchor = entry.path; }
  else { s.selected = new Set([entry.path]); s.anchor = entry.path; }
  render();
}

// ---------- menus ----------
type Item = { key: string; icon: string; kbd?: string; run: () => void; danger?: boolean; check?: boolean } | 'sep';
function openMenu(x: number, y: number, items: Item[]) {
  const nodes: Node[] = [];
  for (const it of items) {
    if (it === 'sep') { if (nodes.length && !(nodes.at(-1) instanceof HTMLHRElement)) nodes.push(el('hr')); continue; }
    nodes.push(el('button', { role: 'menuitem', class: `${it.danger ? 'danger' : ''} ${it.check ? 'check' : ''}`, test: `menu.${it.key}`, onclick: () => { closeMenu(); it.run(); } },
      el('i', {}, it.check ? '✓' : it.icon), t(it.key.startsWith('sort_') || it.key.startsWith('view_') ? it.key : `m_${it.key}`), it.kbd ? el('kbd', {}, it.kbd) : null));
  }
  if (nodes.at(-1) instanceof HTMLHRElement) nodes.pop();
  menuBox.replaceChildren(...nodes);
  menuBox.hidden = false;
  const r = menuBox.getBoundingClientRect();
  menuBox.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menuBox.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
}
function closeMenu() { menuBox.hidden = true; }
function entryMenu(e: MouseEvent, entry: Entry) {
  e.preventDefault(); e.stopPropagation();
  if (!s.selected.has(entry.path)) { s.selected = new Set([entry.path]); s.anchor = entry.path; render(); }
  const sel = selection(), one = sel.length === 1, st = s.states[entry.path]?.state, paths = sel.map(x => x.path);
  openMenu(e.clientX, e.clientY, [
    ...(one ? [{ key: 'open', icon: '↗', kbd: '⌘O', run: () => void activate(entry) }, { key: 'reveal', icon: '📂', run: () => void reveal(entry.path) }, { key: 'info', icon: 'ⓘ', kbd: '⌘I', run: () => { s.info = true; render(); } }] : []),
    'sep',
    ...(sel.some(x => s.states[x.path]?.state === 'cloud') ? [{ key: 'download', icon: '☁', run: () => void download(paths.filter(p => s.states[p]?.state === 'cloud')) }] : []),
    ...(sel.some(x => x.kind === 'file') ? [{ key: 'export', icon: '⇪', run: () => void takeOut(paths) }] : []),
    ...(st === 'failed' ? [{ key: 'retry', icon: '↻', run: () => void retry([s.root!.folder]) }] : []),
    'sep',
    ...(one ? [{ key: 'rename', icon: '✎', kbd: '↩', run: () => { s.renaming = entry.path; render(); } }] : []),
    { key: 'new_folder', icon: '⊕', kbd: '⇧⌘N', run: () => void newFolder() },
    'sep',
    { key: 'trash', icon: '🗑', kbd: '⌘⌫', danger: true, run: () => void trash(paths) },
  ] as Item[]);
}
function blankMenu(e: MouseEvent) {
  e.preventDefault();
  s.selected.clear(); render();
  openMenu(e.clientX, e.clientY, [
    { key: 'new_folder', icon: '⊕', kbd: '⇧⌘N', run: () => void newFolder() },
    { key: 'store', icon: '＋', run: () => void files.chooseFiles().then(src => store(src), fail) },
    'sep',
    ...(['name', 'modified', 'size', 'kind'] as SortKey[]).map(key => ({ key: `sort_${key}`, icon: '', check: s.sort.key === key, run: () => setSort(key) })),
    'sep',
    { key: 'view_grid', icon: '▦', kbd: '⌘1', check: layout() === 'grid', run: () => setLayout('grid') },
    { key: 'view_list', icon: '☰', kbd: '⌘2', check: layout() === 'list', run: () => setLayout('list') },
  ] as Item[]);
}
function rootMenu(e: MouseEvent, root: Root) {
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [{ key: 'reveal', icon: '📂', run: () => void rooted(id => files.reveal(id, ''), root).catch(fail) }, 'sep', { key: 'remove_folder', icon: '⊖', danger: true, run: () => void removeRoot(root) }] as Item[]);
}
addEventListener('mousedown', e => { if (!menuBox.contains(e.target as Node)) closeMenu(); if (s.switcher && !(e.target as HTMLElement).closest('.switch')) { s.switcher = null; render(); } });

// ---------- keyboard ----------
addEventListener('keydown', e => {
  const typing = (e.target as HTMLElement).tagName === 'INPUT';
  if (e.key === 'Escape') { closeMenu(); if (s.switcher) { s.switcher = null; return render(); } if (s.renaming) { s.renaming = null; return render(); } if (s.selected.size) { s.selected.clear(); return render(); } }
  if (s.view !== 'files') return;
  if (e.metaKey && e.key === 'p') { e.preventDefault(); s.switcher = { query: '', index: 0 }; return render(); }
  if (s.switcher) return;
  if (e.metaKey && e.key === 'f') { e.preventDefault(); return document.querySelector<HTMLInputElement>('[data-testid="netdisk.search"]')?.focus(); }
  if (typing) return;
  if (e.metaKey && e.key === '1') { e.preventDefault(); return setLayout('grid'); }
  if (e.metaKey && e.key === '2') { e.preventDefault(); return setLayout('list'); }
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); return void newFolder(); }
  if (e.metaKey && e.key === 'i') { e.preventDefault(); s.info = !s.info; return render(); }
  if (e.metaKey && e.key === 'a') { e.preventDefault(); s.selected = new Set(shown().map(x => x.path)); return render(); }
  if (e.metaKey && e.key === '[') return void go(s.back.at(-1), s.back, s.forward);
  if (e.metaKey && e.key === ']') return void go(s.forward.at(-1), s.forward, s.back);
  const sel = selection();
  if ((e.metaKey && e.key === 'Backspace') || e.key === 'Delete') return void trash(sel.map(x => x.path));
  if (e.key === 'Enter' && sel.length === 1) { e.preventDefault(); s.renaming = sel[0].path; return render(); }
  if ((e.metaKey && e.key === 'o') || (e.metaKey && e.key === 'ArrowDown')) { if (sel.length === 1) void activate(sel[0]); return; }
  if (e.metaKey && e.key === 'ArrowUp' && s.path) return void openPath(s.root!, s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/')) : '');
  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const list = shown(); if (!list.length) return;
    const cols = layout() === 'grid' ? Math.max(1, Math.floor((document.querySelector('.grid')?.clientWidth ?? 600) / 116)) : 1;
    const at = list.findIndex(x => x.path === (s.anchor ?? '')), step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: layout() === 'grid' ? 1 : 0, ArrowLeft: layout() === 'grid' ? -1 : 0 }[e.key]!;
    const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + step))];
    choose(next, e);
    document.querySelector(`[data-testid="netdisk.item.${CSS.escape(next.name)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
});

// ---------- drag in / out ----------
let depth = 0;
addEventListener('dragenter', e => { if (s.view === 'files' && !dragOut && e.dataTransfer?.types.includes('Files')) { depth++; if (!s.dropping) { s.dropping = true; render(); } } });
addEventListener('dragleave', () => { if (--depth <= 0 && s.dropping) { depth = 0; s.dropping = false; render(); } });
addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', e => {
  e.preventDefault(); depth = 0;
  const wasDropping = s.dropping; s.dropping = false;
  const dropped = e.dataTransfer?.files;
  if (s.view !== 'files' || dragOut || !dropped?.length) { if (wasDropping) render(); return; }
  // Dropped on a folder in the sidebar: store there; otherwise into the folder on screen.
  const target = (e.target as HTMLElement)?.closest?.('[data-root]') as HTMLElement | null;
  const root = target ? s.roots.find(r => r.name === target.dataset.root) : null;
  render();
  void files.fromDrop(dropped).then(src => store(src, root ?? s.root!, root ? '' : s.path), fail);
});
function startDrag(e: DragEvent, entry: Entry) {
  e.preventDefault();
  if (!s.selected.has(entry.path)) { s.selected = new Set([entry.path]); render(); }
  dragOut = true;
  void rooted(id => files.startDrag(id, selection().map(x => x.path))).catch(fail).finally(() => setTimeout(() => { dragOut = false; }, 600));
}

// ---------- rendering ----------
/** True while the DOM is being replaced: removing a focused rename field fires `blur`, which must not render again. */
let rendering = false;
function render() {
  if (rendering) return;
  rendering = true;
  try { draw(); } finally { rendering = false; }
  const input = app.querySelector<HTMLInputElement>('[data-testid="netdisk.rename"]');
  if (input && document.activeElement !== input) { input.focus(); const dot = input.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length); }
}
function draw() {
  app.setAttribute('aria-busy', String(s.view === 'loading'));
  if (s.view === 'loading') return app.replaceChildren();
  if (s.view === 'signed_out' || s.view === 'unsupported' || s.view === 'unavailable') return app.replaceChildren(top(null), statePage());
  if (s.view === 'pick') return app.replaceChildren(top(null), pickPage());
  const body = el('div', { class: `body${s.info && s.view === 'files' ? ' with-info' : ''}` }, side(), s.view === 'failed' ? failedView() : mainView(), s.info && s.view === 'files' ? infoPanel() : null);
  app.replaceChildren(top(s.root), body, ...(s.switcher ? [switcher()] : []));
  renderXfer();
}
function top(root: Root | null) {
  if (!root || s.view === 'pick') {
    return el('div', { class: 'top' },
      s.view === 'pick' && !s.pick.first ? el('button', { class: 'secondary', test: 'back', onclick: () => show(s.roots.length ? 'files' : 'pick') }, '‹ ', t('back')) : null,
      el('div', { class: 'crumbs' }, s.view === 'pick' && !s.pick.first ? t('add_title') : t('plugin.name')));
  }
  const crumbsBox = el('div', { class: 'crumbs', test: 'crumbs' },
    el('button', { onclick: () => void openPath(root, '') }, root.label),
    ...crumbs(s.path).flatMap(c => [el('span', {}, '›'), el('button', { onclick: () => void openPath(root, c.path) }, c.name)]));
  const search = el('div', { class: 'search' }, glyph('search'), el('input', { test: 'search', placeholder: t('search'), value: s.query, oninput: (e: Event) => { s.query = (e.target as HTMLInputElement).value; renderContent(); } }));
  return el('div', { class: 'top' },
    el('button', { class: 'ib', title: t('nav_back'), disabled: !s.back.length, test: 'nav-back', onclick: () => void go(s.back.at(-1), s.back, s.forward) }, glyph('back')),
    el('button', { class: 'ib', title: t('nav_forward'), disabled: !s.forward.length, test: 'nav-forward', onclick: () => void go(s.forward.at(-1), s.forward, s.back) }, glyph('forward')),
    crumbsBox, el('span', { class: 'grow' }),
    s.view === 'files' && el('div', { class: 'seg' },
      el('button', { class: layout() === 'grid' ? 'on' : '', title: `${t('view_grid')} ⌘1`, test: 'view-grid', 'aria-pressed': String(layout() === 'grid'), onclick: () => setLayout('grid') }, glyph('grid')),
      el('button', { class: layout() === 'list' ? 'on' : '', title: `${t('view_list')} ⌘2`, test: 'view-list', 'aria-pressed': String(layout() === 'list'), onclick: () => setLayout('list') }, glyph('list'))),
    s.view === 'files' && el('button', { class: 'ib', title: t('sort'), test: 'sort', onclick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(r.left, r.bottom + 4, [...(['name', 'modified', 'size', 'kind'] as SortKey[]).map(key => ({ key: `sort_${key}`, icon: '', check: s.sort.key === key, run: () => setSort(key) })), 'sep', { key: 'sort_desc', icon: '', check: s.sort.desc, run: () => { s.sort = { ...s.sort, desc: !s.sort.desc }; void storage.set('sort', s.sort); render(); } }] as Item[]); } }, glyph('sort')),
    s.view === 'files' && search,
    s.view === 'files' && el('span', { class: 'divider' }),
    s.view === 'files' && el('button', { class: `ib${s.info ? ' on' : ''}`, title: `${t('info')} ⌘I`, test: 'info-toggle', onclick: () => { s.info = !s.info; render(); } }, glyph('info')),
    s.view === 'files' && el('button', { class: 'ib', title: `${t('new_folder')} ⇧⌘N`, test: 'new-folder', onclick: () => void newFolder() }, glyph('folderPlus')),
    el('button', { class: 'primary', test: 'store', onclick: () => void files.chooseFiles().then(src => store(src), fail) }, glyph('plus'), t('store')));
}
function side() {
  const ordered = [...s.roots].sort((a, b) => (s.recent.indexOf(a.name) + 1 || 999) - (s.recent.indexOf(b.name) + 1 || 999));
  const visible = ordered.slice(0, 8), hidden = ordered.length - visible.length;
  const failedIn = (r: Root) => s.failed.filter(f => f.folder === r.folder).length;
  const cloud = s.entries.filter(e => s.states[e.path]?.state === 'cloud').length;
  const st = s.status, moving = s.up > 0 || s.down > 0 || (st && st.pendingFiles + st.uploadingFiles > 0);
  return el('aside', { class: 'side', test: 'side' },
    el('h6', {}, s.roots.length > 8 ? t('section_drive_n', { n: s.roots.length }) : t('section_drive')),
    ...visible.map(r => {
      const n = failedIn(r);
      return el('button', { class: `si${s.view === 'files' && r.name === s.root?.name && s.filter === 'all' ? ' on' : ''}`, 'data-root': r.name, title: r.name, test: `root.${r.label}`,
        onclick: () => void openPath(r, ''), oncontextmenu: (e: MouseEvent) => rootMenu(e, r) },
        el('span', { class: 'g' }, '📁'), el('span', { class: 't' }, r.label), n ? el('em', { class: 'bad' }, String(n)) : null);
    }),
    hidden > 0 && el('button', { class: 'more', test: 'more', onclick: () => { s.switcher = { query: '', index: 0 }; render(); } }, '⋯ ', t('more', { n: hidden }), el('kbd', {}, '⌘P')),
    el('button', { class: 'si add', test: 'add-folder', onclick: () => { s.pick.first = false; show('pick'); } }, el('span', { class: 'g' }, '＋'), el('span', { class: 't' }, t('add_folder'))),
    el('h6', {}, t('section_other')),
    el('button', { class: `si${s.filter === 'cloud' && s.view === 'files' ? ' on' : ''}`, test: 'cloud', onclick: () => { s.view = 'files'; s.filter = s.filter === 'cloud' ? 'all' : 'cloud'; render(); } }, el('span', { class: 'g' }, '☁'), el('span', { class: 't' }, t('cloud_only')), cloud ? el('em', {}, String(cloud)) : null),
    el('button', { class: `si${s.view === 'failed' ? ' on' : ''}`, test: 'failed', onclick: () => show('failed') }, el('span', { class: 'g' }, '⚠'), el('span', { class: 't' }, t('side_failed')), s.failed.length ? el('em', { class: 'bad' }, String(s.failed.length)) : null),
    el('div', { class: 'card', test: 'card' },
      el('b', {}, el('i', { class: st?.paused ? 'paused' : moving ? 'busy' : '' }), st?.paused ? t('card_paused') : moving ? t('card_syncing') : t('card_ok')),
      st && st.totalFiles > 0 && moving ? el('div', { class: 'meter' }, el('i', { style: `width:${Math.round(st.syncedFiles / st.totalFiles * 100)}%` })) : null,
      el('small', {}, moving ? [(s.up || s.down) ? `↑ ${size(s.up)}/s · ↓ ${size(s.down)}/s` : '', st ? t('card_remaining', { n: st.pendingFiles + st.uploadingFiles }) : ''].filter(Boolean).join(' · ') : t('card_folders', { n: s.roots.length }))));
}
function mainView() {
  const sel = selection();
  const failedHere = s.failed.filter(f => f.folder === s.root?.folder);
  const cloudHere = s.entries.filter(e => s.states[e.path]?.state === 'cloud');
  const main = el('main', { class: 'main', test: 'main' },
    sel.length > 1 && el('div', { class: 'selbar', test: 'selbar' },
      el('b', {}, t('sel_bar', { n: sel.length, size: size(total(s.entries, s.selected)) })),
      sel.some(x => x.kind === 'file') && el('button', { test: 'sel-export', onclick: () => void takeOut(sel.map(x => x.path)) }, '⇪ ', t('m_export')),
      el('button', { test: 'sel-reveal', onclick: () => void reveal(sel[0].path) }, '📂 ', t('m_reveal')),
      el('button', { class: 'danger', test: 'sel-trash', onclick: () => void trash(sel.map(x => x.path)) }, '🗑 ', t('m_trash')),
      el('button', { title: t('close'), test: 'sel-clear', onclick: () => { s.selected.clear(); render(); } }, '✕')),
    failedHere.length > 0 && s.filter === 'all' && el('div', { class: 'banner bad', test: 'banner-failed' }, '⚠',
      el('b', {}, t('banner_failed', { n: failedHere.length, reasons: [...new Set(failedHere.map(f => reasonText(f.reason)))].slice(0, 2).join('、') })),
      el('button', { class: 'secondary', onclick: () => void retry([s.root!.folder]) }, t('retry')), el('button', { class: 'secondary', onclick: () => show('failed') }, t('view'))),
    cloudHere.length > 0 && s.filter === 'all' && el('div', { class: 'banner cloud', test: 'banner-cloud' }, '☁',
      el('b', {}, t('banner_cloud', { n: cloudHere.length })), el('button', { class: 'secondary', onclick: () => void download(cloudHere.map(e => e.path)) }, t('download_all'))),
    el('div', { class: 'scroll', test: 'content', oncontextmenu: (e: MouseEvent) => { if (e.target === e.currentTarget || (e.target as HTMLElement).matches('.grid,.list')) blankMenu(e); },
      onmousedown: (e: MouseEvent) => { if ((e.target as HTMLElement).matches('.scroll,.grid,.list') && s.selected.size) { s.selected.clear(); render(); } } }));
  renderContentInto(main.querySelector('.scroll')!);
  if (s.dropping) main.append(el('div', { class: 'drop', test: 'drop' }, el('div', { class: 'di' }, '⇣'), el('b', {}, t('drop_here', { folder: crumbs(s.path).at(-1)?.name ?? s.root!.label })), el('small', {}, t('drop_note', { n: '…' }))));
  main.append(el('div', { id: 'xfer' }));
  return main;
}
function renderContent() { const box = app.querySelector<HTMLElement>('[data-testid="netdisk.content"]'); if (box) renderContentInto(box); }
function renderContentInto(box: HTMLElement) {
  const list = shown();
  if (!s.entries.length) {
    return box.replaceChildren(el('div', { class: 'empty', test: 'empty' }, el('div', { class: 'zone' },
      el('span', { class: 'icon', style: 'width:56px;height:48px' }, typeIcon({ name: '', kind: 'directory' })),
      el('h3', {}, t('empty_title')), el('p', {}, t('empty_note')),
      el('button', { class: 'primary', onclick: () => void files.chooseFiles().then(src => store(src), fail) }, t('store_files')))));
  }
  if (!list.length) return box.replaceChildren(el('div', { class: 'empty' }, el('p', { style: 'color:var(--muted)' }, t('no_match', { q: s.query }))));
  const common = (entry: Entry) => ({
    'data-path': entry.path, draggable: s.renaming !== entry.path, test: `item.${entry.name}`, title: entry.name,
    onclick: (e: MouseEvent) => choose(entry, e), ondblclick: () => void activate(entry),
    oncontextmenu: (e: MouseEvent) => entryMenu(e, entry), ondragstart: (e: DragEvent) => startDrag(e, entry),
  });
  const nameNode = (entry: Entry) => s.renaming === entry.path
    ? el('input', { test: 'rename', value: entry.name, onclick: (e: Event) => e.stopPropagation(), ondblclick: (e: Event) => e.stopPropagation(),
        onkeydown: (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void rename(entry, (e.target as HTMLInputElement).value); } if (e.key === 'Escape') { s.renaming = null; render(); } },
        // Clicking elsewhere commits; a blur caused by re-rendering does not (the field is gone, not left).
        onblur: (e: Event) => { const value = (e.target as HTMLInputElement).value; if (!rendering) setTimeout(() => { if (s.renaming === entry.path) void rename(entry, value); }); } })
    : el('span', {}, entry.name);
  if (layout() === 'grid') {
    return box.replaceChildren(el('div', { class: 'grid', test: 'grid', role: 'grid' }, ...list.map(entry => el('div', { class: `tile${s.selected.has(entry.path) ? ' sel' : ''}`, ...common(entry) },
      el('div', { class: 'icon' }, typeIcon(entry), badgeEl(s.states[entry.path])),
      el('div', { class: 'nm' }, nameNode(entry)),
      el('div', { class: 'meta' }, entry.kind === 'directory' ? '\u00a0' : size(entry.size))))));
  }
  const head = (key: SortKey, label: string) => el('button', { class: s.sort.key === key ? 'on' : '', onclick: () => setSort(key) }, label, s.sort.key === key ? (s.sort.desc ? ' ⌄' : ' ⌃') : '');
  return box.replaceChildren(el('div', { class: 'list', test: 'list', role: 'grid' },
    el('div', { class: 'row head' }, head('name', t('col_name')), head('modified', t('col_modified')), head('size', t('col_size')), head('kind', t('col_kind')), el('span', {})),
    ...list.map(entry => el('div', { class: `row${s.selected.has(entry.path) ? ' sel' : ''}`, ...common(entry) },
      el('span', { class: 'nm' }, el('span', { class: 'mini' }, typeIcon(entry)), nameNode(entry)),
      el('span', { class: 'dim' }, when(entry.modified_ms)),
      el('span', { class: 'dim' }, entry.kind === 'directory' ? '—' : size(entry.size)),
      el('span', { class: 'dim' }, kindText(entry)),
      el('span', { class: 'st', test: `state.${entry.name}`, 'data-state': s.states[entry.path]?.state ?? '' }, badgeEl(s.states[entry.path]))))));
}
function infoPanel() {
  const sel = selection(), entry = sel.length === 1 ? sel[0] : null;
  if (!entry) return folderInfo(sel);
  const st = s.states[entry.path], b = badge(st);
  return el('aside', { class: 'info', test: 'info' },
    el('div', { class: 'big' }, el('div', { class: 'icon' }, typeIcon(entry))),
    el('h4', {}, entry.name),
    stateText(st) && el('div', { class: `state ${b?.cls ?? ''}` }, stateText(st), st?.reason ? ` · ${reasonText(st.reason)}` : ''),
    el('dl', {},
      el('dt', {}, t('info_kind')), el('dd', {}, kindText(entry)),
      entry.kind === 'file' && el('dt', {}, t('info_size')), entry.kind === 'file' && el('dd', {}, size(entry.size)),
      el('dt', {}, t('info_modified')), el('dd', {}, when(entry.modified_ms)),
      el('dt', {}, t('info_where')), el('dd', {}, [s.root!.label, ...crumbs(s.path).map(c => c.name)].join(' › '))),
    el('div', { class: 'acts' },
      el('button', { class: 'secondary', onclick: () => void activate(entry) }, t('m_open')),
      el('button', { class: 'secondary', onclick: () => void reveal(entry.path) }, t('m_reveal')),
      entry.kind === 'file' && el('button', { class: 'secondary', onclick: () => void takeOut([entry.path]) }, t('m_export')),
      st?.state === 'failed' && el('button', { class: 'secondary', onclick: () => void retry([s.root!.folder]) }, t('m_retry'))));
}
/** Nothing (or several things) selected: what this folder holds, its sync state and where it is. */
function folderInfo(sel: Entry[]) {
  const dirs = s.entries.filter(e => e.kind === 'directory').length, filesN = s.entries.filter(e => e.kind === 'file').length;
  const bytes = s.entries.reduce((n, e) => n + (e.kind === 'file' ? e.size : 0), 0);
  const states = s.entries.map(e => s.states[e.path]?.state);
  const failedN = states.filter(x => x === 'failed').length, moving = states.filter(x => x === 'uploading' || x === 'downloading' || x === 'pending').length, cloudN = states.filter(x => x === 'cloud').length;
  const sync = failedN ? [t('footer_failed', { n: failedN }), 'bad'] : moving ? [t('card_syncing'), 'up'] : [t('card_ok'), 'ok'];
  const name = crumbs(s.path).at(-1)?.name ?? s.root!.label;
  return el('aside', { class: 'info', test: 'info' },
    el('div', { class: 'big' }, el('div', { class: 'icon' }, typeIcon({ name: '', kind: 'directory' }))),
    el('h4', {}, name),
    el('div', { class: `state ${sync[1]}` }, sync[0]),
    el('dl', {},
      el('dt', {}, t('info_contents')), el('dd', {}, t('info_counts', { n: s.entries.length, dirs, files: filesN })),
      el('dt', {}, t('info_size')), el('dd', {}, size(bytes)),
      cloudN > 0 && el('dt', {}, t('cloud_only')), cloudN > 0 && el('dd', {}, String(cloudN)),
      el('dt', {}, t('info_where')), el('dd', {}, [s.root!.label, ...crumbs(s.path).map(c => c.name)].join(' › ')),
      sel.length > 1 && el('dt', {}, t('info_selected')), sel.length > 1 && el('dd', {}, t('sel_bar', { n: sel.length, size: size(total(s.entries, s.selected)) }))),
    el('div', { class: 'acts' }, el('button', { class: 'secondary', onclick: () => void reveal(s.path) }, t('m_reveal'))),
    el('p', { class: 'hint' }, t('info_hint')));
}
function renderXfer() {
  const box = document.getElementById('xfer');
  if (!box) return;
  const jobs = s.jobs.slice(0, 20);
  if (!jobs.length) return box.replaceChildren();
  const copying = jobs.filter(j => j.stage === 'copying').length;
  const line = (j: Job) => {
    const st = s.states[j.path];
    const pct = j.stage === 'copying' ? (j.total ? Math.round(j.done / j.total * 100) : 0) : st?.state === 'uploading' ? Math.round((st.progress ?? 0) * 100) : 100;
    const label = j.stage === 'failed' ? t('job_failed', { error: j.error ?? '' }) : j.stage === 'copying' ? t('job_copying', { p: pct }) : st?.state === 'uploading' ? t('job_uploading', { p: pct }) : st?.state === 'synced' ? t('job_synced') : t('job_done');
    return el('div', { class: 'xi' }, el('span', { class: 'mini' }, typeIcon({ name: j.name, kind: 'file' })),
      el('div', { class: 'n' }, el('span', {}, j.name), el('span', { class: j.stage === 'failed' ? 'bad' : '' }, label)),
      el('div', { class: `xbar${st?.state === 'synced' ? ' done' : ''}` }, el('i', { style: `width:${j.stage === 'failed' ? 0 : pct}%` })));
  };
  box.replaceChildren(el('div', { class: 'xfer', test: 'xfer' },
    el('header', {}, el('b', {}, copying ? t('xfer_title', { n: copying }) : t('xfer_done', { n: jobs.filter(j => j.stage !== 'failed').length })),
      el('button', { class: 'ib', title: t('collapse'), onclick: () => { s.xferOpen = !s.xferOpen; renderXfer(); } }, s.xferOpen ? '⌄' : '⌃'),
      !copying && el('button', { class: 'ib', title: t('close'), test: 'xfer-close', onclick: () => { s.jobs = []; renderXfer(); } }, '✕')),
    ...(s.xferOpen ? jobs.map(line) : [])));
}
function failedView() {
  return el('main', { class: 'main failed', test: 'failed-view' },
    el('div', { class: 'top', style: 'border:0' }, el('div', { class: 'crumbs' }, t('failed_title')), el('span', { class: 'grow' }),
      s.failed.length > 0 && el('button', { class: 'primary', test: 'retry-all', onclick: () => void retry(s.failed.map(f => f.folder)) }, t('retry_all'))),
    el('div', { class: 'scroll' }, s.failed.length
      ? el('div', { class: 'list' }, el('div', { class: 'row head' }, el('span', {}, t('col_name')), el('span', {}, t('col_where')), el('span', {}, t('col_reason')), el('span', {})),
          ...s.failed.map(f => el('div', { class: 'row' }, el('span', { class: 'nm' }, el('span', { class: 'mini' }, typeIcon({ name: f.path, kind: 'file' })), el('span', {}, f.path)),
            el('span', { class: 'dim' }, s.folders.find(x => x.id === f.folder)?.name ?? ''), el('span', { class: 'dim' }, reasonText(f.reason)), el('span', {}))))
      : el('div', { class: 'empty' }, el('p', { style: 'color:var(--muted)' }, t('failed_empty')))));
}
function switcher() {
  const sw = s.switcher!;
  const items = s.roots.filter(r => r.label.toLocaleLowerCase().includes(sw.query.toLocaleLowerCase()));
  const index = Math.min(sw.index, Math.max(0, items.length - 1));
  const open = (r: Root | undefined) => { if (!r) return; s.switcher = null; void openPath(r, ''); };
  const box = el('div', { class: 'switch', test: 'switcher' },
    el('div', { class: 'search' }, '⌕', el('input', { value: sw.query, placeholder: t('search'),
      oninput: (e: Event) => { sw.query = (e.target as HTMLInputElement).value; sw.index = 0; render(); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'ArrowDown') { sw.index = Math.min(items.length - 1, index + 1); render(); e.preventDefault(); } if (e.key === 'ArrowUp') { sw.index = Math.max(0, index - 1); render(); e.preventDefault(); } if (e.key === 'Enter') open(items[index]); } })),
    el('div', { class: 'items' }, ...items.map((r, i) => el('button', { class: `it${i === index ? ' on' : ''}`, onclick: () => open(r) }, '📁 ', r.label, el('small', {}, String(s.folders.find(f => f.id === r.folder)?.files ?? ''))))),
    el('footer', {}, t('switch_hint', { n: s.roots.length })));
  setTimeout(() => { const i = box.querySelector('input')!; if (document.activeElement !== i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
  return box;
}
function pickPage() {
  const p = s.pick, linked = new Set(s.roots.filter(r => !r.prefix).map(r => r.folder));
  const all = [...s.folders].sort((a, b) => (p.by === 'files' ? b.files - a.files : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const matching = all.filter(f => f.name.toLocaleLowerCase().includes(p.query.trim().toLocaleLowerCase()));
  const todo = matching.filter(f => !linked.has(f.id)), done = matching.filter(f => linked.has(f.id));
  const many = s.folders.length > 3;
  const meta = (f: Folder) => t('folder_files', { files: f.files.toLocaleString(), state: t(f.state === 'synced' ? 'fs_synced' : f.state === 'syncing' || f.state === 'scanning' ? 'fs_syncing' : f.state === 'paused' ? 'fs_paused' : 'fs_other') });
  const row = (f: Folder, isAdded: boolean) => el('label', { class: 'pr', test: `pick.${f.name}` },
    isAdded ? el('span') : el('input', { type: 'checkbox', checked: p.checked.has(f.id), onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) p.checked.add(f.id); else p.checked.delete(f.id); render(); } }),
    el('span', { class: 'icon' }, typeIcon({ name: '', kind: 'directory' })),
    el('span', { class: 'tx' }, el('b', {}, f.name), el('small', {}, meta(f))),
    isAdded ? el('span', { class: 'done' }, t('added')) : el('button', { class: 'addb', test: `add.${f.id}`, onclick: (e: Event) => { e.preventDefault(); void addFolders([f.id]); } }, t('add')));
  const list = el('div', { class: 'pklist', test: 'pick-list' },
    many && el('div', { class: 'pkh' }, t('group_todo', { n: todo.length })),
    ...todo.map(f => row(f, false)),
    !matching.length && el('div', { class: 'pkempty' }, p.query ? t('no_match', { q: p.query }) : t('no_folders')),
    !todo.length && matching.length > 0 && !p.query && el('div', { class: 'pkempty' }, t('all_added')),
    many && done.length > 0 && el('div', { class: 'pkh' }, t('group_added', { n: done.length }), el('button', { onclick: () => { p.showAdded = !p.showAdded; render(); } }, p.showAdded ? t('collapse') : t('expand'))),
    ...(many && !p.showAdded ? [] : done.map(f => row(f, true))));
  const checked = [...p.checked].filter(id => todo.some(f => f.id === id));
  return el('div', { class: 'pk', test: 'onboarding' },
    s.pick.first && el('div', { class: 'intro' }, el('span', { class: 'logo' }, '☁'), el('div', {}, el('b', {}, t('onb_title')), el('small', {}, t('onb_note')))),
    el('div', { class: `pkbox${many ? ' fill' : ''}` },
      many && el('div', { class: 'pkbar' },
        el('div', { class: 'search' }, '⌕', el('input', { test: 'pick-search', value: p.query, placeholder: t('pick_search', { n: s.folders.length }), oninput: (e: Event) => { p.query = (e.target as HTMLInputElement).value; render(); const i = app.querySelector<HTMLInputElement>('[data-testid="netdisk.pick-search"]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); } })),
        el('select', { onchange: (e: Event) => { p.by = (e.target as HTMLSelectElement).value as 'name' | 'files'; render(); } },
          el('option', { value: 'name', selected: p.by === 'name' }, t('pick_by_name')), el('option', { value: 'files', selected: p.by === 'files' }, t('pick_by_files')))),
      list,
      todo.length > 0 && el('div', { class: 'pkfoot' },
        el('span', {}, checked.length ? `${t('selected_n', { n: checked.length })} · ${t('will_confirm')}` : ''), el('span', { class: 'grow' }),
        el('button', { class: 'secondary', onclick: () => { if (checked.length) p.checked.clear(); else todo.forEach(f => p.checked.add(f.id)); render(); } }, checked.length ? t('clear_selection') : t('select_all')),
        el('button', { class: 'primary', disabled: !checked.length, test: 'add-checked', onclick: () => void addFolders(checked) }, t('add_n', { n: checked.length || 0 })))),
    s.folders.length > 0 && el('div', { class: 'pkend' }, t('subfolder_q'), el('button', { class: 'secondary', test: 'subfolder', onclick: () => void addFolders(null) }, t('choose_subfolder'))));
}
function statePage() {
  const icon = { signed_out: '🔑', unavailable: '⟳', unsupported: '⌁' }[s.view as 'signed_out'];
  return el('div', { class: 'statepage', test: `state-${s.view}` },
    el('div', { class: 'si' }, icon), el('h3', {}, t(`${s.view}_title`)), el('p', {}, t(`${s.view}_note`)),
    s.view !== 'unsupported' && el('button', { class: 'secondary', test: 'retry', onclick: () => void start() }, t('retry')));
}

// Signed out or reconnecting: check again when the window comes back to the front (no timer).
addEventListener('focus', () => { if (s.view === 'signed_out' || s.view === 'unavailable') void start(); });
const offLocale = i18n.onDidChangeLocale(() => void i18n.catalog().then(c => { T = c; render(); }));
addEventListener('pagehide', () => { offLocale(); if (watch) void files.unwatch(watch); }, { once: true });
void start();
