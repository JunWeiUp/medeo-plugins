// Screenshot: a shortcut or the menu-bar
// icon freezes the display under the pointer with macOS's own `screencapture`, a transparent
// overlay lets the user select and annotate, and the result comes back here to be copied, saved
// or read with Apple Vision (OCR + QR).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appWindows, capture, channel, definePlugin, events, i18n, launcher, notifications, shortcuts, tray } from '@medeo-plugin/sdk';
import { expandHome, fileName } from './src/naming.ts';
import { joinLines, split, type Action, type FromOverlay, type FromSettings, type Mode, type SettingsState, type Shot, type ToOverlay, type ToSettings } from './src/protocol.ts';
import { DEFAULTS, normalize, type Settings, type ShortcutKey } from './src/settings.ts';

const OVERLAY = 'overlay', SETTINGS = 'settings';
const OSASCRIPT = '/usr/bin/osascript', SCREENCAPTURE = '/usr/sbin/screencapture', OPEN = '/usr/bin/open';
const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

let root = '', dir = '', settingsFile = '';
let settings: Settings = DEFAULTS;
let errors: SettingsState['errors'] = {};
let registered: Record<string, string> = {};
let overlayReady = false;
let pending: { shot: Shot; chunks: string[] } | null = null;
let current: { seq: number; at: number } | null = null;
let results: { seq: number; action: Action; mime: string; parts: string[]; total: number } | null = null;
let seq = 0;
let posts: Promise<unknown> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();

const run = (cmd: string, args: string[], timeout = 15_000) => new Promise<string>((ok, no) =>
  execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (error, stdout, stderr) => error ? no(new Error(String(stderr || error.message).trim())) : ok(String(stdout))));
const helper = (...args: string[]) => run(OSASCRIPT, ['-l', 'JavaScript', path.join(root, 'resources/helper.js'), ...args], 120_000);
/** Messages go out one at a time so chunks arrive in order. */
const post = (m: ToOverlay | ToSettings) => { const next = posts.then(() => channel.post(m)).catch(error => console.warn('post failed:', String(error))); posts = next; return next; };
const serial = <T>(task: () => Promise<T>) => { const next = queue.then(task); queue = next.catch(error => console.error('screenshot failed:', error)); return next; };
const label = (key: string, params: Record<string, string | number> = {}) => i18n.t(key, params).catch(() => key);
const saveDir = () => expandHome(settings.saveDir, os.homedir(), expandHome(DEFAULTS.saveDir, os.homedir(), os.homedir()));

// ---------------------------------------------------------------- capturing
async function permissionMissing(): Promise<boolean> {
  const status = await capture.status(false).catch(() => null);
  const value = status?.os?.screen_capture;
  return value === 'denied' || value === 'not_granted' || value === 'restricted';
}

async function shoot(mode: Mode, delay = 0) {
  // A capture already on screen: a second press is ignored (Esc in the overlay cancels).
  if (current && Date.now() - current.at < 10 * 60_000) {
    const open = await appWindows.list().catch(() => []);
    if (open.some(w => w.id === OVERLAY && w.visible)) return;
  }
  const t0 = Date.now();
  if (await permissionMissing()) { console.info('screen recording not granted: opening settings'); await openSettings(); return; }
  if (delay) await new Promise(r => setTimeout(r, delay));
  const info = JSON.parse(await helper('screen')) as { display: { x: number; y: number; width: number; height: number; scale: number }; windows: Shot['windows'] };
  const d = info.display, file = path.join(dir, `capture-${process.pid}.png`);
  try {
    await run(SCREENCAPTURE, ['-x', '-t', 'png', '-R', `${d.x},${d.y},${d.width},${d.height}`, file]);
  } catch (error) {
    console.error('screencapture failed:', error);
    // Without the screen-recording grant macOS refuses the rectangle.
    if (/could not create image/i.test(String(error))) { await openSettings(); return; }
    await notify('error.capture');
    return;
  }
  const png = await readFile(file); await rm(file, { force: true });
  const t1 = Date.now();
  const shot: Shot = { seq: ++seq, mode, width: d.width, height: d.height, scale: d.scale, windows: info.windows, output: { format: settings.format, downscale: settings.downscale, enter: settings.enterAction } };
  const chunks = split(png.toString('base64'));
  current = { seq: shot.seq, at: Date.now() };
  results = null;
  // A window that is gone (closed, or the plugin restarted) loads again and says when it is ready.
  const open = await appWindows.list().catch(() => []);
  if (!open.some(w => w.id === OVERLAY)) overlayReady = false;
  await appWindows.open({ id: OVERLAY, entry: 'ui/index.html', title: await label('plugin.name'), width: d.width, height: d.height, overlay: true });
  if (overlayReady) await send(shot, chunks); else pending = { shot, chunks };
  console.info(`capture #${shot.seq} ${mode}: ${d.width}x${d.height}@${d.scale} ${Math.round(png.length / 1024)} KiB, captured in ${t1 - t0 - delay} ms, overlay ${overlayReady ? 'reused' : 'loading'} after ${Date.now() - t1} ms`);
}

