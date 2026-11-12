// The window, laid out after Mackit: sidebar of categories with a startup-disk
// footer, a toolbar, and a sortable inset table. The worker owns scans and cleans.
import { channel, i18n, storage } from '@medeo-plugin/sdk';
import type { Item } from '../src/scan.ts';
import { scopeOf, type Scope } from '../src/scope.ts';
import { defaultSelection, GROUPS, rowItems, subRows, tick, type Row } from '../src/general.ts';
import type { Outcome } from '../src/clean.ts';
import type { Reply, Request, State } from '../src/protocol.ts';
import { crumbs, DISK_IDLE, squarify, tint, type DiskEntry, type DiskState, type DiskView } from '../src/disk.ts';
import { abbreviate, CATEGORY_STYLE, format, groups, matches, relative, safeIds, size, sorted, SORTS, total, type Sort } from '../src/view.ts';

const ROW = 37;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;
}
function icon(name: string, tint?: string, cls = '') {
  const i = el('i', `icon ${cls}`.trim()); i.style.setProperty('--src', `url(icons/${name}.svg)`); if (tint) i.style.color = tint; return i;
}
let copy: Record<string, string> = {}, locale = 'en', state: State | null = null, items: Item[] = [];
let rootDraft = '';
let focused = '', toastTimer: ReturnType<typeof setTimeout> | undefined;
let view: 'items' | 'general' | 'disk' | 'settings' = 'items', remembered: string[] | null = null, category = '', sort: Sort = 'sizeDescending', safeOnly = false, query = '', resultOpen = false, lastStatus = '';
const selected = new Set<string>();
let disk: DiskState = DISK_IDLE, folder: DiskView | null = null, includeProtected = false, rootMenu = false;
const t = (key: string, params: Record<string, string | number> = {}) => format(copy[key] ?? key, params);
const plural = (key: string, count: number, params: Record<string, string | number> = {}) => t(`${key}.${new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other'}`, { count, ...params });
const bytes = (n: number) => size(n, locale);
const send = (message: Request) => void channel.post(message);
const busy = () => state?.picking || state?.status === 'scanning' || state?.status === 'cleaning';
const style = (c: string) => CATEGORY_STYLE[c] ?? { icon: 'stack', tint: '#8e8e93' };
const inScope = (scope: Scope) => items.filter(i => scopeOf(i.category) === scope);
const scopeScanning = (scope: Scope) => state?.status === 'scanning' && state.scope === scope;

/** Row title: the child's name, the rule's title for a whole directory, or the command. */
function title(item: Item) { return item.kind === 'command' ? item.command ?? item.rule : item.name || t(`rule.${item.rule}.title`); }
/** A junk cleanup item's line under its row: where it comes from. */
function origin(item: Item) {
  if (item.category === 'language') return t('language.item.detail', { app: item.app ?? '' });
  if (item.category === 'downloads') return t(`${item.rule}.detail`);
  return abbreviate(item.path, state?.home ?? '');
}
const APP_NAMES: Record<string, string> = { 'codex-app': 'Codex', codex: 'Codex', 'claude-app': 'Claude' };
function subtitle(item: Item) {
  if (item.running && item.guard) return t('agent.running', { app: APP_NAMES[item.guard] });
  if (item.kind === 'command') return t(`rule.${item.rule}.note`);
  if (item.category === 'projects') return t('category.projects.title');
  return item.name ? t(`rule.${item.rule}.title`) : t(`category.${item.category}.title`);
}
const note = (item: Item) => item.category === 'projects' ? t('settings.projects.intro') : t(`rule.${item.rule}.note`);

/** Fits text into a width with an ellipsis in the middle (names) or at the start (paths), as Mackit does. */
const measure = document.createElement('canvas').getContext('2d')!;
function fit(text: string, width: number, font: string, mode: 'middle' | 'head'): string {
  measure.font = font;
  if (width <= 0 || measure.measureText(text).width <= width) return text;
  let low = 0, high = text.length;
  const cut = (n: number) => mode === 'head' ? `…${text.slice(text.length - n)}` : `${text.slice(0, Math.ceil(n / 2))}…${text.slice(text.length - Math.floor(n / 2))}`;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure.measureText(cut(mid)).width <= width) low = mid; else high = mid - 1; }
  return cut(low);
}

