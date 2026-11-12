// The floating panel, after EcoPaste: search, categories, starred items and notes, and a
// settings page. ↩ pastes into the app the user was in; the worker does the pasting.
import { channel, i18n } from '@medeo-plugin/sdk';
import { baseName, counts, FILTERS, filterOf, NOTE_CHARS, preview, search, type Entry, type Filter } from '../src/history.ts';
import { acceleratorOf, DEFAULTS, MAX_ITEMS, RETENTION_DAYS, shortcutLabel, type Settings } from '../src/settings.ts';
import type { Reply, Request, State } from '../src/protocol.ts';

const PAGE = 150;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;
}
function icon(name: string) { const i = el('i', 'icon'); i.style.setProperty('--src', `url(icons/${name}.svg)`); return i; }

let copy: Record<string, string> = {}, locale = 'en';
let state: State = { ready: false, error: null, settings: DEFAULTS, trusted: null, shortcutError: null };
let entries: Entry[] = [], filter: Filter = 'all', query = '', selected = '', limit = PAGE, view: 'history' | 'settings' = 'history';
let editing = '', recording = false, toastTimer: ReturnType<typeof setTimeout> | undefined;
const thumbs = new Map<string, string | null>();
const format = (text: string, params: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => k in params ? String(params[k]) : m);
const t = (key: string, params: Record<string, string | number> = {}) => format(copy[key] ?? key, params);
const plural = (key: string, count: number) => t(`${key}.${new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other'}`, { count: count.toLocaleString(locale) });
const send = (message: Request) => void channel.post(message);
const visible = () => search(entries, query, filter);