async function send(shot: Shot, chunks: string[]) {
  await post({ type: 'shot', shot, parts: chunks.length });
  for (let i = 0; i < chunks.length; i++) await post({ type: 'chunk', seq: shot.seq, i, data: chunks[i] });
}

async function finished(r: { seq: number; action: Action; mime: string; parts: string[] }) {
  const png = Buffer.from(r.parts.join(''), 'base64');
  console.info(`capture #${r.seq} ${r.action}: ${Math.round(png.length / 1024)} KiB ${r.mime}`);
  if (r.action === 'ocr') { await recognize(r.seq, png); return; }
  current = null;
  if (r.action === 'copy') {
    const file = path.join(dir, `copy-${process.pid}.png`);
    await writeFile(file, png);
    try {
      const out = (await helper('copy', file)).trim();
      if (out !== 'ok') throw new Error(out);
    } catch (error) { console.error('copy failed:', error); await notify('error.copy'); }
    finally { await rm(file, { force: true }); }
    return;
  }
  const target = saveDir();
  try {
    await mkdir(target, { recursive: true });
    const name = fileName('Medeo', new Date(), n => existsSync(path.join(target, n)), r.mime === 'image/jpeg' ? 'jpg' : 'png');
    const file = path.join(target, name);
    await writeFile(file, png, { flag: 'wx' });
    if (settings.openAfterSave) await run(OPEN, ['-R', file]).catch(() => {});
    await notifications.show('saved', await label('notify.saved.title'), await label('notify.saved.body', { name, folder: target })).catch(() => {});
  } catch (error) {
    console.error('save failed:', error);
    await notify('error.save', { folder: target });
  }
}

/** Reads the selection with Vision and sends the text and any QR payloads back to the overlay. */
async function recognize(seqNo: number, png: Buffer) {
  const file = path.join(dir, `ocr-${process.pid}.png`);
  let result: { text: string; codes: string[] } | null = null;
  try {
    await writeFile(file, png);
    const raw = JSON.parse(await helper('ocr', file)) as { lines: { t: string; x: number; y: number; h: number }[]; codes: string[] };
    result = { text: joinLines(raw.lines), codes: raw.codes };
  } catch (error) { console.error('ocr failed:', error); }
  finally { await rm(file, { force: true }); }
  await post({ type: 'ocr', seq: seqNo, result });
}

async function copyText(text: string) {
  const file = path.join(dir, `text-${process.pid}.txt`);
  try { await writeFile(file, text.slice(0, 1 << 20)); if ((await helper('copy-text', file)).trim() !== 'ok') throw new Error('copy failed'); }
  catch (error) { console.error('copy text failed:', error); await notify('error.copy'); }
  finally { await rm(file, { force: true }); }
}

async function notify(key: string, params: Record<string, string | number> = {}) {
  await notifications.show('error', await label('notify.error.title'), await label(key, params)).catch(() => {});
}

// ---------------------------------------------------------------- settings, shortcuts, menu bar
async function loadSettings() {
  try { settings = normalize(JSON.parse(await readFile(settingsFile, 'utf8'))); } catch { settings = DEFAULTS; }
}