function visible(): Item[] {
  return sorted(inScope('developer').filter(i => (!category || i.category === category) && (!safeOnly || i.risk === 'safe') && matches(i, query, title(i))), sort, title);
}
function sideRow(iconName: string, tint: string, label: string, active: boolean, onClick: () => void, figures?: { count: number; size: number }, test?: string) {
  const b = el('button', `side-row${active ? ' active' : ''}`);
  if (test) b.dataset.testid = test;
  b.append(icon(iconName, tint), el('span', 'title', label));
  // Only the size fits next to a name in every language; the item count is in the tooltip.
  if (figures) { const f = el('span', 'figures'); f.append(el('b', '', bytes(figures.size))); b.append(f); b.title = `${label} · ${plural('count.items', figures.count)} · ${bytes(figures.size)}`; }
  b.onclick = onClick;
  return b;
}
function renderSidebar() {
  const dev = inScope('developer'), all = groups(dev);
  if (category && !all.some(g => g.category === category)) category = '';
  const general = sideRow('sparkles', 'var(--orange)', t('sidebar.generalCleanup'), view === 'general', () => { view = 'general'; render(); }, undefined, 'cleaner.nav.general');
  general.title = t('scope.general.summary');
  get('primary').replaceChildren(sideRow('stack', 'var(--accent)', t('sidebar.allItems'), view === 'items' && !category, () => { view = 'items'; category = ''; render(); },
    { count: dev.length, size: total(dev) }, 'cleaner.nav.all'), general);
  get('categories-title').textContent = all.length ? t('sidebar.categories') : '';
  get('categories').replaceChildren(...all.map(g => {
    const s = style(g.category), row = sideRow(s.icon, s.tint, t(`category.${g.category}.title`), view === 'items' && category === g.category,
      () => { view = 'items'; category = g.category; render(); }, { count: g.items.length, size: g.bytes }, `cleaner.nav.${g.category}`);
    row.title = t(`category.${g.category}.summary`); return row;
  }));
  const analysis = sideRow('pie', 'var(--purple)', t('sidebar.diskAnalysis'), view === 'disk', () => { view = 'disk'; render(); }, undefined, 'cleaner.nav.disk');
  analysis.title = t('disk.hero.message');
  get('primary').append(analysis);
  get('secondary').replaceChildren(sideRow('gear', 'var(--accent)', t('sidebar.settings'), view === 'settings', () => { view = 'settings'; render(); }, undefined, 'cleaner.nav.settings'));
  // Startup disk, as in Mackit's footer: accent until 75 % used, then orange, red past 90 %.
  const free = state?.free ?? null, capacity = state?.capacity ?? null;
  get('disk-title').textContent = t('sidebar.startupDisk');
  get('disk-free').textContent = free === null ? '' : t('sidebar.available', { size: bytes(free) });
  get('disk-total').textContent = capacity === null ? '' : t('sidebar.totalCapacity', { size: bytes(capacity) });
  const used = free !== null && capacity ? 1 - free / capacity : 0, bar = get('disk-bar');
  bar.style.width = `${Math.round(used * 100)}%`;
  bar.style.background = used > .9 ? 'var(--red)' : used > .75 ? 'var(--orange)' : 'var(--accent)';
}
function renderToolbar() {
  // The junk cleanup page has its own header, as in Mackit.
  get('toolbar').hidden = view === 'general' || view === 'disk';
  const scanning = scopeScanning('developer'), rescan = get('rescan');
  rescan.className = `pill${scanning ? ' stop' : ''}`;
  rescan.replaceChildren(icon(scanning ? 'stop' : 'refresh'), el('span', '', t(scanning ? 'toolbar.stopScan' : 'toolbar.rescan')));
  (rescan as HTMLButtonElement).disabled = state?.status === 'cleaning' || scopeScanning('general');
  // List controls belong to the list; the settings page keeps only rescan and clean.
  for (const id of ['sort', 'safe-only', 'search']) get(id).closest('.menu-anchor, label')!.toggleAttribute('hidden', view === 'settings');
  get('sort').querySelector('span')!.textContent = t(`sort.${sort}`);
  const dev = inScope('developer');
  (get('sort') as HTMLButtonElement).disabled = !dev.length;
  get('sort-menu').replaceChildren(...SORTS.map(s => {
    const b = el('button', s === sort ? 'on' : ''); b.append(icon('check'), el('span', '', t(`sort.${s}`)));
    b.onclick = () => { sort = s; get('sort-menu').hidden = true; render(); }; return b;
  }));
  get('safe-label').textContent = t('toolbar.safeOnly');
  get('safe-only').closest('label')!.classList.toggle('disabled', !dev.length);
  const chosen = dev.filter(i => selected.has(i.id)), freed = total(chosen), clean = get<HTMLButtonElement>('clean');
  clean.querySelector('span')!.textContent = freed ? t('clean.buttonWithSize', { size: bytes(freed) }) : t('clean.button');
  clean.disabled = !chosen.length || busy();
  clean.title = chosen.length ? plural('clean.helpSelected', chosen.length) : t('clean.helpNoSelection');
  const banner = get('banner');
  banner.hidden = !scanning || view !== 'items';
  get('banner-title').textContent = t('scan.progress.title');
  get('banner-found').textContent = dev.length ? plural('scan.banner.found', dev.length, { size: bytes(total(dev)) }) : t('scan.preparing');
}
const COLUMNS: { key: string; sort?: [Sort, Sort] }[] = [
  { key: '' }, { key: 'table.name', sort: ['nameAscending', 'nameDescending'] }, { key: 'table.size', sort: ['sizeDescending', 'sizeAscending'] },
  { key: 'table.modified', sort: ['dateDescending', 'dateAscending'] }, { key: 'table.risk' }, { key: 'table.path' },
];
function renderHeader() {
  get('thead').replaceChildren(...COLUMNS.map(c => {
    const cell = el('div', c.sort ? 'sortable' : '', c.key ? t(c.key) : '');
    if (c.sort) {
      if (c.sort.includes(sort)) cell.append(icon('chevron', undefined, sort === c.sort[1] && c.key !== 'table.size' || sort === 'sizeAscending' ? 'flip' : ''));
      cell.onclick = () => { sort = sort === c.sort![0] ? c.sort![1] : c.sort![0]; render(); };
    }
    return cell;
  }));
}
let shown: Item[] = [];
function renderRows() {
  const body = get('tbody'), start = Math.max(0, Math.floor(body.scrollTop / ROW) - 6), count = Math.ceil(body.clientHeight / ROW) + 12;
  get('spacer').style.height = `${shown.length * ROW}px`;
  const rows = get('rows'); rows.style.transform = `translateY(${start * ROW}px)`;
  // Column widths from the header, for middle/head truncation like Mackit's table.
  const cells = get('thead').children, nameWidth = (cells[1] as HTMLElement).clientWidth - 44, pathWidth = (cells[5] as HTMLElement).clientWidth - 26;
  const font = getComputedStyle(document.body).fontFamily;
  rows.replaceChildren(...shown.slice(start, start + count).map((item, i) => {
    const row = el('div', `row${selected.has(item.id) ? ' selected' : ''}${item.running ? ' running' : ''}${item.id === focused ? ' focused' : ''}`);
    if ((start + i) % 2) row.style.background = selected.has(item.id) ? '' : 'var(--alt)';
    row.dataset.testid = `cleaner.row.${item.id}`; row.setAttribute('role', 'checkbox'); row.setAttribute('aria-checked', String(selected.has(item.id)));
    row.title = note(item);
    const check = el('span', 'check'); check.append(icon('check'));
    const name = el('div', 'name'), text = el('div'), s = style(item.category);
    text.append(el('b', '', fit(title(item), nameWidth, `500 13px ${font}`, 'middle')), el('small', '', fit(subtitle(item), nameWidth, `11px ${font}`, 'middle')));
    name.append(icon(s.icon, s.tint), text);
    const risk = el('span', `risk ${item.risk}`); risk.append(icon(item.risk === 'safe' ? 'shield' : item.risk === 'review' ? 'alert' : 'octagon'), el('span', '', t(`risk.${item.risk}.title`)));
    risk.title = t(`risk.${item.risk}.hint`);
    const riskCell = el('div'); riskCell.append(risk);
    const pathText = abbreviate(item.path, state?.home ?? ''), path = el('div', 'path', fit(pathText, pathWidth, `11px ${font}`, 'head'));
    path.title = pathText;
    row.append(check, name, el('div', `size${item.kind === 'command' ? ' estimate' : ''}`, !item.bytes ? t('size.unknown') : item.kind === 'command' ? `≈ ${bytes(item.bytes)}` : bytes(item.bytes)),
      el('div', 'modified', relative(item.modified, locale)), riskCell, path);
    row.oncontextmenu = event => menu(event, item);
    row.onclick = () => { if (busy()) return; if (selected.has(item.id)) selected.delete(item.id); else selected.add(item.id); renderRows(); renderToolbar(); };
    return row;
  }));
}
/** The list's context menu, as in Mackit: actions on the clicked row, then selection of the visible rows. */
function menu(event: MouseEvent, item: Item | null) {
  event.preventDefault(); event.stopPropagation();
  focused = item?.id ?? ''; renderRows();
  const box = get('ctx'), entries: HTMLElement[] = [];
  const entry = (iconName: string, key: string, run: () => void, test: string, disabled = false, cls = '') => {
    const b = el('button', cls); b.append(icon(iconName), el('span', '', t(key))); b.disabled = disabled; b.dataset.testid = `cleaner.ctx.${test}`;
    b.onclick = () => { close(); run(); }; entries.push(b);
  };
  const line = () => entries.push(el('hr'));
  if (item) {
    const file = item.kind !== 'command';
    entry('reveal', 'ctx.revealInFinder', () => send({ type: 'item', action: 'reveal', id: item.id }), 'reveal', !file);
    entry('terminal', 'ctx.openInTerminal', () => send({ type: 'item', action: 'terminal', id: item.id }), 'terminal', !file);
    entry('copy', 'ctx.copyPath', () => send({ type: 'item', action: 'copy', id: item.id }), 'copy');
    line();
    entry('trash', 'ctx.moveToTrash', () => send({ type: 'item', action: 'trash', id: item.id }), 'trash', !file || busy(), 'danger');
    line();
  }
  const rows = visible();
  entry('check-circle', 'ctx.selectAll', () => { for (const i of rows) selected.add(i.id); render(); }, 'select-all', busy());
  entry('circle', 'ctx.deselectAll', () => { for (const i of rows) selected.delete(i.id); render(); }, 'deselect-all', busy());
  line();
  entry('shield', 'ctx.selectSafeOnly', () => { for (const i of rows) selected.delete(i.id); for (const id of safeIds(rows)) selected.add(id); render(); }, 'select-safe', busy());
  box.replaceChildren(...entries); box.hidden = false;
  // Keep it inside the window.
  const { innerWidth: w, innerHeight: h } = window, r = box.getBoundingClientRect();
  box.style.left = `${Math.min(event.clientX, w - r.width - 6)}px`; box.style.top = `${Math.min(event.clientY, h - r.height - 6)}px`;
}
function close() { if (get('ctx').hidden) return; get('ctx').hidden = true; focused = ''; renderRows(); }
function showToast(tone: string, text: string) {
  const box = get('toast'); box.className = `toast ${tone}`;
  box.replaceChildren(icon(tone === 'success' ? 'check-circle' : tone === 'info' ? 'alert' : 'octagon'), el('span', '', text)); box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
}
function renderWelcome(show: boolean) {
  const box = get('welcome'); box.hidden = !show; get('thead').hidden = show;
  if (!show || !state) return;
  const glyph = el('div', 'glyph'), start = el('button', 'cta');
  glyph.append(icon('sparkles')); start.append(icon('search'), el('span', '', t('welcome.start')));
  start.dataset.testid = 'cleaner.start'; start.onclick = () => send({ type: 'scan', scope: 'developer' });
  const parts: HTMLElement[] = [glyph, el('h2', '', t('welcome.title')), el('p', '', t('welcome.message')), start];
  if (state.roots.length) { const note = el('div', 'note'); note.append(icon('folder'), el('span', '', plural('welcome.projectRoots', state.roots.length))); parts.push(note); }
  box.replaceChildren(...parts);
}
function renderList() {
  shown = visible();
  get('list').hidden = view !== 'items'; get('settings').hidden = view !== 'settings'; get('general').hidden = view !== 'general'; get('disk').hidden = view !== 'disk';
  const dev = inScope('developer');
  Object.assign(document.body.dataset, { items: String(dev.length), general: String(inScope('general').length), status: state?.status ?? '', scope: state?.scope ?? '' });
  get('rows').dataset.shown = String(shown.length);
  const empty = get('empty');
  // Nothing scans until asked: before the first scan the list is Mackit's welcome.
  const fresh = !!state && !state.scanned.developer && !scopeScanning('developer') && !dev.length;
  renderWelcome(fresh);
  empty.hidden = fresh || !!shown.length || scopeScanning('developer');
  const [titleKey, messageKey] = dev.length ? ['empty.noMatch.title', 'empty.noMatch.message'] : ['empty.noItems.title', 'empty.noItems.message'];
  empty.querySelector('b')!.textContent = t(titleKey); empty.querySelector('p')!.textContent = t(messageKey);
  renderHeader(); renderRows();
}
function renderSettings() {
  if (view !== 'settings' || !state) return;
  const page = get('settings'), s = state;
  const roots = el('div', 'group');
  roots.append(...(s.roots.length ? s.roots.map(root => {
    const row = el('div'), remove = el('button', 'link', t('common.remove'));
    remove.disabled = !!busy(); remove.dataset.testid = 'drive.projects.remove';
    remove.setAttribute('aria-label', `${t('common.remove')} ${root}`);
    remove.onclick = () => send({ type: 'roots', action: 'remove', roots: [root] });
    row.append(icon('folder', 'var(--accent)'), el('span', 'grow', abbreviate(root, s.home)), remove); return row;
  }) : [el('div', 'muted', t('settings.projects.empty'))]));
  const add = el('div', 'root-add'), input = el('input'), button = el('button', 'link', t('common.add'));
  input.type = 'text'; input.placeholder = t('settings.projects.textField'); input.dataset.testid = 'cleaner.root.input';
  input.setAttribute('aria-label', t('settings.projects.textField')); input.value = rootDraft;
  input.disabled = !!busy(); button.disabled = !!busy() || !rootDraft.trim(); button.dataset.testid = 'drive.projects.add';
  input.oninput = () => { rootDraft = input.value; button.disabled = !!busy() || !rootDraft.trim(); };
  const submit = () => { const value = input.value.trim(); if (value && !busy()) send({ type: 'roots', action: 'add', roots: [value] }); };
  button.onclick = submit; input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) submit(); };
  const choose = el('button', 'pill', t(s.picking ? 'settings.projects.choosing' : 'settings.projects.choose'));
  choose.dataset.testid = 'drive.projects.choose'; choose.disabled = !!busy(); choose.onclick = () => send({ type: 'choose-roots' });
  add.append(input, button, choose); roots.append(add);
  const chips = el('div', 'chips');
  chips.append(el('span', '', t('settings.projects.quickAdd')), ...s.suggestions.map(r => {
    const b = el('button', '', `${r.added ? '✓' : '+'} ${r.path}`);
    b.dataset.testid = 'drive.projects.quick-add'; b.dataset.path = r.path;
    b.disabled = !!busy() || r.added || !r.available;
    b.title = t(r.added ? 'settings.projects.added' : !r.available ? 'settings.projects.notExist' : 'settings.projects.quickHint', { path: r.path });
    b.onclick = () => send({ type: 'roots', action: 'add', roots: [r.path] }); return b;
  }));
  const addAll = el('button', 'link', t('settings.projects.addAll'));
  addAll.dataset.testid = 'drive.projects.add-all';
  const candidates = s.suggestions.filter(r => r.available && !r.added).map(r => r.path);
  addAll.disabled = !!busy() || !candidates.length;
  addAll.onclick = () => send({ type: 'roots', action: 'add', roots: candidates }); chips.append(addAll);
  const toggle = (label: string, on: boolean, change: (v: boolean) => void, test: string) => {
    const row = el('label'), box = el('input'), track = el('span', 'track');
    box.type = 'checkbox'; box.checked = on; box.hidden = true; box.dataset.testid = test; box.onchange = () => change(box.checked);
    row.className = 'switch'; row.append(el('span', 'grow', label), box, track); return row;
  };
  const behavior = el('div', 'group');
  behavior.append(toggle(t('settings.moveToTrash'), s.method === 'trash', v => send({ type: 'settings', method: v ? 'trash' : 'delete' }), 'cleaner.settings.trash'),
    toggle(t('settings.includeCLI'), s.commands, v => send({ type: 'settings', commands: v }), 'cleaner.settings.commands'));
  const agents = el('div', 'group'), daysRow = el('div'), days = el('input');
  days.type = 'number'; days.min = '7'; days.step = '1'; days.value = String(s.sessionDays); days.className = 'days'; days.dataset.testid = 'cleaner.settings.session-days';
  days.onchange = () => { const v = Math.round(Number(days.value)); if (v >= 7) send({ type: 'settings', sessionDays: v }); else days.value = String(s.sessionDays); };
  daysRow.append(el('span', 'grow', t('settings.agents.sessionDays')), days); agents.append(daysRow);
  page.replaceChildren(el('h2', '', t('settings.projects.header')), el('p', 'note', t('settings.projects.intro')), roots, chips, el('p', 'note root-hint', t('settings.projects.rescanHint')),
    el('h2', '', t('settings.cleanMethod')), behavior, el('h2', '', t('settings.agents.header')), agents);
}
/** Confirmation, after Mackit's sheet: what, how much, risk notices, and how it is removed. */
function confirm(scope: Scope = 'developer') {
  if (!state) return;
  const chosen = sorted(inScope(scope).filter(i => selected.has(i.id)), 'sizeDescending', title), dialog = get<HTMLDialogElement>('confirm');
  const caution = chosen.some(i => i.risk === 'caution'), review = chosen.some(i => i.risk === 'review');
  const head = el('div', 'sheet-head'), badge = el('div', 'badge');
  badge.style.setProperty('--tint', caution ? 'var(--red)' : 'var(--accent)'); badge.append(icon(caution ? 'octagon' : 'trash'));
  const words = el('div'); words.append(el('h2', '', t('clean.confirm.title')), el('p', '', plural('clean.confirm.summary', chosen.length, { size: bytes(total(chosen)) })));
  head.append(badge, words);
  const list = el('div', 'sheet-list'), header = el('header'), ul = el('ul');
  header.append(el('span', '', t('clean.confirm.list')), el('span', '', plural('clean.confirm.listCount', chosen.length)));
  ul.append(...chosen.map(i => {
    const li = el('li'), text = el('div'), s = style(i.category);
    const font = getComputedStyle(document.body).fontFamily;
    text.append(el('b', i.kind === 'command' ? 'mono' : '', title(i)), el('small', '', i.kind === 'command' ? subtitle(i) : fit(abbreviate(i.path, state!.home), 330, `11px ${font}`, 'head')));
    if (i.app) li.title = i.app;
    li.append(icon(s.icon, s.tint), text, el('span', 'size', i.kind === 'command' ? `≈ ${bytes(i.bytes)}` : bytes(i.bytes))); return li;
  }));
  list.append(header, ul);
  const notices: HTMLElement[] = [];
  const notice = (iconName: string, tint: string, titleText: string | null, message: string) => {
    const n = el('div', 'notice'); n.style.setProperty('--tint', tint); const text = el('div');
    if (titleText) text.append(el('b', '', titleText)); text.append(el('span', '', message)); n.append(icon(iconName), text); notices.push(n);
  };
  const busyApps = [...new Set(chosen.filter(i => i.running && i.guard).map(i => APP_NAMES[i.guard!]))];
  if (busyApps.length) notice('alert', 'var(--orange)', null, busyApps.map(app => t('agent.running', { app })).join(' · '));
  if (caution) notice('octagon', 'var(--red)', t('clean.confirm.cautionTitle'), t('clean.confirm.cautionMessage'));
  else if (review) notice('alert', 'var(--orange)', t('clean.confirm.reviewTitle'), t('clean.confirm.reviewMessage'));
  notice(state.method === 'trash' ? 'trash' : 'bolt', 'var(--secondary)', null, t(state.method === 'trash' ? 'clean.confirm.toTrash' : 'clean.confirm.permanent'));
  const actions = el('div', 'sheet-actions'), cancel = el('button', '', t('common.cancel')), go = el('button', 'primary', t(caution ? 'clean.confirm.cleanAnyway' : 'clean.confirm.cleanNow'));
  go.style.setProperty('--tint', caution ? 'var(--red)' : 'var(--accent)'); go.dataset.testid = 'cleaner.confirm.go';
  cancel.onclick = () => dialog.close();
  go.onclick = () => { dialog.close(); resultOpen = true; send({ type: 'clean', ids: chosen.map(i => i.id), method: state!.method }); };
  actions.append(cancel, go);
  dialog.replaceChildren(head, list, ...notices, actions);
  dialog.showModal();
}
function failure(o: Outcome): string {
  const code = o.error ?? '';
  if (code === 'protected') return t('clean.error.protected');
  if (code === 'running') return t('error.running');
  if (copy[`error.${code}`]) return t(`error.${code}`);
  return /trash/i.test(code) ? t('clean.error.trashFailed') : code;
}
/** Cleaning progress, then the result card until the user closes it. */
function renderProgress() {
  const dialog = get<HTMLDialogElement>('progress-sheet');
  if (!state || !(state.status === 'cleaning' || resultOpen && state.status === 'done' && lastStatus !== 'scanning')) { if (dialog.open) dialog.close(); return; }
  const badge = el('div', 'badge');
  if (state.status === 'cleaning') {
    badge.style.setProperty('--tint', 'var(--accent)'); badge.append(icon('trash'));
    const bar = el('div', 'bar'), fill = el('span'); fill.style.width = `${Math.round(state.progress.done / Math.max(1, state.progress.total) * 100)}%`; bar.append(fill);
    dialog.replaceChildren(badge, el('h2', '', t('clean.progress.title')), el('p', '', plural('clean.progress.cleaned', state.progress.done)), bar);
  } else {
    const failed = state.outcomes.filter(o => !o.ok), freed = state.outcomes.reduce((n, o) => n + o.freed, 0);
    badge.style.setProperty('--tint', failed.length ? 'var(--orange)' : 'var(--green)'); badge.append(icon(failed.length ? 'alert' : 'check'));
    const parts: HTMLElement[] = [badge, el('h2', '', failed.length ? plural('clean.result.doneWithFailures', failed.length) : t('clean.result.done')),
      el('p', '', t(state.method === 'trash' ? 'clean.result.movedToTrash' : 'clean.result.reclaimed', { size: bytes(freed) }))];
    if (failed.length) {
      const ul = el('ul'); ul.append(el('li', '', t('clean.result.failuresTitle')), ...failed.slice(0, 20).map(o => el('li', '', `${abbreviate(o.id.split(':').slice(1).join(':') || o.id, state!.home)} — ${failure(o)}`)));
      parts.push(ul);
    }
    const actions = el('div', 'sheet-actions'), done = el('button', 'primary', t('common.done'));
    done.dataset.testid = 'cleaner.result.done'; done.onclick = () => { resultOpen = false; dialog.close(); };
    actions.append(done); parts.push(actions);
    dialog.replaceChildren(...parts); dialog.dataset.kind = 'result';
  }
  if (!dialog.open) dialog.showModal();
}
const LEVEL: Record<string, string> = { safe: 'general.badge.veryClean', review: 'general.badge.recommended', caution: 'general.badge.caution' };
function tickIcon(state: 'all' | 'some' | 'none', size = '') { const s = el('span', `tick ${state} ${size}`.trim()); if (state !== 'none') s.append(icon(state === 'all' ? 'check' : 'minus')); return s; }
function toggle(ids: string[]) { const on = tick(ids, selected) !== 'all'; for (const id of ids) on ? selected.add(id) : selected.delete(id); render(); }
/** Rows the user has (partly) ticked: what "Remember" stores. */
const tickedRows = (list: Item[]) => GROUPS.flatMap(g => g.rows).filter(r => tick(rowItems(r, list).map(i => i.id), selected) !== 'none').map(r => r.id);
function subTitle(row: Row, key: string) {
  if (row.sub !== 'language') return key;
  try { return new Intl.DisplayNames([locale], { type: 'language' }).of(key) ?? key; } catch { return key; }
}
/** Junk cleanup, after Mackit's GeneralCleanupView: hero before the first scan, then groups of rows. */
function renderGeneral() {
  if (view !== 'general' || !state) return;
  const list = inScope('general'), scanning = scopeScanning('general'), scanned = !!state.scanned.general;
  const chosen = list.filter(i => selected.has(i.id)), body = get('g-body'), head = get('general').querySelector('header')!;
  head.hidden = !scanned && !scanning && !list.length;
  get('g-title').textContent = t('general.header.title');
  const totalText = get('g-total');
  totalText.className = scanning || !list.length ? 'text' : '';
  totalText.textContent = scanning ? t('scan.progress.title.general') : list.length ? bytes(total(list)) : t('general.header.none');
  get('g-progress').hidden = !scanning;
  get('g-label').textContent = scanning ? plural('scan.banner.found', list.length, { size: bytes(total(list)) }) : '';
  const actions: HTMLElement[] = [];
  const button = (label: string, iconName: string, cls: string, onClick: () => void, test: string) => {
    const b = el('button', cls); b.append(icon(iconName), el('span', '', label)); b.onclick = onClick; b.dataset.testid = test; return b;
  };
  if (!scanning && list.length) {
    const defaults = GROUPS.flatMap(g => g.rows).filter(r => r.preChecked && rowItems(r, list).length).map(r => r.id).sort().join();
    if (remembered) actions.push(button(t('general.restoreDefault'), 'refresh', 'pill', () => {
      remembered = null; void storage.remove('general.rows'); selected.clear(); for (const id of defaultSelection(list, null)) selected.add(id); render();
    }, 'cleaner.general.restore'));
    else if (tickedRows(list).sort().join() !== defaults) actions.push(button(t('general.remember.action'), 'check', 'pill', () => {
      remembered = tickedRows(list); void storage.set('general.rows', remembered); render();
    }, 'cleaner.general.remember'));
    if (remembered) actions[0].title = t('general.restoreDefault.help'); else if (actions[0]) actions[0].title = t('general.remember.help');
  }
  actions.push(button(t(scanning ? 'toolbar.stopScan' : 'toolbar.rescan'), scanning ? 'stop' : 'refresh', `pill${scanning ? ' stop' : ''}`,
    () => send(scanning ? { type: 'cancel' } : { type: 'scan', scope: 'general' }), 'cleaner.general.scan'));
  if (chosen.length && !scanning) {
    const clean = button(t('clean.buttonWithSize', { size: bytes(total(chosen)) }), 'trash', 'cta', () => confirm('general'), 'cleaner.general.clean');
    (clean as HTMLButtonElement).disabled = busy(); clean.title = plural('clean.helpSelected', chosen.length); actions.push(clean);
  }
  get('g-actions').replaceChildren(...actions);
  if (!scanned && !scanning && !list.length) {
    const hero = el('div', 'hero'), glyph = el('div', 'glyph'), start = el('button', 'cta');
    glyph.append(icon('sparkles')); start.append(icon('search'), el('span', '', t('general.header.start')));
    start.dataset.testid = 'cleaner.general.start'; start.onclick = () => send({ type: 'scan', scope: 'general' });
    hero.append(glyph, el('h2', '', t('general.hero.title')), el('p', '', t('general.hero.message')), start);
    body.replaceChildren(hero); return;
  }
  body.replaceChildren(...GROUPS.flatMap(group => {
    const groupItems = group.rows.flatMap(r => rowItems(r, list)), ids = groupItems.map(i => i.id);
    const head = el('button', 'group-head'), name = el('b', '', t(`general.group.${group.id}`));
    head.dataset.testid = `cleaner.general.group.${group.id}`; head.title = t('general.group.toggleHelp'); name.style.color = group.tint;
    head.append(tickIcon(tick(ids, selected)), icon(group.icon, group.tint), name,
      el('span', 'sum', t('general.group.summary', { total: bytes(total(groupItems)), selected: bytes(total(groupItems.filter(i => selected.has(i.id)))) })));
    head.onclick = () => toggle(ids);
    const card = el('div', 'card');
    card.append(...group.rows.map(row => {
      const rowList = rowItems(row, list), rowIds = rowList.map(i => i.id), wrap = el('div');
      const r = el('button', 'rule-row'), text = el('div', 'text'), trail = el('span', 'trail');
      r.dataset.testid = `cleaner.general.row.${row.id}`; r.setAttribute('aria-checked', tick(rowIds, selected));
      text.append(el('b', '', t(row.title)), el('small', '', t(row.note)));
      if (rowList.length) trail.append(el('span', '', t('general.row.total', { size: bytes(total(rowList)) })), el('i', '', t('general.row.separator')));
      trail.append(el('span', `level ${row.risk}`, t(LEVEL[row.risk])));
      r.append(tickIcon(tick(rowIds, selected), 'big'), text, trail);
      r.onclick = () => { if (rowIds.length) toggle(rowIds); };
      wrap.append(r);
      const subs = subRows(row, list);
      if (subs.length) {
        const box = el('div', 'subs');
        box.append(...subs.map(sub => {
          const b = el('button', 'sub-row'), text = el('div', 'text'), subIds = sub.items.map(i => i.id);
          b.dataset.testid = `cleaner.general.sub.${row.id}.${sub.key}`;
          const apps = row.sub === 'language' ? [...new Set(sub.items.map(i => i.app ?? ''))] : [];
          text.append(el('span', '', subTitle(row, sub.key)));
          if (apps.length) { const detail = new Intl.ListFormat(locale).format(apps); text.append(el('small', '', detail)); b.title = detail; }
          b.append(tickIcon(tick(subIds, selected), 'small'), text, el('span', 'size', bytes(total(sub.items))));
          b.onclick = () => toggle(subIds); return b;
        }));
        wrap.append(box);
      } else if (rowList.length) wrap.title = rowList.slice(0, 12).map(i => `${title(i)} — ${origin(i)}`).join('\n');
      return wrap;
    }));
    return [head, card];
  }));
}
/** Disk analysis, after DaisyDisk: what fills a folder, as a treemap and a list largest first. */
const count = (n: number) => new Intl.NumberFormat(locale).format(n);
const rootName = (root: string) => root === state?.home ? t('disk.root.home') : root === '/' ? t('disk.root.startup') : abbreviate(root, state?.home ?? '');
function analyzeRoot(root: string) { rootMenu = false; send({ type: 'disk-scan', root, includeProtected }); }
function chooseRoot() { rootMenu = false; send({ type: 'disk-choose', includeProtected }); }
const diskBusy = () => disk.status === 'scanning' || disk.status === 'opening';
/** Moving about the tree works during an analysis too; only reading a folded folder waits. */
const opening = () => disk.status === 'opening';
const openable = (e: DiskEntry) => (e.kind === 'directory' || e.kind === 'restricted') && !(disk.status === 'scanning' && e.folded);
function entryName(e: DiskEntry) { return e.kind === 'other' ? plural('disk.entry.other', e.count ?? 0, { count: count(e.count ?? 0) }) : e.name; }
function entryNote(e: DiskEntry) {
  if (e.pending) return t('disk.entry.counting');
  if (e.kind === 'restricted') return t('disk.entry.restricted');
  if (e.kind === 'file') return relative(e.modified, locale);
  // Compact (2.9M, 294万) so the narrow column shows it whole.
  return plural('disk.files', e.files, { count: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(e.files) });
}
function entryIcon(e: DiskEntry, index: number) {
  return icon(e.kind === 'restricted' ? 'lock' : e.kind === 'directory' ? 'folder' : e.kind === 'other' ? 'stack' : 'file', tint(e.kind, e.name, index));
}
/** Hovering a tile lights its row and the other way round. */
function hover(path: string, on: boolean) {
  for (const n of get('d-body').querySelectorAll<HTMLElement>('[data-path]')) if (n.dataset.path === path) n.classList.toggle('hot', on);
}
function diskMenu(event: MouseEvent, e: DiskEntry) {
  event.preventDefault(); event.stopPropagation();
  if (e.kind === 'other') return;
  const box = get('ctx'), entries: HTMLElement[] = [];
  const entry = (iconName: string, key: string, run: () => void, test: string, disabled = false, cls = '') => {
    const b = el('button', cls); b.append(icon(iconName), el('span', '', t(key))); b.disabled = disabled; b.dataset.testid = `cleaner.disk.ctx.${test}`;
    b.onclick = () => { box.hidden = true; run(); }; entries.push(b);
  };
  if (openable(e)) entry('folder', 'disk.ctx.open', () => send({ type: 'disk-open', path: e.path }), 'open', opening());
  entry('reveal', 'ctx.revealInFinder', () => send({ type: 'disk-item', action: 'reveal', path: e.path }), 'reveal');
  entry('terminal', 'ctx.openInTerminal', () => send({ type: 'disk-item', action: 'terminal', path: e.path }), 'terminal');
  entry('copy', 'ctx.copyPath', () => send({ type: 'disk-item', action: 'copy', path: e.path }), 'copy');
  entries.push(el('hr'));
  entry('trash', 'ctx.moveToTrash', () => confirmTrash(e), 'trash', diskBusy(), 'danger');
  box.replaceChildren(...entries); box.hidden = false;
  const { innerWidth: w, innerHeight: h } = window, r = box.getBoundingClientRect();
  box.style.left = `${Math.min(event.clientX, w - r.width - 6)}px`; box.style.top = `${Math.min(event.clientY, h - r.height - 6)}px`;
}
/** Unlike a cleaner item this may be the user's own work, so moving it asks first. */
function confirmTrash(e: DiskEntry) {
  const dialog = get<HTMLDialogElement>('confirm'), head = el('div', 'sheet-head'), badge = el('div', 'badge'), words = el('div');
  badge.style.setProperty('--tint', 'var(--red)'); badge.append(icon('trash'));
  words.append(el('h2', '', t('disk.confirm.title')), el('p', '', t('disk.confirm.message', { name: e.name, size: bytes(e.bytes) })));
  head.append(badge, words);
  const where = el('div', 'notice'), text = el('div');
  text.append(el('span', '', abbreviate(e.path, state?.home ?? ''))); where.append(icon(e.kind === 'file' ? 'file' : 'folder'), text);
  const actions = el('div', 'sheet-actions'), cancel = el('button', '', t('common.cancel')), go = el('button', 'primary', t('disk.confirm.go'));
  go.style.setProperty('--tint', 'var(--red)'); go.dataset.testid = 'cleaner.disk.confirm.go';
  cancel.onclick = () => dialog.close();
  go.onclick = () => { dialog.close(); send({ type: 'disk-item', action: 'trash', path: e.path }); };
  actions.append(cancel, go);
  dialog.replaceChildren(head, where, actions); dialog.showModal();
}
function protectedSwitch() {
  const row = el('label', 'pill switch'), box = el('input'), track = el('span', 'track');
  box.type = 'checkbox'; box.checked = includeProtected; box.dataset.testid = 'cleaner.disk.protected';
  box.onchange = () => { includeProtected = box.checked; };
  row.title = t('disk.protected.hint'); row.append(icon('lock'), el('span', '', t('disk.protected.label')), box, track);
  return row;
}
function renderDisk() {
  if (view !== 'disk' || !state) return;
  // During an analysis the tree is drawn as it grows (the worker sends the shown folder a few times a second).
  const scanning = disk.status === 'scanning', shown = !!folder && (scanning || !!disk.finished), body = get('d-body');
  get('disk').querySelector('header')!.hidden = !scanning && !shown;
  get('d-title').textContent = scanning ? t('disk.scanning.title', { name: rootName(disk.root ?? '') }) : t('disk.title');
  get('d-total').textContent = scanning || shown ? bytes(disk.bytes) : '';
  const label: string[] = [];
  if (scanning) label.push(plural('disk.files', disk.files, { count: count(disk.files) }));
  else if (shown) {
    label.push(rootName(disk.root ?? ''), plural('disk.files', disk.files, { count: count(disk.files) }), t('disk.took', { seconds: ((disk.took ?? 0) / 1000).toFixed(1) }));
    if (disk.partial) label.push(t('disk.partial'));
    // The whole disk: what the walk could not see (snapshots, swap, other users, system-only folders).
    const used = state.capacity !== null && state.free !== null ? state.capacity - state.free : null;
    if (disk.root === '/' && !disk.partial && used !== null && used - disk.bytes > 1e9) label.push(t('disk.unread', { size: bytes(used - disk.bytes) }));
  }
  get('d-label').textContent = label.join(' · ');
  // Actions: another location, again, or stop.
  const actions: HTMLElement[] = [];
  if (scanning) {
    const stop = el('button', 'pill stop'); stop.append(icon('stop'), el('span', '', t('disk.stop')));
    stop.dataset.testid = 'cleaner.disk.stop'; stop.onclick = () => send({ type: 'disk-cancel' }); actions.push(stop);
  } else if (shown) {
    actions.push(protectedSwitch());
    const anchor = el('div', 'menu-anchor'), other = el('button', 'pill'), list = el('div', 'menu');
    other.append(icon('drive'), el('span', '', t('disk.other')), icon('chevron', undefined, 'small'));
    other.dataset.testid = 'cleaner.disk.roots'; other.disabled = diskBusy() || !!state.picking;
    other.onclick = event => { event.stopPropagation(); rootMenu = !rootMenu; list.hidden = !rootMenu; };
    list.hidden = !rootMenu; list.setAttribute('role', 'menu');
    const item = (iconName: string, key: string, run: () => void, test: string) => {
      const b = el('button', 'on'); b.append(icon(iconName), el('span', '', t(key))); b.dataset.testid = `cleaner.disk.root.${test}`; b.onclick = run; return b;
    };
    list.append(item('home', 'disk.root.home', () => analyzeRoot(state!.home), 'home'), item('drive', 'disk.root.startup', () => analyzeRoot('/'), 'startup'),
      item('folder', 'disk.root.choose', chooseRoot, 'choose'));
    anchor.append(other, list); actions.push(anchor);
    const again = el('button', 'pill'); again.append(icon('refresh'), el('span', '', t('disk.rescan')));
    again.dataset.testid = 'cleaner.disk.rescan'; again.disabled = diskBusy(); again.onclick = () => analyzeRoot(disk.root!); actions.push(again);
  }
  get('d-actions').replaceChildren(...actions);
  if (scanning && !shown) {
    const panel = el('div', 'hero analysis-progress'), spin = el('div', 'bar indeterminate');
    spin.append(el('span')); panel.append(el('span', 'spinner'), spin);
    panel.dataset.testid = 'cleaner.disk.progress';
    body.replaceChildren(panel); return;
  }
  if (!shown) {
    const hero = el('div', 'hero'), glyph = el('div', 'glyph violet'), buttons = el('div', 'hero-actions');
    glyph.append(icon('pie'));
    const start = el('button', 'cta'); start.append(icon('home'), el('span', '', t('disk.start.home')));
    start.dataset.testid = 'cleaner.disk.start'; start.onclick = () => analyzeRoot(state!.home); start.disabled = !!state.picking;
    const whole = el('button', 'pill'); whole.append(icon('drive'), el('span', '', t('disk.root.startup')));
    whole.dataset.testid = 'cleaner.disk.start.startup'; whole.onclick = () => analyzeRoot('/');
    const pick = el('button', 'pill'); pick.append(icon('folder'), el('span', '', t('disk.root.choose')));
    pick.dataset.testid = 'cleaner.disk.start.choose'; pick.onclick = chooseRoot; pick.disabled = !!state.picking;
    buttons.append(start, whole, pick);
    hero.append(glyph, el('h2', '', t('disk.hero.title')), el('p', '', t('disk.hero.message')), buttons, protectedSwitch());
    body.replaceChildren(hero); return;
  }
  const f = folder!;
  // Breadcrumb, with "up" like ⌘↑ in Finder.
  const bar = el('div', 'crumbs'), up = el('button', 'pill icon-only'), trail = crumbs(disk.root!, f.path);
  up.append(icon('up')); up.title = t('disk.up'); up.dataset.testid = 'cleaner.disk.up';
  up.disabled = trail.length < 2 || opening(); up.onclick = () => send({ type: 'disk-open', path: trail[trail.length - 2].path });
  bar.append(up);
  trail.forEach((c, i) => {
    if (i) bar.append(icon('chevron', undefined, 'small turn'));
    const b = el('button', i === trail.length - 1 ? 'current' : '', i ? c.name : rootName(c.path));
    b.disabled = i === trail.length - 1 || opening(); b.onclick = () => send({ type: 'disk-open', path: c.path }); bar.append(b);
  });
  if (disk.status === 'opening') { const s = el('span', 'opening'); s.append(el('span', 'spinner'), el('span', '', t('disk.opening'))); bar.append(s); }
  // The folder being read, under the breadcrumb, while the analysis runs.
  const strip = el('div', 'scan-strip');
  if (scanning) {
    const spin = el('div', 'bar indeterminate'); spin.append(el('span'));
    strip.append(el('span', 'spinner'), el('span', 'mono'), spin); strip.dataset.testid = 'cleaner.disk.progress';
  }
  const split = el('div', 'analysis-split'), map = el('div', 'treemap'), list = el('div', 'analysis-list');
  map.dataset.testid = 'cleaner.disk.map'; list.dataset.testid = 'cleaner.disk.list';
  split.append(map, list);
  body.replaceChildren(bar, ...(scanning ? [strip] : []), split);
  if (scanning) {
    const where = strip.querySelector<HTMLElement>('.mono')!;
    where.textContent = fit(abbreviate(disk.current, state.home), where.clientWidth, `11px ${getComputedStyle(document.body).fontFamily}`, 'head');
    where.title = disk.current;
  }
  const entries = f.entries.filter(e => e.bytes > 0 || e.kind === 'restricted');
  if (!entries.length) { list.append(el('div', 'muted empty-folder', t('disk.empty'))); }
  const largest = Math.max(1, ...entries.map(e => e.bytes));
  list.append(...entries.map((e, i) => {
    const row = el('button', `analysis-row${openable(e) ? ' openable' : ''}${e.pending ? ' pending' : ''}`), text = el('div', 'text'), meter = el('span', 'meter'), fill = el('span');
    row.dataset.path = e.path; row.dataset.testid = `cleaner.disk.row.${e.name || 'other'}`;
    text.append(el('b', '', entryName(e)), el('small', '', entryNote(e)));
    fill.style.width = `${Math.max(1, Math.round(e.bytes / largest * 100))}%`; fill.style.background = tint(e.kind, e.name, i); meter.append(fill);
    const share = f.bytes ? e.bytes / f.bytes : 0;
    row.append(entryIcon(e, i), text, meter, el('span', 'size', e.kind === 'restricted' ? '—' : bytes(e.bytes)),
      el('span', 'share', e.kind === 'restricted' ? '' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: share < .1 ? 1 : 0 }).format(share)));
    row.title = e.kind === 'other' ? '' : abbreviate(e.path, state!.home);
    row.disabled = !openable(e) && e.kind !== 'file';
    row.onclick = () => { if (openable(e) && !opening()) send({ type: 'disk-open', path: e.path }); };
    row.oncontextmenu = event => diskMenu(event, e);
    row.onmouseenter = () => hover(e.path, true); row.onmouseleave = () => hover(e.path, false);
    return row;
  }));
  drawMap(map, entries);
}
/** Tiles for the folder's entries and, inside big folders, their own largest entries. */
function drawMap(map: HTMLElement, entries: DiskEntry[]) {
  const sized = entries.filter(e => e.bytes > 0), font = getComputedStyle(document.body).fontFamily;
  const rects = squarify(sized.map(e => e.bytes), { x: 0, y: 0, w: map.clientWidth, h: map.clientHeight });
  map.replaceChildren(...sized.map((e, i) => {
    const r = rects[i], colour = tint(e.kind, e.name, entries.indexOf(e)), tile = el('div', `tile${openable(e) ? ' openable' : ''}${e.pending ? ' pending' : ''}`);
    Object.assign(tile.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    tile.style.setProperty('--tint', colour);
    tile.dataset.path = e.path; tile.title = `${entryName(e)} — ${bytes(e.bytes)}`;
    const labelled = r.w > 54 && r.h > 30;
    if (labelled) {
      const label = el('div', 'tile-label');
      label.append(el('b', '', fit(entryName(e), r.w - 12, `600 11px ${font}`, 'middle')), el('small', '', bytes(e.bytes)));
      tile.append(label);
    }
    // One level deeper, drawn faintly, as DaisyDisk's rings show what is inside.
    if (e.inner?.length && r.w > 70 && r.h > 70) {
      const inner = e.inner.filter(g => g.bytes > 0), box = { x: 3, y: labelled ? 34 : 3, w: r.w - 6, h: r.h - (labelled ? 37 : 6) };
      squarify(inner.map(g => g.bytes), box).forEach((q, k) => {
        if (q.w < 3 || q.h < 3) return;
        const sub = el('div', 'sub-tile'); Object.assign(sub.style, { left: `${q.x}px`, top: `${q.y}px`, width: `${q.w}px`, height: `${q.h}px` });
        if (q.w > 60 && q.h > 18) sub.textContent = fit(inner[k].name, q.w - 8, `10px ${font}`, 'middle');
        tile.append(sub);
      });
    }
    tile.onclick = () => { if (openable(e) && !opening()) send({ type: 'disk-open', path: e.path }); };
    tile.oncontextmenu = event => diskMenu(event, e);
    tile.onmouseenter = () => hover(e.path, true); tile.onmouseleave = () => hover(e.path, false);
    return tile;
  }));
}
function render() {
  if (!state) return;
  const ids = new Set(items.map(i => i.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  renderSidebar(); renderToolbar(); renderList(); renderGeneral(); renderDisk(); renderSettings(); renderProgress();
}
function bind() {
  for (const node of document.querySelectorAll<HTMLElement>('[data-icon]')) node.style.setProperty('--src', `url(icons/${node.dataset.icon}.svg)`);
  get('rescan').onclick = () => send(scopeScanning('developer') ? { type: 'cancel' } : { type: 'scan', scope: 'developer' });
  get('sort').onclick = event => { event.stopPropagation(); get('sort-menu').hidden = !get('sort-menu').hidden; };
  document.addEventListener('click', () => { get('sort-menu').hidden = true; if (rootMenu) { rootMenu = false; renderDisk(); } });
  get<HTMLInputElement>('safe-only').onchange = () => { safeOnly = get<HTMLInputElement>('safe-only').checked; render(); };
  get('search').oninput = () => { query = get<HTMLInputElement>('search').value; render(); };
  get('clean').onclick = () => confirm('developer');
  get('tbody').onscroll = () => { close(); renderRows(); };
  get('tbody').oncontextmenu = event => menu(event, null);
  document.addEventListener('click', event => { if (!get('ctx').contains(event.target as Node)) close(); });
  addEventListener('blur', close);
  addEventListener('resize', () => { renderRows(); renderDisk(); });
  // ⌘R scans again, ⌘⌫ cleans the selection, ⌥⌘S selects every safe item — Mackit's shortcuts.
  addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (!e.metaKey) return;
    if (view === 'disk') {
      // ⌘R analyzes again, ⌘↑ goes up a folder.
      if (e.key === 'r' && disk.root && !diskBusy()) { e.preventDefault(); analyzeRoot(disk.root); }
      else if (e.key === 'ArrowUp' && folder && disk.root && folder.path !== disk.root && !opening()) { e.preventDefault(); const trail = crumbs(disk.root, folder.path); send({ type: 'disk-open', path: trail[trail.length - 2].path }); }
      return;
    }
    const scope: Scope = view === 'general' ? 'general' : 'developer';
    if (e.key === 'r') { e.preventDefault(); if (!busy()) send({ type: 'scan', scope }); }
    else if (e.key === 'Backspace' && !busy() && inScope(scope).some(i => selected.has(i.id))) { e.preventDefault(); confirm(scope); }
    else if (e.key === 's' && e.altKey) { e.preventDefault(); for (const id of safeIds(visible())) selected.add(id); render(); }
  });
}
async function loadCopy() {
  copy = await i18n.catalog(); locale = (await i18n.state()).locale; document.documentElement.lang = locale;
  get('search').setAttribute('placeholder', t('toolbar.searchPlaceholder')); document.title = t('plugin.name');
  render();
}
bind();
channel.onMessage<Reply>(message => {
  if (message?.type === 'items') {
    const reset = message.reset;
    if (reset) items = reset === 'all' ? [] : items.filter(i => scopeOf(i.category) !== reset);
    items = items.concat(message.items);
    return;
  }
  if (message?.type === 'toast') { showToast(message.tone, t(message.key, message.params ?? {})); return; }
  if (message?.type === 'removed') { const gone = new Set(message.ids); items = items.filter(i => !gone.has(i.id)); return; }
  if (message?.type === 'disk') {
    const first = disk.status === 'idle' && !disk.finished, previous = disk.status;
    disk = message.state;
    if (first) includeProtected = disk.includeProtected;
    // A new analysis starts from an empty picture; its first snapshot follows at once.
    if (disk.status === 'scanning' && previous !== 'scanning' || disk.status === 'idle' && !disk.finished) folder = null;
    render(); return;
  }
  if (message?.type === 'disk-view') { folder = message.view; render(); return; }
  if (message?.type !== 'state') return;
  const first = !state;
  lastStatus = state?.status ?? ''; state = message.state;
  // A finished junk scan ticks the remembered rows, or the defaults.
  if (lastStatus === 'scanning' && state.status === 'done' && state.scope === 'general') for (const id of defaultSelection(inScope('general'), remembered)) selected.add(id);
  render();
});
i18n.onDidChangeLocale(() => void loadCopy());
void storage.get<string[]>('general.rows').then(v => { remembered = Array.isArray(v) ? v : null; }).catch(() => {});
void loadCopy().then(() => send({ type: 'hello' }));
