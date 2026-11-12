// Settings and setup: the macOS screen-recording grant (with a button that asks for it),
// shortcuts, where screenshots are saved. The worker owns the values; this page only edits.
import { capture, channel, i18n } from '@medeo-plugin/sdk';
import type { FromSettings, SettingsState, ToSettings } from '../protocol.ts';
import { SHORTCUTS, type Settings, type ShortcutKey } from '../settings.ts';
import { fromKey, symbols, valid } from '../shortcuts.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromSettings) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) => (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
let state: SettingsState | null = null;
let recording: ShortcutKey | null = null;
let screen = 'not_checked';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function row(label: string, note: string | null, ...controls: HTMLElement[]) {
  const r = el('div', 'line'); const left = el('div', 'label');
  left.append(el('span', '', label)); if (note) left.append(el('small', '', note));
  const right = el('div', 'controls'); right.append(...controls);
  r.append(left, right); return r;
}

function button(text: string, testid: string, onClick: () => void, cls = 'pill') {
  const b = el('button', cls, text); b.dataset.testid = testid; b.addEventListener('click', onClick); return b;
}

function shortcutControl(key: ShortcutKey) {
  const value = state!.settings[key];
  const box = el('div', 'shortcut');
  const rec = el('button', `keys${recording === key ? ' recording' : ''}`, recording === key ? tr('shortcut.press') : value ? symbols(value) : tr('shortcut.none'));
  rec.dataset.testid = `screenshot.settings.${key}`;
  rec.addEventListener('click', () => { recording = recording === key ? null : key; render(); });
  box.append(rec);
  if (value) box.append(button(tr('shortcut.clear'), `screenshot.settings.${key}.clear`, () => { recording = null; void post({ type: 'set', patch: { [key]: null } }); }, 'link'));
  const error = state!.errors[key];
  if (error) box.append(el('small', 'error', tr(`shortcut.error.${error}`)));
  return box;
}

function render() {
  const root = $('settings'); root.replaceChildren();
  if (!state) return;
  // Permission card first: nothing works without it.
  const perm = el('section', `card perm ${screen === 'granted' ? 'ok' : 'warn'}`); perm.dataset.testid = 'screenshot.settings.permission';
  const head = el('div', 'perm-head');
  head.append(el('b', '', tr('perm.title')), el('span', `badge ${screen === 'granted' ? 'ok' : 'warn'}`, tr(`perm.state.${screen === 'granted' ? 'granted' : screen === 'not_checked' || screen === 'unknown' ? 'unknown' : 'missing'}`)));
  perm.append(head, el('p', '', tr(screen === 'granted' ? 'perm.ok' : 'perm.body')));
  if (screen !== 'granted') {
    const actions = el('div', 'actions');
    actions.append(button(tr('perm.request'), 'screenshot.settings.permission.request', () => void requestPermission(), 'cta'),
      button(tr('perm.open'), 'screenshot.settings.permission.open', () => void post({ type: 'open-privacy' })));
    perm.append(actions, el('small', 'muted', tr('perm.restart')));
  }
  root.append(perm);

  const keys = el('section', 'card');
  keys.append(el('h3', '', tr('section.shortcuts')), ...SHORTCUTS.map(k => row(tr(`shortcut.${k}`), tr(`shortcut.${k}.note`), shortcutControl(k))));
  root.append(keys);

  const output = el('section', 'card');
  output.append(el('h3', '', tr('section.output')),
    row(tr('output.enter'), tr('output.enter.note'), choice('screenshot.settings.enterAction', state.settings.enterAction, [['copy', tr('output.copy')], ['save', tr('output.save')]], v => ({ enterAction: v }))),
    row(tr('output.format'), null, choice('screenshot.settings.format', state.settings.format, [['png', 'PNG'], ['jpeg', 'JPEG']], v => ({ format: v }))),
    row(tr('output.downscale'), tr('output.downscale.note'), check('screenshot.settings.downscale', state.settings.downscale, v => ({ downscale: v }))));
  root.append(output);

  const save = el('section', 'card');
  const path = el('code', 'path', state.saveDir); path.title = state.saveDir; path.dataset.testid = 'screenshot.settings.folder';
  const toggle = check('screenshot.settings.openAfterSave', state.settings.openAfterSave, v => ({ openAfterSave: v }));
  save.append(el('h3', '', tr('section.save')),
    row(tr('save.folder'), null, path, button(tr('save.change'), 'screenshot.settings.folder.change', () => void post({ type: 'choose-folder' })), button(tr('save.reveal'), 'screenshot.settings.folder.reveal', () => void post({ type: 'reveal-folder' }))),
    row(tr('save.open'), tr('save.open.note'), toggle));
  root.append(save);

  const foot = el('div', 'foot');
  foot.append(el('small', 'muted', tr('foot.tips')), button(tr('action.capture'), 'screenshot.settings.capture', () => void post({ type: 'capture' }), 'cta'));
  root.append(foot);
}

