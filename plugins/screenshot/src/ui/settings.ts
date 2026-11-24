// Settings and setup: macOS permissions (Screen Recording, Microphone, Camera, Input Monitoring),
// shortcuts, screenshot output, and 120Hz recording defaults. The worker owns the values.
import { channel, i18n } from '@one2x/medeo-plugin-sdk';
import { captureV2 } from '../platform.ts';
import type { FromSettings, SettingsState, ToSettings } from '../protocol.ts';
import type { CountdownSeconds, RecordingCodec, RecordingConfig, RecordingFps } from '../recording.ts';
import { SHORTCUTS, type Settings, type ShortcutKey } from '../settings.ts';
import { fromKey, symbols, valid } from '../shortcuts.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: FromSettings) => channel.post(m);
let t: Record<string, string> = {};
const tr = (key: string, params: Record<string, string | number> = {}) =>
  (t[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
let state: SettingsState | null = null;
let recording: ShortcutKey | null = null;
let osPerms: Record<string, string> = {
  screen_capture: 'not_checked',
  microphone: 'not_checked',
  camera: 'not_checked',
  input_monitoring: 'not_checked',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function row(label: string, note: string | null, ...controls: HTMLElement[]) {
  const r = el('div', 'line');
  const left = el('div', 'label');
  left.append(el('span', '', label));
  if (note) left.append(el('small', '', note));
  const right = el('div', 'controls');
  right.append(...controls);
  r.append(left, right);
  return r;
}

function button(text: string, testid: string, onClick: () => void, cls = 'pill') {
  const b = el('button', cls, text);
  b.dataset.testid = testid;
  b.addEventListener('click', onClick);
  return b;
}

function shortcutControl(key: ShortcutKey) {
  const value = state!.settings[key];
  const box = el('div', 'shortcut');
  const rec = el(
    'button',
    `keys${recording === key ? ' recording' : ''}`,
    recording === key ? tr('shortcut.press') : value ? symbols(value) : tr('shortcut.none'),
  );
  rec.dataset.testid = `screenshot.settings.${key}`;
  rec.addEventListener('click', () => { recording = recording === key ? null : key; render(); });
  box.append(rec);
  if (value) {
    box.append(
      button(tr('shortcut.clear'), `screenshot.settings.${key}.clear`, () => {
        recording = null;
        void post({ type: 'set', patch: { [key]: null } });
      }, 'link'),
    );
  }
  const error = state!.errors[key];
  if (error) box.append(el('small', 'error', tr(`shortcut.error.${error}`)));
  return box;
}

function patchRecording(patch: Partial<RecordingConfig>) {
  if (!state) return;
  void post({ type: 'set', patch: { recording: { ...state.settings.recording, ...patch } } });
}

function permBadge(val: string) {
  const granted = val === 'granted';
  const key = granted ? 'granted' : val === 'not_checked' || val === 'unknown' ? 'unknown' : 'missing';
  return el('span', `badge ${granted ? 'ok' : 'warn'}`, tr(`perm.state.${key}`));
}

function render() {
  const root = $('settings');
  root.replaceChildren();
  if (!state) return;

  const screen = osPerms.screen_capture ?? 'unknown';
  // Primary screen-recording permission card + secondary recording permissions matrix
  const perm = el('section', `card perm ${screen === 'granted' ? 'ok' : 'warn'}`);
  perm.dataset.testid = 'screenshot.settings.permission';
  const head = el('div', 'perm-head');
  head.append(el('b', '', tr('perm.title')), permBadge(screen));
  perm.append(head, el('p', '', tr(screen === 'granted' ? 'perm.ok' : 'perm.body')));
  if (screen !== 'granted') {
    const actions = el('div', 'actions');
    actions.append(
      button(tr('perm.request'), 'screenshot.settings.permission.request', () => void requestPermission(), 'cta'),
      button(tr('perm.open'), 'screenshot.settings.permission.open', () => void post({ type: 'open-privacy', pane: 'screen' })),
    );
    perm.append(actions, el('small', 'muted', tr('perm.restart')));
  }

  const subPerms = el('div', 'sub-perms');
  const extras: { key: string; label: string; pane: 'mic' | 'camera' | 'input' }[] = [
    { key: 'microphone', label: tr('rec.mic'), pane: 'mic' },
    { key: 'camera', label: tr('rec.cam'), pane: 'camera' },
    { key: 'input_monitoring', label: tr('rec.keys'), pane: 'input' },
  ];
  for (const ex of extras) {
    const val = osPerms[ex.key] ?? 'not_checked';
    const item = el('div', 'sub-perm-row');
    item.append(el('span', '', ex.label), permBadge(val));
    if (val !== 'granted') {
      item.append(button(tr('perm.open'), `screenshot.settings.perm.${ex.pane}`, () => void post({ type: 'open-privacy', pane: ex.pane }), 'link'));
    }
    subPerms.append(item);
  }
  perm.append(subPerms);
  root.append(perm);

  const keys = el('section', 'card');
  keys.append(
    el('h3', '', tr('section.shortcuts')),
    ...SHORTCUTS.map(k => row(tr(`shortcut.${k}`), tr(`shortcut.${k}.note`), shortcutControl(k))),
  );
  root.append(keys);

  const rec = state.settings.recording;
  const recCard = el('section', 'card');
  recCard.append(
    el('h3', '', tr('section.recording')),
    row(
      tr('rec.settings.fps'),
      tr('rec.settings.fps.note'),
      choice<string>('screenshot.settings.recFps', String(rec.fps), [['30', '30'], ['60', '60'], ['120', '120Hz']], v => ({
        recording: { ...rec, fps: Number(v) as RecordingFps },
      })),
    ),
    row(
      tr('rec.settings.codec'),
      tr('rec.settings.codec.note'),
      choice<RecordingCodec>('screenshot.settings.recCodec', rec.codec, [
        ['auto', tr('rec.codec.auto')],
        ['h264', 'H.264'],
        ['hevc', 'HEVC'],
      ], v => ({ recording: { ...rec, codec: v } })),
    ),
    row(
      tr('rec.countdown.title'),
      null,
      choice<string>('screenshot.settings.recCountdown', String(rec.countdown), [
        ['0', tr('rec.countdown.off')],
        ['3', '3s'],
        ['5', '5s'],
      ], v => ({ recording: { ...rec, countdown: Number(v) as CountdownSeconds } })),
    ),
    row(tr('rec.sys.enable'), tr('rec.separateAudio'), check('screenshot.settings.recSys', rec.systemAudio.enabled, v => ({
      recording: { ...rec, systemAudio: { ...rec.systemAudio, enabled: v } },
    }))),
    row(tr('rec.mic.enable'), tr('rec.mic.mono'), check('screenshot.settings.recMic', rec.microphone.enabled, v => ({
      recording: { ...rec, microphone: { ...rec.microphone, enabled: v } },
    }))),
    row(tr('rec.cam.enable'), null, check('screenshot.settings.recCam', rec.camera.enabled, v => ({
      recording: { ...rec, camera: { ...rec.camera, enabled: v } },
    }))),
    row(tr('rec.clicks.enable'), null, check('screenshot.settings.recClicks', rec.clicks.enabled, v => ({
      recording: { ...rec, clicks: { ...rec.clicks, enabled: v } },
    }))),
    row(tr('rec.keys.enable'), tr('rec.keys.privacyNote'), check('screenshot.settings.recKeys', rec.keystrokes.enabled, v => ({
      recording: { ...rec, keystrokes: { ...rec.keystrokes, enabled: v } },
    }))),
  );
  root.append(recCard);

  const output = el('section', 'card');
  output.append(
    el('h3', '', tr('section.output')),
    row(
      tr('output.enter'),
      tr('output.enter.note'),
      choice('screenshot.settings.enterAction', state.settings.enterAction, [['copy', tr('output.copy')], ['save', tr('output.save')]], v => ({ enterAction: v })),
    ),
    row(
      tr('output.format'),
      null,
      choice('screenshot.settings.format', state.settings.format, [['png', 'PNG'], ['jpeg', 'JPEG']], v => ({ format: v })),
    ),
    row(
      tr('output.downscale'),
      tr('output.downscale.note'),
      check('screenshot.settings.downscale', state.settings.downscale, v => ({ downscale: v })),
    ),
  );
  root.append(output);

  const save = el('section', 'card');
  const folderEl = el('code', 'path', state.saveDir);
  folderEl.title = state.saveDir;
  folderEl.dataset.testid = 'screenshot.settings.folder';
  const toggle = check('screenshot.settings.openAfterSave', state.settings.openAfterSave, v => ({ openAfterSave: v }));
  save.append(
    el('h3', '', tr('section.save')),
    row(
      tr('save.folder'),
      null,
      folderEl,
      button(tr('save.change'), 'screenshot.settings.folder.change', () => void post({ type: 'choose-folder' })),
      button(tr('save.reveal'), 'screenshot.settings.folder.reveal', () => void post({ type: 'reveal-folder' })),
    ),
    row(tr('save.open'), tr('save.open.note'), toggle),
    row(tr('save.drive'), tr('save.drive.note'), check('screenshot.settings.showDrive', state.settings.showDrive, v => ({ showDrive: v }))),
  );
  root.append(save);

  const foot = el('div', 'foot');
  const footBtns = el('div', 'foot-btns');
  footBtns.append(
    button(tr('action.capture'), 'screenshot.settings.capture', () => void post({ type: 'capture' }), 'pill'),
    button(tr('mode.record'), 'screenshot.settings.record', () => void post({ type: 'record' }), 'cta'),
  );
  foot.append(el('small', 'muted', tr('foot.tips')), footBtns);
  root.append(foot);
  void patchRecording;
}

function check(testid: string, value: boolean, patch: (v: boolean) => Partial<Settings>) {
  const box = el('input') as HTMLInputElement;
  box.type = 'checkbox';
  box.className = 'switch';
  box.checked = value;
  box.dataset.testid = testid;
  box.addEventListener('change', () => void post({ type: 'set', patch: patch(box.checked) }));
  return box;
}
function choice<T extends string>(testid: string, value: T, items: [T, string][], patch: (v: T) => Partial<Settings>) {
  const g = el('div', 'seg');
  g.dataset.testid = testid;
  for (const [v, label] of items) {
    const b = el('button', `seg-item${v === value ? ' on' : ''}`, label);
    b.dataset.value = v;
    b.addEventListener('click', () => void post({ type: 'set', patch: patch(v) }));
    g.append(b);
  }
  return g;
}

async function refreshPermission(refresh = true) {
  let s = await captureV2.status(refresh).catch(() => null);
  for (let i = 0; i < 20 && s?.status === 'loading'; i++) {
    await new Promise(r => setTimeout(r, 250));
    s = await captureV2.status(false).catch(() => null);
  }
  if (s?.os) osPerms = { ...osPerms, ...s.os };
  render();
}

async function requestPermission() {
  let s = await captureV2.sources(true, true).catch(() => null);
  for (let i = 0; i < 40 && s?.status === 'loading'; i++) {
    await new Promise(r => setTimeout(r, 250));
    s = await captureV2.sources(false).catch(() => null);
  }
  await refreshPermission(true);
  if (osPerms.screen_capture !== 'granted') void post({ type: 'open-privacy', pane: 'screen' });
}

function toast(tone: 'success' | 'error', key: string) {
  const box = $('toast');
  box.textContent = tr(key);
  box.className = `toast ${tone}`;
  box.hidden = false;
  clearTimeout((toast as unknown as { timer?: number }).timer);
  (toast as unknown as { timer?: number }).timer = setTimeout(() => { box.hidden = true; }, 2200) as unknown as number;
}

export async function startSettings() {
  t = await i18n.catalog().catch(() => ({}));
  document.title = tr('settings.title');
  i18n.onDidChangeLocale(async () => {
    t = await i18n.catalog().catch(() => t);
    document.title = tr('settings.title');
    render();
  });
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
    const key = recording;
    recording = null;
    if (!valid(acc)) { toast('error', 'shortcut.error.invalid'); render(); return; }
    void post({ type: 'set', patch: { [key]: acc } });
  });
  addEventListener('focus', () => void refreshPermission(true));
  await post({ type: 'settings-ready' });
  await refreshPermission(true);
}
