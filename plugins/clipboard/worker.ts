// Clipboard: a Node plugin after EcoPaste. A helper watches the macOS pasteboard,
// the worker keeps the history on disk, a global shortcut summons a small floating
// panel at the pointer, and choosing an entry pastes it into the app the user was in.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appWindows, channel, definePlugin, events, i18n, shortcuts, tray, launcher } from '@medeo-plugin/sdk';
import type { LauncherActionResult } from '@medeo-plugin/sdk';
import type { Filter } from './src/history.ts';
import { Pasteboard } from './src/pasteboard.ts';
import { DEFAULTS, limitsOf, normalize, validShortcut, type Settings } from './src/settings.ts';
import { launcherItems, type Labels } from './src/launcher.ts';
import { Store, type Copy } from './src/store.ts';
import type { Reply, Request, Row, State } from './src/protocol.ts';

/** Under the 1 MiB channel limit with room for the envelope. */
const CHUNK_BUDGET = 800_000;
const PANEL = 'panel', SHORTCUT = 'open';
/** EcoPaste's window: 360 × 600. */
const PANEL_SIZE = { width: 360, height: 600 };
let store: Store, pasteboard: Pasteboard, settingsFile = '';
let state: State = { ready: false, error: null, settings: DEFAULTS, trusted: null, shortcutError: null };
let queue: Promise<unknown> = Promise.resolve(), posts = Promise.resolve();
let registered = '';
let exited = false;
let createPasteboard: () => Pasteboard;

/** Messages go out one after another so the panel sees them in order. */
const post = (message: Reply) => { posts = posts.then(() => channel.post(message)).catch(() => {}); };
const setState = (patch: Partial<State>) => { state = { ...state, ...patch }; post({ type: 'state', state }); };
const toast = (tone: 'success' | 'info' | 'error', key: string) => post({ type: 'toast', tone, key });
/** Copies, edits and panel requests touch the same list: one at a time. */
const serial = <T>(task: () => Promise<T>) => { const next = queue.then(task); queue = next.catch(error => console.error('clipboard failed:', error)); return next; };
const errorCode = (error: unknown) => error instanceof Error ? error.message : String(error);
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

function sendAll() {
  let chunk: Row[] = [], size = 0, first = true;
  const flush = () => { post({ type: 'rows', reset: first, rows: chunk }); first = false; chunk = []; size = 0; };
  for (const row of store.entries) {
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (chunk.length && size + bytes > CHUNK_BUDGET) flush();
    chunk.push(row); size += bytes;
  }
  flush();
  post({ type: 'state', state });
}

async function captured(copy: Copy) {
  if (exited || state.settings.paused) return;
  const result = await store.ingest(copy);
  if (!result) return;
  if (result.removed.length) post({ type: 'removed', ids: result.removed.map(e => e.id) });
  post({ type: 'added', row: result.entry });
}

async function saveSettings(patch: Partial<Settings>) {
  const next = normalize({ ...state.settings, ...patch });
  if (patch.shortcut !== undefined && !validShortcut(patch.shortcut)) return toast('error', 'settings.shortcut.invalid');
  await writeFile(settingsFile, JSON.stringify(next));
  const limitsChanged = next.maxItems !== state.settings.maxItems || next.retentionDays !== state.settings.retentionDays;
  setState({ settings: next });
  if (limitsChanged) { const removed = await store.setLimits(limitsOf(next)); if (removed.length) post({ type: 'removed', ids: removed.map(e => e.id) }); }
  if (patch.shortcut !== undefined) await registerShortcut();
  if (patch.paused !== undefined) await showTray().catch(() => {});
}

/** (Re)binds the summon shortcut to the saved accelerator. */
async function registerShortcut() {
  const wanted = state.settings.shortcut;
  if (registered && registered !== wanted) { await shortcuts.unregister(SHORTCUT).catch(() => {}); registered = ''; }
  if (!wanted) return setState({ shortcutError: null });
  try { await shortcuts.register(SHORTCUT, wanted, false); registered = wanted; setState({ shortcutError: null }); }
  catch (error) { registered = ''; setState({ shortcutError: errorCode(error) }); throw error; }
}

