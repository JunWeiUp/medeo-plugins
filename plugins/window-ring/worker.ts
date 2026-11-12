// Window Ring: Loop-style window layouts on Medeo's `window_management` capability.
// Shortcuts apply a layout to the window you are in; ⌃⌥Space opens a radial menu in a
// transparent overlay that previews the layout and applies it when ⌃⌥ is released.
import { appWindows, channel, config, definePlugin, events, i18n, launcher, operations, shortcuts, storage, tray, windowManagement } from '@medeo-plugin/sdk';
import type { ManagedScreen, ManagedWindow } from '@medeo-plugin/sdk';
import { History, close, frameFor, isAction, nextInCycle, nextScreen, onNextDisplay, screenAt, screenOf, type Action, type Frame } from './src/layout.ts';
import { BINDINGS, type BindingState, type FromWorker, type RingSession, type ShortcutError, type Status, type ToWorker } from './src/protocol.ts';
import { clean, duplicateOf, effective, symbols, valid, type Overrides } from './src/shortcuts.ts';

const RING = 'ring', SETTINGS = 'settings';
const wait = <T>(job: Promise<{ id: string; status: string }>) => job.then(j => operations.wait<T>(j));
const code = (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'failed';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const history = new History();
/** What the last layout did per window, so the next press of the same key can cycle. */
const lastApplied = new Map<string, { action: Action; frame: Frame }>();
const status: Status = { plugin: false, os: 'unknown', bindings: {}, accelerators: effective({}), customized: [], tray: true, storage: true };
/** The user's shortcut changes and menu-bar choice, read from `storage` on first use. */
let overrides: Overrides = {}, loaded = false, recording = false, resumeTimer: ReturnType<typeof setTimeout> | undefined;
let ring: { session: number; window: ManagedWindow; screen: ManagedScreen } | undefined;
let sessions = 0, exited = false, registering: Promise<void> | undefined;

// One platform action at a time: a fast double press must not interleave two moves.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };

const post = (message: FromWorker) => channel.post(message);
const settings = async () => {
  const values = await config.all().catch(() => ({} as Record<string, unknown>));
  return { gap: Math.max(0, Math.min(64, Number(values.gap) || 0)), cycles: values.cycles !== false };
};

async function refreshStatus(): Promise<Status> {
  await load().catch(() => {});
  try {
    const answer = await wait<{ authorization: string }>(windowManagement.status());
    status.plugin = true; status.os = answer.authorization === 'granted' ? 'granted' : 'denied';
  } catch (error) {
    status.plugin = code(error) !== 'permission_denied';
    status.os = 'unknown';
  }
  post({ type: 'status', status });
  return status;
}

async function load(): Promise<void> {
  if (loaded) return;
  try {
    const [saved, menu] = await Promise.all([storage.get('shortcuts'), storage.get<boolean>('tray')]);
    overrides = clean(saved); status.tray = menu !== false; status.storage = true;
  } catch (error) { status.storage = code(error) !== 'permission_denied'; }
  loaded = true;
  publishAccelerators();
}
function publishAccelerators() {
  status.accelerators = effective(overrides);
  status.customized = Object.keys(overrides);
}
async function save(): Promise<void> {
  try { await storage.set('shortcuts', overrides); status.storage = true; }
  catch (error) { status.storage = code(error) !== 'permission_denied'; throw Error('storage'); }
}

async function registerShortcuts(): Promise<void> {
  await load();
  // While the page records a shortcut every one of ours stays off, or the OS would hand the keys to us.
  if (recording) return;
  const wanted = new Map(Object.entries(status.accelerators));
  const current = new Map((await shortcuts.list().catch(() => [])).map(s => [s.id, s.accelerator]));
  let transient = '', lastError: unknown;
  for (const binding of BINDINGS) {
    if (exited) return;
    let state: BindingState = 'registered';
    const accelerator = wanted.get(binding.id) ?? null;
    if (accelerator === null) {
      if (current.has(binding.id)) await shortcuts.unregister(binding.id).catch(() => {});
      state = 'none';
    } else if (current.get(binding.id) !== accelerator) {
      try {
        if (current.has(binding.id)) await shortcuts.unregister(binding.id);
        await shortcuts.register(binding.id, accelerator, false);
      }
      catch (error) { lastError = error; const c = code(error); state = c.includes('conflict') ? 'conflict' : c.includes('denied') ? 'denied' : 'off'; }
    }
    status.bindings[binding.id] = state;
    if (state === 'off') transient = code(lastError);
  }
  post({ type: 'status', status });
  void showTray().catch(() => {});
  // Right after a (re)start the host may not have handed the platform over yet: let the caller retry.
  if (transient) throw Error(transient);
}
const register = () => (registering ??= registerShortcuts().finally(() => { registering = undefined; }));

/** Pause every shortcut of ours while the page records one; it ends on save, Esc, blur, or after 30 s. */
async function setRecording(active: boolean): Promise<void> {
  clearTimeout(resumeTimer);
  if (active === recording) return;
  recording = active;
  if (active) {
    resumeTimer = setTimeout(() => void serial(() => setRecording(false)).catch(() => {}), 30_000);
    for (const s of await shortcuts.list().catch(() => [])) await shortcuts.unregister(s.id).catch(() => {});
  } else {
    await register().catch(() => {});
  }
}

/** Changes one binding: the key must be free in this plugin and in the OS; only then is it kept. */
async function setShortcut(id: string, accelerator: string | null): Promise<{ ok: boolean; error?: ShortcutError; other?: string }> {
  const binding = BINDINGS.find(b => b.id === id);
  if (!binding || (accelerator !== null && !valid(accelerator))) return { ok: false, error: 'invalid' };
  await load();
  if (!status.storage) return { ok: false, error: 'storage' };
  if (accelerator !== null) {
    const other = duplicateOf(id, accelerator, status.accelerators);
    if (other) return { ok: false, error: 'duplicate', other };
    // Try the key for real first: the OS (or another plugin, or a Medeo shortcut) may already own it.
    await shortcuts.unregister(id).catch(() => {});
    try { await shortcuts.register(id, accelerator, false); }
    catch (error) {
      const c = code(error);
      if (!recording) await register().catch(() => {});
      return { ok: false, error: c.includes('conflict') ? 'conflict' : c.includes('denied') ? 'denied' : 'failed' };
    }
  }
  const previous = overrides;
  overrides = clean({ ...overrides, [id]: accelerator === null ? null : accelerator });
  // Back to the default value: `clean` dropped it, so the binding reads as not customized.
  if (accelerator !== null && !Object.hasOwn(overrides, id)) delete overrides[id];
  try { await save(); } catch { overrides = previous; publishAccelerators(); return { ok: false, error: 'storage' }; }
  publishAccelerators();
  if (!recording) await register().catch(() => {});
  else post({ type: 'status', status });
  return { ok: true };
}

async function resetShortcuts(id?: string): Promise<void> {
  await load();
  const previous = overrides;
  overrides = id ? Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== id)) : {};
  try { await save(); } catch { overrides = previous; }
  publishAccelerators();
  await register().catch(() => {});
}