function check(testid: string, value: boolean, patch: (v: boolean) => Partial<Settings>) {
  const box = el('input') as HTMLInputElement; box.type = 'checkbox'; box.className = 'switch'; box.checked = value; box.dataset.testid = testid;
  box.addEventListener('change', () => void post({ type: 'set', patch: patch(box.checked) }));
  return box;
}
function choice<T extends string>(testid: string, value: T, items: [T, string][], patch: (v: T) => Partial<Settings>) {
  const g = el('div', 'seg'); g.dataset.testid = testid;
  for (const [v, label] of items) {
    const b = el('button', `seg-item${v === value ? ' on' : ''}`, label); b.dataset.value = v;
    b.addEventListener('click', () => void post({ type: 'set', patch: patch(v) }));
    g.append(b);
  }
  return g;
}

async function refreshPermission(refresh = true) {
  // The status call answers "loading" until the native helper has looked.
  let s = await capture.status(refresh).catch(() => null);
  for (let i = 0; i < 20 && s?.status === 'loading'; i++) { await new Promise(r => setTimeout(r, 250)); s = await capture.status(false).catch(() => null); }
  screen = s?.os?.screen_capture ?? 'unknown';
  render();
}

async function requestPermission() {
  // Asks macOS for Medeo's screen-recording grant (the system dialog the first time; after a
  // refusal macOS only lets the user turn it on in System Settings).
  let s = await capture.sources(true, true).catch(() => null);
  for (let i = 0; i < 40 && s?.status === 'loading'; i++) { await new Promise(r => setTimeout(r, 250)); s = await capture.sources(false).catch(() => null); }
  await refreshPermission(true);
  if (screen !== 'granted') void post({ type: 'open-privacy' });
}

function toast(tone: 'success' | 'error', key: string) {
  const box = $('toast'); box.textContent = tr(key); box.className = `toast ${tone}`; box.hidden = false;
  clearTimeout((toast as any).timer); (toast as any).timer = setTimeout(() => { box.hidden = true; }, 2200);
}

export async function startSettings() {
  t = await i18n.catalog().catch(() => ({}));
  document.title = tr('settings.title');
  i18n.onDidChangeLocale(async () => { t = await i18n.catalog().catch(() => t); document.title = tr('settings.title'); render(); });
  channel.onMessage<ToSettings>(m => {
    if (m?.type === 'settings') { state = m.state; render(); }
    else if (m?.type === 'toast') toast(m.tone, m.key);
  });
  addEventListener('keydown', e => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') { recording = null; render(); return; }
    const acc = fromKey(e);
    if (!acc) return;
    const key = recording; recording = null;
    if (!valid(acc)) { toast('error', 'shortcut.error.invalid'); render(); return; }
    void post({ type: 'set', patch: { [key]: acc } });
  });
  addEventListener('focus', () => void refreshPermission(true));
  await post({ type: 'settings-ready' });
  await refreshPermission(true);
}
