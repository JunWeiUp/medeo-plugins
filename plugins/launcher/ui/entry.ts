// The panel: a generic client of the Medeo Launcher Protocol v1 (spec/launcher-v1.md).
// Everything it shows comes from plugins.commands (what plugins declare) and launcher.search
// (what providers answer); it knows no plugin by name.
import { applications, channel, clipboard, events, i18n, launcher, plugins, storage,
  type ApplicationEntry, type InstalledPluginCommands, type LauncherActionResult, type LauncherArgumentInfo, type LauncherEvent, type LauncherItem, type LauncherView } from '@medeo-plugin/sdk';
import { Usage, rank } from '../src/search.ts';
import { answer, appEntries } from '../src/results.ts';
import { argumentValue, catalogEntries, nextArgument, pinEntries, pinFor, resultEntries, scopeFor, sendTargets, type Entry, type Pin } from '../src/model.ts';
import type { FromWorker, ToWorker } from '../src/protocol.ts';

// ------------------------------------------------------------------ DOM helpers
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const query = $<HTMLInputElement>('query'), list = $('list'), body = $('body'), detail = $('detail'), menuBox = $('menu'),
  scopeBox = $('scope'), toastBox = $('toast'), who = $('who'), primaryBox = $('primary'), moreBox = $('more');
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
const kbd = (text: string) => el('kbd', '', text);
const code = (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'failed';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let copy: Record<string, string> = {}, locale = 'en';
const t = (key: string, params: Record<string, string | number> = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? ''));

// ------------------------------------------------------------------ state
let catalog: InstalledPluginCommands[] = [];
let commandRows: Entry[] = [], appRows: Entry[] = [], providerRows: Entry[] = [];
let scope: InstalledPluginCommands | null = null;
let pins: Pin[] = [];
const usage = new Usage();
const appIcons = new Map<string, string | null>();
let appsLoaded = 0;
interface Row { group?: string; entry: Entry }
interface Running { session: string; plugin: string; title: string; views: number; prompt?: string; done: boolean; ok?: boolean; error?: string }
type Mode =
  | { kind: 'search' }
  | { kind: 'args'; entry: Entry; argument: LauncherArgumentInfo }
  | { kind: 'view'; plugin: string; view: LauncherView; run?: Running; checks?: Map<string, boolean> };
let mode: Mode = { kind: 'search' };
let rows: Row[] = [], selected = 0, searchToken = 0, chips: InstalledPluginCommands[] = [];
interface MenuItem { id: string; title: string; key?: string; icon?: string | null; group?: string; destructive?: boolean; run: () => unknown }
let menu: MenuItem[] | null = null, menuSel = 0;
let current: Running | null = null;

const pluginById = (id?: string) => catalog.find(p => p.id === id);
/** "Add more plugins": opens the plugin center's Discover page. Searchable like any command. */
const centerEntry = (): Entry => ({ key: 'center', kind: 'center', title: t('center.title'), subtitle: t('center.subtitle'), symbol: 'plus',
  keywords: [t('center.keywords'), 'plugin center', 'install', 'discover', 'extensions'] });
/** Fewer than two plugins: the home page leads with a way to get more. */
const fewPlugins = () => catalog.length < 2;
const hide = () => channel.post({ type: 'hide' } satisfies ToWorker);

// ------------------------------------------------------------------ data
async function loadCatalog() {
  try { catalog = await plugins.commands(); } catch (error) { catalog = []; console.warn('plugins.commands', code(error)); }
  commandRows = [...catalogEntries(catalog, t('open')), centerEntry()];
  chips = catalog.filter(p => p.launcher?.keyword);
}
async function loadApps(refresh = false) {
  try {
    let inventory = await applications.list(refresh);
    for (let n = 0; inventory.status === 'loading' && n < 150; n++) { await pause(200); inventory = await applications.list(); }
    if (inventory.status === 'ready') { appRows = appEntries(inventory.entries as ApplicationEntry[]); appsLoaded = Date.now(); }
  } catch (error) { console.warn('applications', code(error)); }
}
async function loadState() {
  try { Object.assign(usage.entries, (await storage.get<Usage['entries']>('usage')) ?? {}); } catch { /* first run */ }
  try { pins = (await storage.get<Pin[]>('pins')) ?? []; } catch { pins = []; }
}
let saving: ReturnType<typeof setTimeout> | undefined;
function save() { clearTimeout(saving); saving = setTimeout(() => { void storage.set('usage', usage.entries).catch(() => {}); void storage.set('pins', pins).catch(() => {}); }, 300); }