// ---------------------------------------------------------------- menu bar
const MENU: (typeof BINDINGS[number]['id'])[] = ['left-half', 'right-half', 'top-half', 'bottom-half', 'maximize', 'center', 'next-display', 'undo'];
async function showTray(): Promise<void> {
  if (exited || !loaded) return;
  if (!status.tray) { await tray.remove().catch(() => {}); return; }
  const label = async (key: string, id?: string) => {
    const name = await i18n.t(key).catch(() => key), keys = id && status.accelerators[id];
    return keys ? `${name}    ${symbols(keys).join('')}` : name;
  };
  const items = [
    { id: 'tray.ring', title: await label('tray.ring', 'ring') },
    { separator: true as const },
    ...await Promise.all(MENU.map(async id => ({ id: `tray.${id}`, title: await label(`action.${id}`, id) }))),
    { separator: true as const },
    { id: 'tray.settings', title: await label('tray.settings') },
    { id: 'tray.hide', title: await label('tray.hide') },
  ];
  await tray.set('', items, { icon: 'ui/trayTemplate.png' });
}
async function trayPressed(): Promise<void> {
  const pressed = await tray.events().catch(() => []) as { id: string }[];
  for (const { id } of pressed) {
    if (exited) return;
    const what = id.replace(/^tray\./, '');
    if (what === 'settings') await openSettings();
    else if (what === 'hide') await setTray(false);
    else await trigger(what).catch(error => console.warn('menu failed', what, code(error)));
  }
}
async function setTray(visible: boolean): Promise<void> {
  await load();
  status.tray = visible;
  await storage.set('tray', visible).catch(() => {});
  await showTray().catch(() => {});
  post({ type: 'status', status });
}
async function openSettings(): Promise<void> {
  await appWindows.open({ id: SETTINGS, entry: 'ui/index.html', title: await i18n.t('title'), width: 760, height: 720 });
}