async function setSettings(patch: Partial<Settings>) {
  settings = normalize({ ...settings, ...patch });
  await writeFile(settingsFile, JSON.stringify(settings));
  await registerShortcuts();
  await pushSettings();
}

const pushSettings = () => post({ type: 'settings', state: { settings, saveDir: saveDir(), errors } });

/** Shortcut id (as registered) ↔ settings key ↔ capture mode. */
const MODES: Record<string, { key: ShortcutKey; mode: Mode }> = { area: { key: 'shortcutArea', mode: 'area' }, full: { key: 'shortcutFull', mode: 'full' }, quick: { key: 'shortcutQuick', mode: 'quick' }, ocr: { key: 'shortcutOcr', mode: 'ocr' } };

async function registerShortcuts() {
  const wanted: Record<string, string | null> = Object.fromEntries(Object.entries(MODES).map(([id, m]) => [id, settings[m.key]]));
  errors = {};
  // Old ids from earlier builds.
  for (const old of ['capture', 'save']) if (registered[old]) { await shortcuts.unregister(old).catch(() => {}); delete registered[old]; }
  for (const [id, accelerator] of Object.entries(wanted)) {
    if (registered[id] && registered[id] !== accelerator) { await shortcuts.unregister(id).catch(() => {}); delete registered[id]; }
    if (!accelerator || registered[id] === accelerator) continue;
    try { await shortcuts.register(id, accelerator, false); registered[id] = accelerator; }
    catch (error) {
      console.error(`shortcut ${accelerator} failed:`, error);
      errors[MODES[id].key] = /permission/.test(String(error)) ? 'permission' : 'taken';
    }
  }
}

async function showTray() {
  await tray.set('', [
    { id: 'tray.area', title: await label('tray.area') },
    { id: 'tray.full', title: await label('tray.full') },
    { id: 'tray.quick', title: await label('tray.quick') },
    { id: 'tray.ocr', title: await label('tray.ocr') },
    { separator: true },
    { id: 'tray.folder', title: await label('tray.folder') },
    { id: 'tray.settings', title: await label('tray.settings') },
  ], { icon: 'resources/trayTemplate.png', click: 'tray.area' });
}

async function openSettings() {
  await appWindows.open({ id: SETTINGS, entry: 'ui/settings.html', title: await label('settings.title'), width: 560, height: 600 });
  await appWindows.focus(SETTINGS).catch(() => {});
  await pushSettings();
}

async function revealFolder() {
  const target = saveDir();
  await mkdir(target, { recursive: true }).catch(() => {});
  await run(OPEN, [target]).catch(error => console.error('open folder failed:', error));
}

async function chooseFolder() {
  const picked = (await helper('choose-folder', await label('save.choose'), saveDir()).catch(() => '')).trim();
  if (!picked) return;
  const home = os.homedir();
  await setSettings({ saveDir: picked === home || picked.startsWith(home + '/') ? '~' + picked.slice(home.length).replace(/\/$/, '') : picked.replace(/\/$/, '') });
  await post({ type: 'toast', tone: 'success', key: 'save.changed' });
}