/** App icons for the rows on screen, a small batch at a time. */
let iconsRunning = false;
async function fetchAppIcons() {
  if (iconsRunning) return; iconsRunning = true;
  try {
    for (let n = 0; n < 30; n++) {
      const wanted = rows.map(r => r.entry).filter(e => e.kind === 'app' && e.appId && !appIcons.has(e.key)).slice(0, 24);
      if (!wanted.length) return;
      const got = await applications.icons(wanted.map(e => e.appId!));
      let added = false;
      for (const e of wanted) if (e.appId! in got.icons) { appIcons.set(e.key, got.icons[e.appId!]); added = true; }
      if (added) draw();
      if (!got.pending && !added) { for (const e of wanted) appIcons.set(e.key, null); return; }
      await pause(120);
    }
  } catch { /* initials stay */ } finally { iconsRunning = false; }
}

// ------------------------------------------------------------------ building rows
const GLOBAL_PER_GROUP = 6;
function compose(): Row[] {
  const q = query.value;
  if (mode.kind === 'args') return argumentRows(mode.entry, mode.argument, q);
  if (mode.kind === 'view') return viewRows(mode);
  if (scope) {
    const mine = commandRows.filter(e => e.plugin === scope!.id);
    const local = q.trim() ? rank(mine, q, usage, 30) : mine;
    return [...local.map(entry => ({ group: t('group.commands'), entry })), ...providerRows.map(entry => ({ group: t('group.results'), entry }))];
  }
  if (!q.trim()) {
    const out: Row[] = [];
    const pinned = pinEntries(pins, commandRows);
    for (const entry of pinned) out.push({ group: t('group.pinned'), entry });
    const byKey = new Map([...commandRows, ...appRows].map(e => [e.key, e]));
    const pinnedKeys = new Set(pinned.map(p => p.key));
    for (const key of usage.recent(8)) { const entry = byKey.get(key); if (entry && !pinnedKeys.has(key) && key !== 'center') out.push({ group: t('group.recent'), entry }); }
    const home = out.slice(0, fewPlugins() ? 8 : 9);
    if (fewPlugins()) home.push({ group: t('group.plugins.more'), entry: centerEntry() });
    return home;
  }
  const out: Row[] = [];
  const top = answer(q, { calc: t('calc'), convert: t('convert') }, locale);
  if (top) out.push({ entry: top });
  // Local matches first, grouped by plugin (apps together), in order of each group's best match.
  const ranked = rank([...commandRows, ...appRows], q, usage, 40);
  const groups = new Map<string, Entry[]>();
  const add = (name: string, entry: Entry) => { const g = groups.get(name) ?? []; if (g.length < GLOBAL_PER_GROUP) g.push(entry); groups.set(name, g); };
  for (const entry of ranked) add(entry.kind === 'app' ? t('group.apps') : entry.pluginName ?? '', entry);
  for (const entry of providerRows) add(entry.pluginName ?? '', entry);
  for (const [name, entries] of groups) for (const entry of entries) out.push({ group: name, entry });
  return out;
}
function argumentRows(entry: Entry, argument: LauncherArgumentInfo, q: string): Row[] {
  if (argument.type === 'enum') {
    const needs = (entry.needs ?? []).filter(a => a.name !== argument.name);
    const options = argument.options.map(o => ({ ...entry, key: `${entry.key}|${o.value}`, kind: 'option' as const, title: o.title, subtitle: o.subtitle ?? '', keywords: o.keywords, image: o.icon, args: { ...(entry.args ?? {}), [argument.name]: o.value }, needs }));
    return (q.trim() ? rank(options, q, new Usage(), 32) : options).map(e => ({ entry: e }));
  }
  const value = argumentValue(argument, q);
  const hint = value === null ? (argument.placeholder ?? t('args.type', { name: argument.title })) : t('args.use', { value: String(value) });
  return [{ entry: { ...entry, key: `${entry.key}|value`, title: hint, subtitle: argument.title, needs: (entry.needs ?? []).filter(a => a.name !== argument.name), args: value === null ? undefined : { ...(entry.args ?? {}), [argument.name]: value } } }];
}
function viewRows(m: Extract<Mode, { kind: 'view' }>): Row[] {
  const view = m.view;
  const items: LauncherItem[] = view.type === 'list' || view.type === 'result' ? view.items ?? [] : [];
  return resultEntries([{ plugin_id: m.plugin, items }], catalog).map(entry => ({ group: view.type === 'result' ? t('group.next') : undefined, entry }));
}