/** The window you are in, the displays, and where the pointer is — read together. */
async function snapshot() {
  const [window, screens, pointer] = await Promise.all([
    wait<ManagedWindow | null>(windowManagement.focused()),
    wait<ManagedScreen[]>(windowManagement.screens()),
    wait<{ x: number; y: number }>(windowManagement.pointer()),
  ]);
  return { window, screens, pointer };
}

/** Puts `window` where `action` says on `screen` (or, for shortcuts, the display it is on). */
async function apply(action: Action, window: ManagedWindow, screens: ManagedScreen[], screen?: ManagedScreen): Promise<void> {
  const { gap, cycles } = await settings();
  let target: Frame | null;
  let applied = action;
  if (action === 'undo') {
    target = history.pop(window.id) ?? null;
    if (!target) return;
  } else {
    const last = lastApplied.get(window.id);
    applied = nextInCycle(action, last, window.frame, cycles);
    if (applied === 'next-display') {
      // A window still in a layout we applied takes the same layout on the next display; anything
      // else keeps its relative place and size.
      const next = nextScreen(window.frame, screens);
      const kept = last && close(last.frame, window.frame) && frameFor(last.action, next?.visible_frame ?? window.frame, window.frame, gap);
      if (next && last && kept) { applied = last.action; target = kept; }
      else target = onNextDisplay(window.frame, screens);
    } else {
      target = frameFor(applied, (screen ?? screenOf(window.frame, screens) ?? screens[0]).visible_frame, window.frame, gap);
    }
    if (!target) return;
    history.push(window.id, window.frame);
  }
  try {
    const result = await wait<{ frame: Frame }>(windowManagement.setFrame(window.id, target));
    // Remember what the app actually accepted: that is what the next press compares against.
    if (action === 'undo') lastApplied.delete(window.id); else lastApplied.set(window.id, { action: applied, frame: result.frame });
    status.last = { action: applied, ok: true };
    post({ type: 'applied', action: applied });
  } catch (error) {
    if (action !== 'undo') history.pop(window.id);
    status.last = { action: applied, ok: false, error: code(error) };
    console.warn('apply failed', applied, code(error));
    throw error;
  } finally {
    post({ type: 'status', status });
  }
}

async function shortcutPressed(action: Action): Promise<void> {
  const { window, screens } = await snapshot();
  if (!window || window.fullscreen || window.minimized) {
    console.info('skipped', action, window ? JSON.stringify({ fullscreen: window.fullscreen, minimized: window.minimized }) : 'no window');
    status.last = { action, ok: false, error: window ? 'fullscreen' : 'no_window' };
    post({ type: 'status', status });
    return;
  }
  await apply(action, window, screens);
}

/** Opens the ring for the window you are in; `false` when there is none it may move. */
async function openRing(): Promise<boolean> {
  const { window, screens, pointer } = await snapshot();
  if (!window || window.fullscreen || window.minimized) {
    status.last = { action: 'ring', ok: false, error: window ? 'fullscreen' : 'no_window' };
    post({ type: 'status', status });
    return false;
  }
  const screen = screenAt(pointer.x, pointer.y, screens) ?? screens[0];
  const { gap } = await settings();
  const session = ++sessions;
  ring = { session, window, screen };
  const message: RingSession = { type: 'ring', session, pointer, screen, window: window.frame, gap };
  // A page that is already loaded gets the session now; a new one asks with `hello` once ready.
  pendingRing = message;
  await appWindows.open({ id: RING, entry: 'ui/ring.html', title: await i18n.t('action.ring'), width: 240, height: 240, overlay: true });
  post(message);
  return true;
}
let pendingRing: RingSession | undefined;

async function closeRing(session: number): Promise<void> {
  if (ring?.session !== session) return;
  ring = undefined; pendingRing = undefined;
  await appWindows.hide(RING).catch(() => {});
  post({ type: 'closed', session });
}