function relative(ms: number, now = Date.now()): string {
  const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = (ms - now) / 1000;
  for (const [unit, next] of [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12]] as [Intl.RelativeTimeFormatUnit, number][]) {
    if (Math.abs(value) < next) return unit === 'second' ? f.format(0, 'second') : f.format(Math.round(value), unit);
    value /= next;
  }
  return f.format(Math.round(value), 'year');
}
function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n.toLocaleString(locale, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
const LEAD_ICON = { text: 'text', rich: 'rich', image: 'image', files: 'folder' } as const;

// ── History ────────────────────────────────────────────────────────────────
function lead(entry: Entry) {
  const group = filterOf(entry.kind), url = thumbs.get(entry.id);
  if (entry.kind === 'image' && url) { const box = el('div', 'lead thumb'), img = el('img'); img.src = url; img.alt = ''; box.append(img); return box; }
  const box = el('div', `lead ${group}`); box.append(icon(LEAD_ICON[group])); return box;
}
function content(entry: Entry) {
  if (entry.kind === 'files') {
    const list = el('div', 'files-list'), files = entry.files ?? [];
    for (const file of files.slice(0, 3)) { const s = el('span', '', baseName(file)); s.title = file; list.append(s); }
    if (files.length > 3) list.append(el('small', '', t('files.more', { count: files.length - 3 })));
    return list;
  }
  if (entry.kind === 'image') return el('div', 'preview', entry.width && entry.height ? `${entry.width} × ${entry.height}` : t('kind.image'));
  const p = el('div', `preview${/^\s*[{[<]|^(\s{2,}|\t)/m.test(entry.text) ? ' mono' : ''}`, preview(entry.text));
  p.title = entry.text.slice(0, 1200);
  return p;
}
function meta(entry: Entry, index: number) {
  const m = el('div', 'meta');
  if (entry.favorite) { const star = icon('star-fill'); star.classList.add('star'); m.append(star); }
  m.append(el('span', 'badge', t(`kind.${entry.kind}`)));
  const parts = [entry.app, relative(entry.copiedAt),
    entry.kind === 'files' ? plural('meta.files', entry.size) : entry.kind === 'image' ? bytes(entry.size) : plural('meta.chars', entry.size)];
  for (const part of parts.filter(Boolean)) m.append(el('span', 'dot'), el('span', '', part!));
  if (index < 9) m.append(el('span', 'index', `⌘${index + 1}`));
  return m;
}
function noteEditor(entry: Entry) {
  const area = el('textarea', 'note-edit');
  area.value = entry.note ?? ''; area.maxLength = NOTE_CHARS; area.placeholder = t('note.placeholder');
  area.dataset.testid = 'clipboard.row.note-input';
  const finish = (save: boolean) => { if (!editing) return; editing = ''; if (save) send({ type: 'note', id: entry.id, note: area.value }); renderList(); };
  area.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  area.onblur = () => finish(true);
  area.onclick = e => e.stopPropagation();
  queueMicrotask(() => { area.focus(); area.select(); });
  return area;
}
function actionButton(name: string, title: string, test: string, run: () => void, cls = '') {
  const b = el('button', cls); b.append(icon(name)); b.title = title; b.dataset.testid = test;
  b.onclick = e => { e.stopPropagation(); run(); };
  return b;
}
function row(entry: Entry, index: number) {
  const r = el('div', `row${entry.id === selected ? ' selected' : ''}`);
  r.dataset.testid = 'clipboard.row'; r.dataset.id = entry.id; r.dataset.kind = entry.kind;
  if (entry.favorite) r.dataset.favorite = 'true';
  const body = el('div', 'body');
  body.append(content(entry));
  if (editing === entry.id) body.append(noteEditor(entry));
  else if (entry.note) { const n = el('div', 'note', entry.note); n.dataset.testid = 'clipboard.row.note'; body.append(n); }
  body.append(meta(entry, index));
  const actions = el('div', 'actions');
  actions.append(
    actionButton('paste', t('row.paste'), 'clipboard.row.paste', () => paste(entry.id)),
    actionButton(entry.favorite ? 'star-fill' : 'star', t(entry.favorite ? 'row.unfavorite' : 'row.favorite'), 'clipboard.row.favorite', () => send({ type: 'favorite', id: entry.id, favorite: !entry.favorite }), entry.favorite ? 'on' : ''),
    actionButton('note', t('row.note'), 'clipboard.row.note-edit', () => { editing = entry.id; selected = entry.id; renderList(); }),
    actionButton('copy', t('row.copy'), 'clipboard.row.copy', () => send({ type: 'copy', id: entry.id })),
    actionButton('trash', t('row.delete'), 'clipboard.row.delete', () => remove(entry.id), 'delete'),
  );
  r.append(lead(entry), body, actions);
  r.onclick = () => { selected = entry.id; for (const n of get('list').querySelectorAll<HTMLElement>('.row')) n.classList.toggle('selected', n.dataset.id === selected); };
  r.ondblclick = () => paste(entry.id);
  return r;
}
function renderTabs() {
  const n = counts(entries);
  get('filters').replaceChildren(...FILTERS.map(f => {
    const b = el('button', `tab${f === filter ? ' active' : ''}`, t(`filter.${f}`));
    b.dataset.testid = `clipboard.filter.${f}`; b.dataset.count = String(n[f]); b.title = String(n[f]);
    b.onclick = () => { filter = f; limit = PAGE; selected = ''; render(); };
    return b;
  }));
}
function renderList() {
  const list = visible(), shown = list.slice(0, limit);
  if (selected && !list.some(e => e.id === selected)) selected = '';
  if (!selected && shown.length && !editing) selected = shown[0].id;
  get('list').replaceChildren(...shown.map(row));
  const missing = shown.filter(e => e.kind === 'image' && !thumbs.has(e.id)).map(e => e.id);
  if (missing.length) { missing.forEach(id => thumbs.set(id, null)); send({ type: 'thumbs', ids: missing }); }
  const empty = get('empty');
  empty.hidden = list.length > 0 || view !== 'history';
  const searching = !!query.trim() || filter !== 'all';
  empty.querySelector('b')!.textContent = t(searching ? 'empty.search.title' : 'empty.title');
  empty.querySelector('p')!.textContent = t(searching ? 'empty.search.body' : 'empty.body');
  get('count').textContent = plural('footer.count', list.length);
}
function renderBanner() {
  const banner = get('banner'), text = banner.querySelector('span')!, action = banner.querySelector('button')!;
  const s = state.settings;
  let message = '', tone = '', grant = false;
  if (s.paused) message = t('status.paused');
  else if (state.error) { message = t('status.error', { error: state.error }); tone = 'error'; }
  else if (!state.ready) message = t('status.starting');
  else if (state.shortcutError && s.shortcut) message = t('status.shortcut', { shortcut: shortcutLabel(s.shortcut) });
  else if (s.autoPaste && state.trusted === false) { message = t('status.access'); grant = true; }
  banner.hidden = !message; banner.className = `banner${tone ? ` ${tone}` : ''}`;
  text.textContent = message;
  action.hidden = !grant; action.textContent = t('status.access.grant'); action.dataset.testid = 'clipboard.status.grant';
  action.onclick = () => send({ type: 'grant' });
}

// ── Settings ───────────────────────────────────────────────────────────────
function line(label: string, hint: string | null, control: HTMLElement, test?: string) {
  const l = el('div', 'line'), text = el('div', 'label');
  text.append(el('span', '', label)); if (hint) text.append(el('small', '', hint));
  if (test) control.dataset.testid = test;
  l.append(text, control); return l;
}
function toggle(checked: boolean, onChange: (value: boolean) => void) {
  const wrap = el('label', 'switch'), input = el('input'); input.type = 'checkbox'; input.checked = checked;
  input.onchange = () => onChange(input.checked); wrap.append(input, el('span')); return wrap;
}
function select<T extends number>(values: T[], current: T, label: (v: T) => string, onChange: (v: T) => void) {
  const s = el('select');
  for (const v of values) { const o = el('option', '', label(v)); o.value = String(v); s.append(o); }
  s.value = String(current); s.onchange = () => onChange(Number(s.value) as T); return s;
}
const save = (patch: Partial<Settings>) => send({ type: 'settings', patch });
function renderSettings() {
  const s = state.settings, box = get('settings');
  const key = el('button', `keycap${recording ? ' recording' : ''}`, recording ? t('settings.shortcut.recording') : s.shortcut ? shortcutLabel(s.shortcut) : t('settings.shortcut.none'));
  key.onclick = () => { recording = !recording; renderSettings(); };
  const shortcutBox = el('div'); shortcutBox.style.display = 'flex'; shortcutBox.style.gap = '6px';
  shortcutBox.append(key);
  if (s.shortcut && !recording) { const clear = el('button', 'pill', t('settings.shortcut.clear')); clear.dataset.testid = 'clipboard.settings.shortcut-clear'; clear.onclick = () => save({ shortcut: '' }); shortcutBox.append(clear); }
  key.dataset.testid = 'clipboard.settings.shortcut';
  const access = el('div'); access.style.display = 'flex'; access.style.gap = '8px'; access.style.alignItems = 'center';
  access.append(el('span', state.trusted ? 'state-on' : 'state-off', t(state.trusted ? 'settings.access.on' : 'settings.access.off')));
  if (!state.trusted) { const grant = el('button', 'pill', t('settings.access.grant')); grant.dataset.testid = 'clipboard.settings.grant'; grant.onclick = () => send({ type: 'grant' }); access.append(grant); }
  const general = el('div', 'group');
  general.append(
    line(t('settings.shortcut'), state.shortcutError && s.shortcut ? t('status.shortcut', { shortcut: shortcutLabel(s.shortcut) }) : t('settings.shortcut.hint'), shortcutBox),
    line(t('settings.autoPaste'), t('settings.autoPaste.hint'), toggle(s.autoPaste, v => save({ autoPaste: v })), 'clipboard.settings.auto-paste'),
    line(t('settings.access'), null, access),
    line(t('settings.recording'), null, toggle(!s.paused, v => save({ paused: !v })), 'clipboard.settings.recording'),
  );
  const history = el('div', 'group');
  history.append(
    line(t('settings.maxItems'), null, select(MAX_ITEMS, s.maxItems, v => t('settings.maxItems.value', { count: v.toLocaleString(locale) }), v => save({ maxItems: v })), 'clipboard.settings.max-items'),
    line(t('settings.retention'), null, select(RETENTION_DAYS, s.retentionDays, v => v ? plural('settings.retention.days', v) : t('settings.retention.forever'), v => save({ retentionDays: v })), 'clipboard.settings.retention'),
  );
  const clear = el('button', 'pill danger', t('footer.clear')); clear.dataset.testid = 'clipboard.settings.clear';
  clear.disabled = !entries.some(e => !e.favorite); clear.onclick = confirmClear;
  const clearLine = el('div', 'line'); clearLine.append(el('div', 'label'), clear); clearLine.firstElementChild!.append(el('small', '', t('settings.favoritesKept')));
  history.append(clearLine);
  box.replaceChildren(general, history, el('p', 'note-text', t('settings.commands')));
}

// ── Chrome ────────────────────────────────────────────────────────────────
function renderChrome() {
  const s = state.settings;
  get('title').textContent = view === 'settings' ? t('settings.title') : t('plugin.name');
  get('back').hidden = view !== 'settings';
  get('gear').hidden = view === 'settings'; get('gear').title = t('header.settings');
  const pause = get('pause');
  pause.hidden = view === 'settings';
  pause.classList.toggle('on', s.paused); pause.title = t(s.paused ? 'header.resume' : 'header.pause');
  pause.querySelector('i')!.style.setProperty('--src', `url(icons/${s.paused ? 'play' : 'pause'}.svg)`);
  get('history').hidden = view !== 'history'; get('settings').hidden = view !== 'settings';
  get('hint').textContent = t('footer.hint');
  renderBanner();
  if (view === 'settings') renderSettings();
}
function render() { renderTabs(); renderList(); renderChrome(); }

function paste(id: string, plain = false) { selected = id; send({ type: 'paste', id, plain }); }
function remove(id: string) {
  const list = visible(), at = list.findIndex(e => e.id === id);
  if (selected === id) selected = list[at + 1]?.id ?? list[at - 1]?.id ?? '';
  send({ type: 'delete', id });
}
function showToast(tone: string, text: string) {
  const box = get('toast'); box.className = `toast ${tone}`; box.textContent = text; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 2200);
}
function confirmClear() {
  const dialog = get<HTMLDialogElement>('confirm');
  get('confirm-title').textContent = t('clear.title');
  get('confirm-body').textContent = t('clear.body', { count: entries.filter(e => !e.favorite).length.toLocaleString(locale) });
  get('confirm-cancel').textContent = t('clear.cancel'); get('confirm-ok').textContent = t('clear.confirm');
  get('confirm-cancel').onclick = () => dialog.close();
  get('confirm-ok').onclick = () => { dialog.close(); send({ type: 'clear' }); };
  dialog.showModal();
}
function move(step: number) {
  const list = visible().slice(0, limit); if (!list.length) return;
  const at = list.findIndex(e => e.id === selected);
  selected = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + step))].id;
  renderList();
  get('list').querySelector<HTMLElement>(`.row[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
}
function showView(next: typeof view) { view = next; recording = false; render(); if (next === 'history') get('search').focus(); }

function bind() {
  for (const i of document.querySelectorAll<HTMLElement>('[data-icon]')) i.style.setProperty('--src', `url(icons/${i.dataset.icon}.svg)`);
  const input = get<HTMLInputElement>('search');
  input.oninput = () => { query = input.value; limit = PAGE; selected = ''; renderList(); };
  get('gear').onclick = () => showView('settings');
  get('back').onclick = () => showView('history');
  get('pause').onclick = () => save({ paused: !state.settings.paused });
  get('list').onscroll = () => {
    const list = get('list');
    if (list.scrollTop + list.clientHeight > list.scrollHeight - 400 && limit < visible().length) { limit += PAGE; renderList(); }
  };
  document.addEventListener('keydown', e => {
    if (get<HTMLDialogElement>('confirm').open) return;
    if (recording) {
      e.preventDefault();
      if (e.key === 'Escape') { recording = false; renderSettings(); return; }
      const accelerator = acceleratorOf(e);
      if (accelerator) { recording = false; save({ shortcut: accelerator }); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (view === 'settings') showView('history');
      else if (input.value) { input.value = ''; query = ''; renderList(); }
      else send({ type: 'hide' });
      return;
    }
    if (view !== 'history' || editing) return;
    if (e.metaKey && /^[1-9]$/.test(e.key)) { const target = visible()[Number(e.key) - 1]; if (target) { e.preventDefault(); paste(target.id); } }
    else if (e.key === 'f' && e.metaKey) { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && selected) { e.preventDefault(); if (e.metaKey) send({ type: 'copy', id: selected }); else paste(selected, e.shiftKey); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && selected && (document.activeElement !== input || !input.value)) { e.preventDefault(); remove(selected); }
    else if (e.key === 'Tab') { e.preventDefault(); const at = FILTERS.indexOf(filter); filter = FILTERS[(at + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]; limit = PAGE; selected = ''; render(); }
    else if (e.key === 'd' && e.metaKey && selected) { e.preventDefault(); const entry = entries.find(x => x.id === selected); if (entry) send({ type: 'favorite', id: entry.id, favorite: !entry.favorite }); }
  });
  // Relative times ("2 minutes ago") stay current.
  setInterval(() => { if (!editing && view === 'history') renderList(); }, 30_000);
}
async function loadCopy() {
  copy = await i18n.catalog(); locale = (await i18n.state()).locale; document.documentElement.lang = locale;
  get('search').setAttribute('placeholder', t('search.placeholder')); document.title = t('plugin.name');
  render();
}
bind();
channel.onMessage<Reply>(message => {
  switch (message?.type) {
    case 'rows': entries = message.reset ? message.rows : entries.concat(message.rows); document.body.dataset.loaded = 'true'; render(); break;
    case 'added': entries = [message.row, ...entries.filter(e => e.id !== message.row.id)]; if (!editing) { selected = ''; render(); } break;
    case 'updated': entries = entries.map(e => e.id === message.row.id ? message.row : e); if (!editing) render(); break;
    case 'removed': { const gone = new Set(message.ids); entries = entries.filter(e => !gone.has(e.id)); for (const id of gone) thumbs.delete(id); render(); break; }
    case 'thumb': thumbs.set(message.id, message.url); if (message.url && !editing) renderList(); break;
    case 'state': state = message.state; renderChrome(); break;
    // Summoned again: a clean slate on the asked-for category, newest first.
    case 'opened': {
      const input = get<HTMLInputElement>('search');
      input.value = ''; query = ''; filter = message.filter; selected = ''; editing = ''; limit = PAGE; view = message.settings ? 'settings' : 'history'; recording = false;
      render(); get('list').scrollTop = 0; if (view === 'history') input.focus();
      break;
    }
    case 'toast': showToast(message.tone, t(message.key, message.params ?? {})); break;
  }
});
i18n.onDidChangeLocale(() => void loadCopy());
void loadCopy().then(() => { send({ type: 'hello' }); get('search').focus(); });