// ------------------------------------------------------------------ actions
function actionsOf(entry: Entry): MenuItem[] {
  const out: MenuItem[] = [];
  const p = pluginById(entry.plugin);
  switch (entry.kind) {
    case 'answer': out.push({ id: 'copy', title: t('action.copy'), run: () => copyAnswer(entry) }); break;
    case 'app': out.push({ id: 'open', title: t('action.open'), run: () => openApp(entry) }); break;
    case 'open': out.push({ id: 'open', title: t('action.open'), run: () => openPlugin(entry) }); break;
    case 'center': out.push({ id: 'center', title: t('action.center'), run: () => openCenter() }); break;
    case 'command': case 'option':
      out.push({ id: 'run', title: nextArgument(entry) ? t('action.choose') : t('action.run'), run: () => runEntry(entry) });
      if (p?.has_ui) out.push({ id: 'window', title: t('action.window', { name: p.name }), icon: p.icon, run: () => openPlugin({ ...entry, kind: 'open' }) });
      break;
    case 'result':
      for (const a of entry.item?.actions ?? []) out.push({ id: a.id, title: a.title, key: a.shortcut, destructive: a.style === 'destructive', run: () => act(entry, a.id) });
      if (p?.has_ui) out.push({ id: 'window', title: t('action.window', { name: p.name }), icon: p.icon, run: () => openPlugin({ ...entry, kind: 'open', key: `open:${p.id}` }) });
      break;
  }
  if (entry.data) {
    for (const target of sendTargets(entry.data.type, catalog, entry.plugin)) {
      out.push({ id: `send:${target.plugin}:${target.command}`, title: target.title, group: t('menu.send'), icon: target.pluginIcon, run: () => send(entry, target.plugin, target.command, target.title) });
    }
  }
  const pin = pinFor(entry);
  if (pin) {
    const pinned = pins.some(x => x.key === pin.key || x.key === entry.key);
    out.push({ id: 'pin', title: pinned ? t('action.unpin') : t('action.pin'), key: 'Cmd+P', group: t('menu.launcher'), run: () => togglePin(entry) });
  }
  return out;
}
function togglePin(entry: Entry) {
  const pin = pinFor(entry); if (!pin) return;
  const at = pins.findIndex(x => x.key === pin.key || x.key === entry.key);
  if (at >= 0) pins.splice(at, 1); else pins = [pin, ...pins].slice(0, 9);
  save(); toast(at >= 0 ? t('toast.unpinned') : t('toast.pinned')); closeMenu(); refresh();
}
async function copyAnswer(entry: Entry) {
  await clipboard.write(entry.copy ?? entry.title);
  toast(t('toast.copied', { value: entry.copy ?? '' })); await pause(350); hide();
}
async function openApp(entry: Entry) {
  usage.used(entry.key); save(); hide();
  try {
    const task = await applications.launch(entry.appId!);
    for (let n = 0; n < 200; n++) {
      const state = await applications.state();
      if (state.launch?.id !== task.id || state.launch.status === 'completed') break;
      if (state.launch.status !== 'running') throw Error(state.launch.error ?? state.launch.status);
      await pause(100);
    }
  } catch (error) { toast(t('error.run', { title: entry.title, error: code(error) }), true); void loadApps(true); }
}
async function openCenter() {
  hide();
  try { await plugins.center(); } catch (error) { toast(t('error.run', { title: t('center.title'), error: code(error) }), true); }
}
async function openPlugin(entry: Entry) {
  usage.used(entry.key); save(); hide();
  try { await plugins.open(entry.plugin!); } catch (error) { toast(t('error.run', { title: entry.title, error: code(error) }), true); }
}
function runEntry(entry: Entry) {
  const argument = nextArgument(entry);
  if (argument) { mode = { kind: 'args', entry, argument }; query.value = ''; selected = 0; refresh(); return; }
  void runCommand(entry.plugin!, entry.command!, entry.args ?? {}, entry.title, entry.key);
}
/** Runs a command with a session, so whatever it shows appears here. */
async function runCommand(plugin: string, command: string, args: Record<string, unknown>, title: string, usageKey?: string) {
  if (usageKey) { usage.used(usageKey.startsWith('pin:') ? usageKey : usageKey.split('|')[0]); save(); }
  const run: Running = { session: uid(), plugin, title, views: 0, done: false };
  current = run;
  mode = { kind: 'view', plugin, view: { type: 'progress', title: t('view.running', { title }) }, run };
  query.value = ''; refresh();
  try { await launcher.run(plugin, command, args as never, run.session); run.ok = true; }
  catch (error) { run.ok = false; run.error = code(error); }
  run.done = true;
  if (current !== run) return;
  if (!run.ok) { show(plugin, { type: 'result', tone: 'error', title: t('error.run', { title, error: run.error ?? '' }) }, run); return; }
  // A command that showed nothing is done the moment it returns; one that did keeps its last view.
  if (!run.views) { toast(t('toast.done', { title })); await pause(400); if (current === run) { reset(); hide(); } return; }
  if (mode.kind === 'view' && mode.run === run && mode.view.type === 'progress') show(plugin, { type: 'result', tone: 'success', title: t('toast.done', { title }) }, run);
}
function send(entry: Entry, plugin: string, command: string, title: string) {
  closeMenu();
  void runCommand(plugin, command, { input: { type: entry.data!.type, value: entry.data!.value, title: entry.data!.title } }, title);
}
async function act(entry: Entry, action: string) {
  closeMenu();
  usage.used(entry.key); save();
  let result: LauncherActionResult;
  try { result = await launcher.act(entry.plugin!, entry.item!.id, action, query.value); }
  catch (error) { toast(t('error.run', { title: entry.title, error: code(error) }), true); return; }
  if (result.toast) toast(result.toast);
  if (result.view) { show(entry.plugin!, result.view); return; }
  if (result.refresh) void search();
  if (result.close) { await pause(result.toast ? 400 : 0); reset(); hide(); }
}
function show(plugin: string, view: LauncherView, run?: Running) {
  const checks = view.type === 'confirm' ? new Map((view.items ?? []).filter(i => i.id).map(i => [i.id!, i.checked !== false])) : undefined;
  mode = { kind: 'view', plugin, view, run, checks };
  selected = 0; refresh();
}
async function answerPrompt(confirmed: boolean) {
  if (mode.kind !== 'view' || !mode.run?.prompt) return;
  const prompt = mode.run.prompt; mode.run.prompt = undefined;
  const selectedIds = [...(mode.checks ?? new Map()).entries()].filter(([, on]) => on).map(([id]) => id);
  try { await launcher.answer(prompt, { confirmed, selected: selectedIds }); } catch { /* the command gave up meanwhile */ }
  if (!confirmed) { const run = mode.run; reset(); if (run) toast(t('toast.cancelled')); refresh(); return; }
  show(mode.plugin, { type: 'progress', title: t('view.running', { title: mode.run.title }) }, mode.run);
}
async function drainEvents() {
  let list: LauncherEvent[];
  try { list = await launcher.events(); } catch { return; }
  for (const event of list) {
    const run = current?.session === event.session ? current : null;
    if (!run) { if (event.type === 'prompt') void launcher.answer(event.prompt, { confirmed: false }).catch(() => {}); continue; }
    if (event.type === 'view') { run.views++; show(run.plugin, event.view, run); }
    else if (event.type === 'prompt') { run.views++; run.prompt = event.prompt; show(run.plugin, event.view, run); }
  }
}