async function trigger(id: string): Promise<void> {
  const binding = BINDINGS.find(b => b.id === id);
  if (!binding) return;
  if (binding.action === 'ring') { await openRing(); return; }
  return shortcutPressed(binding.action);
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    exited = false;
    // The platform is ours only once activate has returned: register shortly after.
    void (async () => {
      for (let attempt = 0; attempt < 20 && !exited; attempt++) {
        await pause(attempt ? 1000 : 50);
        try { await serial(async () => { await register(); await refreshStatus(); }); break; }
        catch (error) { console.warn('shortcut registration', attempt, code(error)); if (/denied/.test(code(error))) break; }
      }
    })();

    // `ok: false` tells the caller (plugin center, launcher) that there was no window to move.
    context.commands.register('window-ring.open', () => serial(openRing).then(ok => ({ ok, last: ok ? null : status.last ?? null })));
    context.commands.register('window-ring.apply', args => serial(async () => {
      const action = (args as { action?: unknown } | undefined)?.action;
      if (!isAction(action)) throw Error('invalid_argument');
      await shortcutPressed(action);
      // From a launcher, say why nothing moved instead of closing silently.
      const session = launcher.session(args);
      if (session && status.last && !status.last.ok) await session.result({ tone: 'warning', title: await i18n.t(`launcher.skipped.${status.last.error === 'fullscreen' ? 'fullscreen' : status.last.error === 'no_window' ? 'no_window' : 'failed'}`) }).catch(() => {});
      return { ok: status.last?.ok ?? false, last: status.last ?? null };
    }));
    // "Show Status" shows it: the settings page lists permission, shortcuts and the last layout.
    context.commands.register('window-ring.state', () => serial(async () => {
      await openSettings();
      await refreshStatus();
      return { ...status, shortcuts: await shortcuts.list().catch(() => []) };
    }));

    context.subscriptions.push({ dispose: events.onSignal('shortcuts', async () => {
      const pressed = await shortcuts.events().catch(() => []) as { id: string }[];
      for (const press of pressed) await serial(() => trigger(press.id)).catch(error => console.warn('trigger failed', press.id, code(error)));
    }) });
    context.subscriptions.push({ dispose: events.onSignal('tray', () => { void serial(trayPressed).catch(() => {}); }) });
    context.subscriptions.push({ dispose: i18n.onDidChangeLocale(() => { void serial(showTray).catch(() => {}); }) });
    context.subscriptions.push({ dispose: events.onSignal('permissions', () => { void serial(async () => { if (exited) return; await register(); await refreshStatus(); }).catch(() => {}); }) });
    context.subscriptions.push({ dispose: channel.onMessage<ToWorker>(message => {
      if (exited) return;
      switch (message?.type) {
        case 'hello':
          if (message.from === 'ring' && pendingRing) post(pendingRing);
          else void serial(refreshStatus).catch(() => {});
          break;
        case 'apply': {
          const current = ring;
          if (!current || current.session !== message.session || !isAction(message.action)) break;
          void serial(async () => {
            await closeRing(current.session);
            const { window: now, screens } = await snapshot();
            // The window may have moved while the ring was open; start from where it is now.
            const window = now?.id === current.window.id ? now : current.window;
            await apply(message.action, window, screens, current.screen);
          }).catch(() => {});
          break;
        }
        case 'cancel': void serial(() => closeRing(message.session)).catch(() => {}); break;
        case 'grant': void serial(async () => { await register(); await refreshStatus(); }).catch(() => {}); break;
        case 'record': void serial(() => setRecording(message.active === true)).catch(() => {}); break;
        case 'set-shortcut': {
          const { id, accelerator } = message;
          void serial(() => setShortcut(String(id), typeof accelerator === 'string' ? accelerator : null))
            .then(result => post({ type: 'shortcut-result', id: String(id), ...result }))
            .catch(() => post({ type: 'shortcut-result', id: String(id), ok: false, error: 'failed' }));
          break;
        }
        case 'reset-shortcuts': void serial(() => resetShortcuts(typeof message.id === 'string' ? message.id : undefined)).catch(() => {}); break;
        case 'tray': void serial(() => setTray(message.visible === true)).catch(() => {}); break;
      }
    }) });
  },
  deactivate() { exited = true; clearTimeout(resumeTimer); ring = undefined; pendingRing = undefined; },
});