async function panelVisible() {
  try { return (await appWindows.list()).some(w => w.id === PANEL && w.visible); } catch { return false; }
}
async function openPanel(filter: Filter = 'all', settings = false) {
  const title = await i18n.t('plugin.name').catch(() => 'Clipboard');
  await appWindows.open({ id: PANEL, entry: 'ui/index.html', title, ...PANEL_SIZE, panel: true });
  post({ type: 'opened', filter, settings });
  void refreshTrust();
}
const hidePanel = () => appWindows.hide(PANEL).catch(() => {});
async function togglePanel(filter: Filter = 'all') {
  if (await panelVisible()) await hidePanel(); else await openPanel(filter);
}
/**
 * The menu-bar icon, after EcoPaste: a left click toggles the panel, a right click
 * opens the menu. Redrawn when recording is paused or resumed and when the language changes.
 */
async function showTray() {
  const label = (key: string) => i18n.t(key).catch(() => key);
  await tray.set('', [
    { id: 'tray.open', title: await label('tray.open') },
    { id: 'tray.favorites', title: await label('tray.favorites') },
    { separator: true },
    { id: 'tray.pause', title: await label('tray.pause'), checked: state.settings.paused },
    { separator: true },
    { id: 'tray.settings', title: await label('tray.settings') },
    { separator: true },
    { id: 'tray.quit', title: await label('tray.quit') },
  ], { icon: 'resources/trayTemplate.png', click: 'tray.open' });
}
async function trayPressed() {
  const pressed = await tray.events().catch(() => []) as { id: string }[];
  for (const { id } of pressed) {
    if (exited) return;
    if (id === 'tray.quit') { await quitClipboard(); return; }
    if (id === 'tray.open') await togglePanel();
    else if (id === 'tray.favorites') await openPanel('favorite');
    else if (id === 'tray.settings') await openPanel('all', true);
    else if (id === 'tray.pause') await saveSettings({ paused: !state.settings.paused });
  }
}
/** Flush history and release resources before a normal Node exit. */
async function quitClipboard() {
  exited = true;
  pasteboard.stop();
  setState({ ready: false });
  // Attempt every cleanup even if one platform permission has been revoked.
  const results = await Promise.allSettled([
    store.flush(), appWindows.close(PANEL), shortcuts.unregister(SHORTCUT), tray.remove(),
  ]);
  registered = '';
  for (const result of results) if (result.status === 'rejected') console.error('clipboard quit cleanup failed:', result.reason);
  // The host observes a successful exit, stops this instance and refreshes the plugin center.
  // Reopening starts a fresh worker, which loads the persisted history.
  process.exit(0);
}
async function refreshTrust(prompt = false) {
  const trusted = await pasteboard.trusted(prompt);
  if (trusted !== state.trusted) setState({ trusted });
  return trusted;
}

/**
 * Puts an entry on the pasteboard, hides the panel and presses ⌘V in the app that had focus
 * (the panel never took it). Without the Accessibility grant, or with auto-paste off, it copies.
 */
async function paste(id: string, plain: boolean) {
  const entry = store.entries.find(e => e.id === id);
  const body = entry && await store.body(entry);
  if (!entry || !body) return toast('error', 'toast.copyFailed');
  const ok = await pasteboard.write(plain && entry.text ? { text: entry.text } : body);
  if (!ok) return toast('error', 'toast.copyFailed');
  if (!state.settings.autoPaste) { await hidePanel(); return; }
  if (!await refreshTrust()) return toast('info', 'toast.copiedNeedsAccess');
  await hidePanel();
  // Let the panel give the key window back before the keystroke.
  await pause(120);
  if (!await pasteboard.paste()) toast('error', 'toast.pasteFailed');
}
async function copyOnly(id: string) {
  const entry = store.entries.find(e => e.id === id);
  const body = entry && await store.body(entry);
  const ok = !!body && await pasteboard.write(body);
  toast(ok ? 'success' : 'error', ok ? 'toast.copied' : 'toast.copyFailed');
}
/** The newest entry's text, pasted without formatting (a command, so it can have its own shortcut). */
async function pastePlain() {
  const entry = store.entries.find(e => e.text);
  if (!entry || !await pasteboard.write({ text: entry.text })) return { pasted: false };
  if (!state.settings.autoPaste || !await refreshTrust()) return { pasted: false, copied: true };
  return { pasted: await pasteboard.paste() };
}