// ------------------------------------------------------------------ search
async function search() {
  const token = ++searchToken, q = query.value;
  if (mode.kind !== 'search') return;
  if (!scope && !q.trim()) { providerRows = []; refresh(); return; }
  // Inside a plugin that answers no searches there is nothing to ask.
  if (scope && !scope.launcher?.provider) { providerRows = []; refresh(); return; }
  try {
    const answerSet = await launcher.search(q, scope ? { scope: scope.id } : {});
    if (token !== searchToken) return;
    providerRows = resultEntries(answerSet.results, catalog);
  } catch { providerRows = []; }
  refresh();
}
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onInput() {
  if (mode.kind === 'view' && !mode.run?.prompt) mode = { kind: 'search' };
  selected = 0;
  refresh();
  clearTimeout(searchTimer); searchTimer = setTimeout(() => void search(), 110);
}
function reset() { mode = { kind: 'search' }; current = null; menu = null; selected = 0; }

// ------------------------------------------------------------------ drawing
function iconBox(entry: Entry, small = false): HTMLElement {
  const box = el('span', 'ic');
  if (entry.kind === 'answer') { box.classList.add('answer'); box.textContent = '='; return box; }
  const src = entry.kind === 'app' ? appIcons.get(entry.key) : entry.image ?? (entry.symbol ? null : entry.pluginIcon);
  if (src) { box.classList.add('img'); const img = el('img'); img.src = src; img.alt = ''; box.append(img); return box; }
  if (entry.symbol && SYMBOLS[entry.symbol]) { box.classList.add('sym'); box.textContent = SYMBOLS[entry.symbol]; return box; }
  if (entry.pluginIcon && !small) { box.classList.add('img'); const img = el('img'); img.src = entry.pluginIcon; img.alt = ''; box.append(img); return box; }
  box.textContent = (entry.pluginName ?? entry.title).slice(0, 1).toUpperCase();
  return box;
}
const SYMBOLS: Record<string, string> = { plus: '＋', doc: '📄', text: '¶', image: '🖼', file: '📁', folder: '📁', link: '🔗', trash: '🗑', star: '★', clock: '🕘', gear: '⚙', check: '✓', warning: '⚠', search: '⌕', app: '◎', window: '▣', copy: '⧉', paste: '📋', bolt: '⚡', disk: '💽', undo: '↺' };
function tagOf(entry: Entry): string | null {
  if (entry.accessory) return null;
  return entry.kind === 'app' ? t('tag.app') : entry.kind === 'open' ? t('tag.plugin') : entry.kind === 'answer' ? t('tag.copy') : null;
}
function rowNode(row: Row, index: number): HTMLElement {
  const e = row.entry, item = el('div', `row ${e.kind}`);
  item.setAttribute('role', 'option'); item.dataset.testid = `launcher.row.${index}`; item.dataset.kind = e.kind; item.dataset.key = e.key;
  const text = el('span', 't'); text.append(el('b', '', e.title), el('small', '', e.subtitle));
  const acc = el('span', 'acc');
  if (e.accessory) acc.append(el('span', `pill ${e.accessory.tone}`, e.accessory.text));
  const tag = tagOf(e); if (tag) acc.append(el('span', 'pill', tag));
  acc.append(el('span', 'kbd', index < 9 ? `⌘${index + 1}` : ''));
  item.append(iconBox(e), text, acc);
  item.onmousemove = () => { if (selected !== index) { selected = index; drawSelection(); } };
  item.onclick = () => void primary(index);
  return item;
}
function draw() {
  scopeBox.hidden = !scope && mode.kind !== 'args';
  scopeBox.replaceChildren();
  const badgeOwner = mode.kind === 'args' ? pluginById(mode.entry.plugin) : scope;
  if (badgeOwner) {
    const icon = iconBox({ key: '', kind: 'open', title: badgeOwner.name, subtitle: '', keywords: [], pluginName: badgeOwner.name, image: badgeOwner.icon });
    scopeBox.append(icon, document.createTextNode(mode.kind === 'args' ? `${badgeOwner.name} · ${mode.entry.title} · ${mode.argument.title}` : badgeOwner.name));
  }
  query.placeholder = mode.kind === 'args' ? (mode.argument.placeholder ?? mode.argument.title) : scope ? t('placeholder.scope', { name: scope.name }) : t('placeholder');
  list.replaceChildren();
  if (mode.kind === 'view') list.append(viewCard(mode));
  if (mode.kind === 'args' && mode.argument.type === 'enum' && mode.argument.options.some(o => o.icon)) {
    const grid = el('div', 'grid'); grid.dataset.testid = 'launcher.grid';
    rows.forEach((row, index) => {
      const cell = el('div', 'cell'); cell.dataset.testid = `launcher.row.${index}`; cell.dataset.kind = 'option';
      if (row.entry.image) { const img = el('img'); img.src = row.entry.image; img.alt = ''; cell.append(img); }
      cell.append(el('span', '', row.entry.title)); if (row.entry.subtitle) cell.append(el('small', '', row.entry.subtitle));
      cell.onmousemove = () => { if (selected !== index) { selected = index; drawSelection(); } };
      cell.onclick = () => void primary(index);
      grid.append(cell);
    });
    list.append(grid);
  } else {
    let group: string | undefined;
    rows.forEach((row, index) => {
      if (row.group && row.group !== group) { list.append(el('div', 'group', row.group)); }
      group = row.group;
      list.append(rowNode(row, index));
    });
  }
  if (mode.kind === 'search' && !scope && !query.value.trim() && chips.length) {
    list.append(el('div', 'group', t('group.plugins')));
    const box = el('div', 'chips');
    for (const p of chips) {
      const chip = el('span', 'chip'); chip.dataset.testid = `launcher.chip.${p.launcher!.keyword}`;
      chip.append(iconBox({ key: '', kind: 'open', title: p.name, subtitle: '', keywords: [], pluginName: p.name, image: p.icon }, true), document.createTextNode(p.name), kbd(p.launcher!.keyword!));
      chip.onclick = () => enterScope(p);
      box.append(chip);
    }
    // With few plugins the home page already leads with a row for this.
    if (!fewPlugins()) {
    const more = el('span', 'chip more'); more.dataset.testid = 'launcher.chip.more';
    more.append(el('span', 'ic sym', '＋'), document.createTextNode(t('center.chip')));
    more.onclick = () => void openCenter();
    box.append(more);
    }
    list.append(box);
  }
  if (!rows.length && mode.kind === 'search' && (query.value.trim() || scope)) list.append(el('div', 'empty', t('empty.none')));
  if (!rows.length && mode.kind === 'search' && !query.value.trim() && !scope && !chips.length) list.append(el('div', 'empty', t('empty.start')));
  drawSelection();
}
function viewCard(m: Extract<Mode, { kind: 'view' }>): HTMLElement {
  const view = m.view, p = pluginById(m.plugin), card = el('div', `card${view.type === 'result' ? ` tone-${view.tone ?? 'success'}` : ''}`);
  card.dataset.testid = `launcher.view.${view.type}`;
  if (view.type === 'list') { if (view.title) card.append(el('h3', '', view.title)); return card; }
  const h = el('h3'); const mark = el('span', 'ic mark', view.type === 'result' ? ({ success: '✓', info: 'i', warning: '!', error: '✕' } as const)[view.tone ?? 'success'] : '');
  if (view.type !== 'result' && p) { mark.className = 'ic img'; if (p.icon) { const img = el('img'); img.src = p.icon; mark.append(img); } else mark.textContent = p.name[0]; }
  h.append(mark, document.createTextNode(view.title)); card.append(h);
  if (view.message) card.append(el('p', '', view.message));
  if (view.type === 'progress') {
    const bar = el('div', `progress${view.value === undefined ? ' busy' : ''}`), fill = el('i'); fill.style.width = `${Math.round((view.value ?? 0) * 100)}%`; bar.append(fill); card.append(bar);
  }
  if ((view.type === 'confirm' || view.type === 'progress') && view.items?.length) {
    const lines = el('div', 'lines');
    for (const item of view.items) {
      const line = el('div', 'line');
      const on = view.type === 'confirm' ? (item.id ? m.checks?.get(item.id) !== false : true) : item.state !== 'pending';
      const box = el('span', `box${view.type === 'confirm' ? (on ? '' : ' off') : ` ${item.state ?? 'done'}`}`, view.type === 'confirm' ? (on ? '✓' : '') : item.state === 'running' ? '…' : item.state === 'failed' ? '!' : item.state === 'pending' ? '' : '✓');
      if (view.type === 'confirm' && item.id) line.onclick = () => { m.checks?.set(item.id!, !on); draw(); };
      const label = el('span', '', item.title); if (item.subtitle) { label.append(el('br'), el('small', '', item.subtitle)); }
      line.append(box, label, el('small', '', item.accessory?.text ?? ''));
      lines.append(line);
    }
    card.append(lines);
  }
  if (view.type === 'confirm') {
    const btns = el('div', 'btns');
    const cancel = el('button', 'btn', view.cancel ?? t('view.cancel')); cancel.append(kbd('esc')); cancel.onclick = () => void answerPrompt(false);
    const go = el('button', `btn go${view.style === 'destructive' ? ' destructive' : ''}`, view.confirm ?? t('view.confirm')); go.append(kbd('↩')); go.onclick = () => void answerPrompt(true);
    go.dataset.testid = 'launcher.view.confirm.go';
    btns.append(cancel, go); card.append(btns);
  }
  if (view.type === 'progress' && m.run && !m.run.done) { const btns = el('div', 'btns'); const bg = el('button', 'btn', t('view.background')); bg.append(kbd('esc')); bg.onclick = () => { reset(); hide(); }; btns.append(bg); card.append(btns); }
  if (p && view.type !== 'result') { const from = el('div', 'from', t('view.from', { name: p.name })); card.append(from); }
  return card;
}
function drawSelection() {
  const nodes = list.querySelectorAll<HTMLElement>('.row, .cell');
  nodes.forEach((n, i) => { n.classList.toggle('sel', i === selected); n.setAttribute('aria-selected', String(i === selected)); });
  nodes[selected]?.scrollIntoView({ block: 'nearest' });
  const entry = rows[selected]?.entry;
  // Detail beside the list when the selected result has one.
  const d = entry?.item?.detail;
  body.classList.toggle('split', !!d); detail.hidden = !d; detail.replaceChildren();
  if (d) {
    const preview = el('div', 'preview'); preview.dataset.testid = 'launcher.detail.preview';
    if (d.image && 'data' in d.image) { const img = el('img'); img.src = d.image.data; preview.append(img); }
    if (d.text) preview.append(document.createTextNode(d.text));
    detail.append(preview);
    if (d.metadata?.length) { const dl = el('dl', 'meta'); for (const m of d.metadata) dl.append(el('dt', '', m.label), el('dd', '', m.value)); detail.append(dl); }
  }
  drawFooter(entry);
}
function drawFooter(entry?: Entry) {
  who.replaceChildren(); who.className = 'who'; primaryBox.replaceChildren(); moreBox.replaceChildren();
  if (mode.kind === 'view' && mode.view.type === 'confirm') {
    who.append(document.createTextNode(pluginById(mode.plugin)?.name ?? ''));
    primaryBox.append(document.createTextNode(mode.view.confirm ?? t('view.confirm')), kbd('↩'));
    moreBox.append(document.createTextNode(t('view.cancel')), kbd('esc'));
    return;
  }
  if (!entry) { moreBox.append(document.createTextNode(t('hint.scope')), kbd('⇥')); return; }
  const owner = entry.kind === 'app' ? t('tag.app') : entry.kind === 'answer' ? t('calc') : entry.kind === 'center' ? 'Medeo' : entry.pluginName ?? '';
  if (entry.pluginName) who.append(iconBox({ ...entry, kind: 'open', image: entry.pluginIcon, symbol: undefined }, true));
  who.append(document.createTextNode(owner));
  const first = actionsOf(entry)[0];
  if (first) primaryBox.append(document.createTextNode(first.title), kbd('↩'));
  moreBox.append(document.createTextNode(t('hint.actions')), kbd('⌘K'));
}
function refresh() { rows = compose(); selected = Math.min(selected, Math.max(0, rows.length - 1)); draw(); void fetchAppIcons(); }