// ---------------------------------------------------------------- messages from windows
function onMessage(m: FromOverlay | FromSettings) {
  switch (m?.type) {
    case 'overlay-ready':
      console.info('overlay ready');
      overlayReady = true;
      if (pending) { const p = pending; pending = null; void send(p.shot, p.chunks); }
      break;
    case 'result': {
      if (!current || m.seq !== current.seq) return;
      if (!results || results.seq !== m.seq || results.action !== m.action) results = { seq: m.seq, action: m.action, mime: m.mime, parts: [], total: m.parts };
      results.parts[m.i] = m.data;
      if (results.parts.filter(p => p !== undefined).length === results.total) { const r = results; results = null; void serial(() => finished(r)); }
      break;
    }
    case 'cancel': console.info(`capture #${m.seq} cancelled`); if (current && m.seq === current.seq) { current = null; pending = null; } break;
    case 'copy-text': if (typeof m.text === 'string') void serial(() => copyText(m.text)); break;
    case 'open-url': if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) void run(OPEN, [m.url]).catch(() => {}); break;
    case 'settings-ready': void pushSettings(); break;
    case 'set': void serial(() => setSettings(m.patch)); break;
    case 'choose-folder': void serial(chooseFolder); break;
    case 'reveal-folder': void revealFolder().catch(() => {}); break;
    case 'open-privacy': void run(OPEN, [PRIVACY]).catch(() => {}); break;
    case 'capture': void serial(async () => { await appWindows.hide(SETTINGS).catch(() => {}); await shoot('area', 250); }); break;
  }
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    root = context.extensionPath!; dir = context.storagePath!; settingsFile = path.join(dir, 'settings.json');
    let started: Promise<void> | null = null;
    // The platform is not this instance's until activate returns: the first call that needs it
    // (here `shortcuts.list`) is retried by the loop below, and a failed start is tried again.
    const ready = () => started ??= (async () => {
      await mkdir(dir, { recursive: true });
      await loadSettings();
      await shortcuts.list();
      await registerShortcuts();
      await showTray().catch(error => console.error('tray failed:', error));
    })().catch(error => { started = null; throw error; });
    // Every callback runs through here: a call made before this instance took over (stale_instance)
    // or after it was replaced must never become an unhandled rejection that kills the worker.
    const later = (task: () => unknown) => { void ready().then(task).catch(error => console.warn('screenshot:', String(error))); };
    context.subscriptions.push({ dispose: channel.onMessage<FromOverlay | FromSettings>(m => later(() => onMessage(m))) });
    context.subscriptions.push({ dispose: events.onSignal('shortcuts', () => later(async () => {
      const pressed = await shortcuts.events().catch(() => []) as { id: string }[];
      for (const p of pressed) if (MODES[p.id]) void serial(() => shoot(MODES[p.id].mode));
    })) });
    context.subscriptions.push({ dispose: events.onSignal('tray', () => later(async () => {
      const pressed = await tray.events().catch(() => []) as { id: string }[];
      for (const { id } of pressed) {
        const mode = ({ 'tray.area': 'area', 'tray.full': 'full', 'tray.quick': 'quick', 'tray.ocr': 'ocr' } as Record<string, Mode>)[id];
        if (mode) void serial(() => shoot(mode, 200));
        else if (id === 'tray.folder') void revealFolder().catch(() => {});
        else if (id === 'tray.settings') void openSettings().catch(() => {});
      }
    })) });
    context.subscriptions.push({ dispose: events.onSignal('permissions', () => later(async () => { await registerShortcuts(); await showTray().catch(() => {}); await pushSettings(); })) });
    context.subscriptions.push({ dispose: i18n.onDidChangeLocale(() => later(() => showTray().catch(() => {}))) });
    // Launcher and plugin-center commands. The launcher shows "done" and keeps its panel up for
    // 400 ms after a command returns, so a capture started from it waits until the panel is gone
    // (otherwise the frozen screen shows the launcher); other callers only need a short pause.
    const command = (mode: Mode) => async (args?: unknown) => {
      await ready();
      void serial(() => shoot(mode, launcher.session(args) ? 750 : 250));
      return { started: true };
    };
    context.commands.register('screenshot.capture', command('area'));
    context.commands.register('screenshot.capture-full', command('full'));
    context.commands.register('screenshot.capture-quick', command('quick'));
    context.commands.register('screenshot.capture-ocr', command('ocr'));
    context.commands.register('screenshot.settings', async () => { await ready(); await openSettings(); return { opened: true }; });
    context.commands.register('screenshot.folder', async () => { await ready(); await revealFolder(); return { opened: true }; });
    // Resident: register the shortcuts and the menu-bar icon as soon as this instance has taken over.
    void (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, attempt ? 1000 : 50));
        try { await ready(); return; } catch (error) { if (/denied|invalid|unsupported/.test(String(error))) { console.error('screenshot start failed:', error); return; } }
      }
    })();
  },
});