// ------------------------------------------------------------------ Medeo Launcher Protocol
// The history in any launcher: search it, preview, paste or copy, star or delete; and take text,
// links and file paths other plugins send ("send to…") into the clipboard.
let launcherLabels: Labels | null = null;
async function labels(): Promise<Labels> {
  if (launcherLabels) return launcherLabels;
  const c = await i18n.catalog().catch(() => ({} as Record<string, string>));
  const t = (k: string, fallback: string) => c[k] ?? fallback;
  launcherLabels = { paste: t('launcher.paste', 'Paste'), copy: t('launcher.copy', 'Copy'), plain: t('launcher.plain', 'Paste as plain text'),
    star: t('launcher.star', 'Star'), unstar: t('launcher.unstar', 'Unstar'), remove: t('launcher.delete', 'Delete'), image: t('launcher.image', 'Image'),
    files: t('launcher.files', 'Files'), from: t('launcher.from', 'From'), copied: t('launcher.copied', 'Copied'), note: t('launcher.note', 'Note'), kind: t('launcher.kind', 'Type'),
    kinds: { text: t('filter.text', 'Text'), html: t('filter.rich', 'Rich text'), rtf: t('filter.rich', 'Rich text'), image: t('filter.image', 'Image'), files: t('filter.files', 'Files') } };
  return launcherLabels;
}
async function launcherAction(id: string, action: string): Promise<LauncherActionResult | void> {
  const entry = store.entries.find(e => e.id === id);
  if (!entry) return { refresh: true };
  const c = await labels();
  switch (action) {
    // Close the launcher first so the keystroke reaches the app the user was in.
    case 'paste': case 'plain': setTimeout(() => void serial(() => paste(id, action === 'plain')), 180); return { close: true };
    case 'copy': { const body = await store.body(entry); const ok = !!body && await pasteboard.write(body); return ok ? { close: true, toast: c.copy + ' ✓' } : { toast: 'copy failed' }; }
    case 'star': { const row = store.annotate(id, { favorite: !entry.favorite }); if (row) post({ type: 'updated', row }); return { refresh: true, toast: row?.favorite ? c.star + ' ✓' : c.unstar + ' ✓' }; }
    case 'delete': { post({ type: 'removed', ids: (await store.remove([id])).map(e => e.id) }); return { refresh: true }; }
  }
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    const dir = context.storagePath!, root = context.extensionPath!;
    settingsFile = path.join(dir, 'settings.json');
    store = new Store(dir);
    exited = false;
    createPasteboard = () => new Pasteboard(path.join(root, 'resources', 'pasteboard.js'), store.incoming,
      copy => void serial(() => captured(copy)), (ready, error) => { if (!exited) setState({ ready, error }); });
    pasteboard = createPasteboard();
    // Plain Node only here: the platform is not ours until activate returns.
    void serial(async () => {
      try { state.settings = normalize(JSON.parse(await readFile(settingsFile, 'utf8'))); } catch {}
      await store.load();
      await store.setLimits(limitsOf(state.settings));
      pasteboard.start();
    });
    // The shortcut and the menu-bar icon need the platform: set them once this instance has taken over.
    void (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await pause(attempt ? 1000 : 50);
        try { await serial(async () => { if (!exited) await registerShortcut(); }); break; }
        catch (error) { if (/conflict|denied|invalid/.test(errorCode(error))) break; }
      }
      for (let attempt = 0; attempt < 20; attempt++) {
        try { await serial(async () => { if (!exited) await showTray(); }); return; } catch (error) { if (/denied|invalid|unsupported/.test(errorCode(error))) return; }
        await pause(1000);
      }
    })();

    context.subscriptions.push(launcher.provide({
      search: async (query, { scoped, limit }) => launcherItems(store.entries, query, { scoped, limit, now: Date.now(), locale: (await i18n.state().catch(() => null))?.locale ?? 'en', blobs: store.blobs, labels: await labels() }),
      action: (item, action) => serial(() => launcherAction(item, action)),
    }));
    context.subscriptions.push({ dispose: i18n.onDidChangeLocale(() => { launcherLabels = null; }) });
    // "Send to…": text, a link or a file path from another plugin goes onto the clipboard (and so into the history).
    context.commands.register('clipboard.add', args => serial(async () => {
      const input = launcher.input(args);
      const text = input?.value ?? (typeof (args as { text?: unknown } | undefined)?.text === 'string' ? (args as { text: string }).text : null);
      if (!text) throw Error('invalid_argument');
      const ok = await pasteboard.write({ text });
      const session = launcher.session(args);
      if (session) await session.result({ tone: ok ? 'success' : 'error', title: await i18n.t(ok ? 'launcher.added' : 'toast.copyFailed'), message: text.slice(0, 200) });
      return { ok };
    }));
    context.commands.register('clipboard.open', () => serial(async () => { await togglePanel(); }).then(() => ({ ok: true })));
    context.commands.register('clipboard.favorites', () => serial(async () => { await openPanel('favorite'); }).then(() => ({ ok: true })));
    context.commands.register('clipboard.paste-plain', () => serial(async () => { return pastePlain(); }));
    context.commands.register('clipboard.toggle-pause', () => serial(async () => { await saveSettings({ paused: !state.settings.paused }); return { paused: state.settings.paused }; }));

    context.subscriptions.push({ dispose: events.onSignal('shortcuts', async () => {
      const pressed = await shortcuts.events().catch(() => []) as { id: string }[];
      if (pressed.some(e => e.id === SHORTCUT)) await serial(async () => { if (!exited) await togglePanel(); });
    }) });
    context.subscriptions.push({ dispose: events.onSignal('tray', () => serial(trayPressed)) });
    context.subscriptions.push({ dispose: events.onSignal('permissions', () => { void serial(async () => { if (exited) return; await registerShortcut().catch(() => {}); await showTray().catch(() => {}); }); }) });
    context.subscriptions.push({ dispose: i18n.onDidChangeLocale(() => { void serial(async () => { if (!exited) await showTray(); }); }) });
    context.subscriptions.push({ dispose: channel.onMessage<Request>(message => {
      if (exited) return;
      switch (message?.type) {
        case 'hello': void serial(async () => { sendAll(); await refreshTrust(); }); break;
        case 'paste': void serial(() => paste(String(message.id), message.plain === true)); break;
        case 'copy': void serial(() => copyOnly(String(message.id))); break;
        case 'delete': void serial(async () => post({ type: 'removed', ids: (await store.remove([String(message.id)])).map(e => e.id) })); break;
        case 'favorite': case 'note': void serial(async () => {
          const row = store.annotate(String(message.id), message.type === 'favorite' ? { favorite: message.favorite === true } : { note: String(message.note ?? '') });
          if (row) post({ type: 'updated', row });
        }); break;
        case 'clear': void serial(async () => { await store.remove(store.entries.filter(e => !e.favorite).map(e => e.id)); sendAll(); toast('success', 'toast.cleared'); }); break;
        case 'thumbs': if (Array.isArray(message.ids)) void serial(async () => {
          for (const id of message.ids.slice(0, 200)) {
            const entry = store.entries.find(e => e.id === id);
            if (entry) post({ type: 'thumb', id, url: await store.thumbnail(entry) });
          }
        }); break;
        case 'settings': if (message.patch && typeof message.patch === 'object') void serial(() => saveSettings(message.patch)); break;
        case 'grant': void serial(async () => { if (!await refreshTrust(true)) await pasteboard.openAccessibilitySettings(); }); break;
        case 'hide': void hidePanel(); break;
      }
    }) });
    context.subscriptions.push({ dispose: () => pasteboard.stop() }, { dispose: () => store.flush() });
  },
});