// ------------------------------------------------------------------ menu (⌘K)
function openMenu() {
  const entry = rows[selected]?.entry; if (!entry) return;
  menu = actionsOf(entry); menuSel = 0; drawMenu();
}
function closeMenu() { menu = null; menuBox.hidden = true; }
function drawMenu() {
  if (!menu) { menuBox.hidden = true; return; }
  menuBox.hidden = false; menuBox.replaceChildren();
  const entry = rows[selected]?.entry;
  menuBox.append(el('div', 'head', entry?.title ?? ''));
  let group: string | undefined;
  menu.forEach((m, i) => {
    if (m.group && m.group !== group) menuBox.append(el('div', 'head', m.group));
    group = m.group;
    const r = el('div', `r${i === menuSel ? ' sel' : ''}${m.destructive ? ' destructive' : ''}`); r.dataset.testid = `launcher.menu.${m.id}`;
    if (m.icon !== undefined) { const ic = el('span', 'ic'); if (m.icon) { ic.className = 'ic img'; const img = el('img'); img.src = m.icon; ic.append(img); } r.append(ic); }
    r.append(el('span', 'label', m.title));
    if (i === 0) r.append(kbd('↩')); else if (i === 1 && !m.group) r.append(kbd('⌘↩')); else if (m.key) r.append(kbd(m.key.replace('Cmd+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥').replace('Ctrl+', '⌃')));
    r.onclick = () => { const run = m.run; closeMenu(); void run(); };
    menuBox.append(r);
  });
}

// ------------------------------------------------------------------ keys
async function primary(index = selected) {
  const entry = rows[index]?.entry; if (!entry) return;
  if (mode.kind === 'args') {
    if (!entry.args) return;
    const asked = mode.argument.name;
    const next: Entry = { ...mode.entry, args: entry.args, needs: (mode.entry.needs ?? []).filter(a => a.name !== asked) };
    mode = { kind: 'search' }; runEntry(next); return;
  }
  const first = actionsOf(entry)[0];
  if (first) await first.run();
}
function enterScope(p: InstalledPluginCommands) { scope = p; query.value = ''; selected = 0; mode = { kind: 'search' }; providerRows = []; refresh(); void search(); }
function leave(): boolean {
  if (menu) { closeMenu(); return true; }
  if (mode.kind === 'view' && mode.run?.prompt) { void answerPrompt(false); return true; }
  if (mode.kind !== 'search') { reset(); query.value = ''; refresh(); return true; }
  if (query.value) { query.value = ''; onInput(); return true; }
  if (scope) { scope = null; providerRows = []; refresh(); return true; }
  return false;
}
document.addEventListener('keydown', event => {
  const k = event.key;
  if (menu) {
    if (k === 'ArrowDown' || k === 'ArrowUp') { event.preventDefault(); menuSel = (menuSel + (k === 'ArrowDown' ? 1 : -1) + menu.length) % menu.length; drawMenu(); return; }
    if (k === 'Enter') { event.preventDefault(); const run = menu[menuSel]?.run; closeMenu(); void run?.(); return; }
  }
  if (mode.kind === 'view' && mode.view.type === 'confirm' && mode.run?.prompt && k === 'Enter' && !menu) { event.preventDefault(); void answerPrompt(true); return; }
  const grid = mode.kind === 'args' && !!list.querySelector('.grid');
  const move = (delta: number) => { event.preventDefault(); if (rows.length) { selected = (selected + delta + rows.length) % rows.length; drawSelection(); } };
  if (k === 'ArrowDown' || (event.ctrlKey && k === 'n')) move(grid ? 4 : 1);
  else if (k === 'ArrowUp' || (event.ctrlKey && k === 'p')) move(grid ? -4 : -1);
  else if (grid && (k === 'ArrowRight' || k === 'ArrowLeft') && !query.value) move(k === 'ArrowRight' ? 1 : -1);
  else if (k === 'Enter' && !event.isComposing) {
    event.preventDefault();
    if (event.metaKey) { const second = rows[selected] && actionsOf(rows[selected].entry)[1]; if (second) void second.run(); }
    else void primary();
  }
  else if (k === 'Escape') { event.preventDefault(); if (!leave()) hide(); }
  else if (k === 'Tab') {
    event.preventDefault();
    const target = scopeFor(query.value, catalog) ?? (rows[selected]?.entry.kind === 'open' ? pluginById(rows[selected].entry.plugin) : undefined);
    if (target?.launcher) enterScope(target);
  }
  else if (k === 'Backspace' && !query.value && (scope || mode.kind !== 'search')) { event.preventDefault(); leave(); }
  else if (event.metaKey && (k === 'k' || k === 'K')) { event.preventDefault(); if (menu) closeMenu(); else openMenu(); }
  else if (event.metaKey && (k === 'p' || k === 'P')) { event.preventDefault(); const e = rows[selected]?.entry; if (e && pinFor(e)) togglePin(e); }
  else if (event.metaKey && /^[1-9]$/.test(k)) { event.preventDefault(); void primary(Number(k) - 1); }
});
query.addEventListener('input', onInput);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, error = false) {
  toastBox.textContent = text; toastBox.className = `toast${error ? ' error' : ''}`; toastBox.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, error ? 4000 : 1800);
}

// ------------------------------------------------------------------ lifecycle
function shown() {
  query.focus(); query.select();
  // A command still showing its progress or a question stays; anything else starts over at home.
  if (!(mode.kind === 'view' && mode.run && (!mode.run.done || mode.run.prompt))) { reset(); scope = null; query.value = ''; providerRows = []; }
  void loadCatalog().then(refresh);
  if (Date.now() - appsLoaded > 5 * 60_000) void loadApps(appsLoaded > 0).then(refresh);
  refresh();
}
channel.onMessage<FromWorker>(message => { if (message?.type === 'shown') shown(); });
events.onSignal('launcher', drainEvents);
window.addEventListener('focus', () => query.focus());
async function localize() {
  copy = await i18n.catalog().catch(() => ({}));
  locale = (await i18n.state().catch(() => null))?.locale ?? navigator.language;
  document.title = t('plugin.name');
}
i18n.onDidChangeLocale(() => { void localize().then(loadCatalog).then(refresh); });

await localize();
await loadState();
await Promise.all([loadCatalog(), loadApps()]);
shown();
document.body.dataset.ready = 'true';
