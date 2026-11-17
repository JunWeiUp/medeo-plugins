// Files other plugins hand to Netdisk ("Send to › Medeo Drive", Screenshot / Clipboard "Store to Medeo
// Drive"; docs/ai-plugin-chat-design.html group 网盘接入). Runs in the worker: the sender gets an answer,
// the user a notification, and a small window only when Netdisk has to ask where.
import { appWindows, channel, drive, files, i18n, launcher, notifications, operations, storage, type LauncherInput } from '@one2x/medeo-plugin-sdk';
import { code, freeName, join, linkFor, nameFor, webloc } from './logic.ts';

export interface Root { id: string; name: string; label: string; folder: string; prefix: string }
/** Where a sender's files go: a root (by name; ids change whenever roots are listed) and a folder in it. */
export interface Destination { root: string; dir: string }
/** What the picker window shows and answers. */
export type FromPicker =
  | { type: 'store.hello' }
  | { type: 'store.choose'; root: string; remember: boolean }
  | { type: 'store.cancel' };
export type ToPicker = { type: 'store.request'; name: string; size: number; from: string; roots: { name: string; label: string }[]; remembered: string | null };

const PICKER = 'store';
const FOLLOW_MS = 10 * 60_000;
let asking: { request: Omit<ToPicker, 'type' | 'roots'>; resolve: (choice: { root: string; remember: boolean } | null) => void } | null = null;

/** This plugin's own copy (locales/); a missing key reads as `fallback` or the key. */
const t = async (key: string, params: Record<string, string | number> = {}, fallback?: string) => {
  const catalog = await i18n.catalog().catch(() => ({} as Record<string, string>));
  let text = catalog[key] ?? (fallback !== undefined ? catalog[fallback] ?? fallback : key);
  for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};

/** Granted roots that live in a Medeo Drive folder, labelled like the window's sidebar. */
export async function driveRoots(): Promise<Root[]> {
  const listed = (await files.result(await files.roots())).filter(r => r.available && r.id);
  const folders = await drive.folders().catch(() => []);
  const links = (await storage.get<Record<string, { folder: string; prefix: string }>>('links')) ?? {};
  return listed.flatMap(r => {
    const link = links[r.name] ?? linkFor(r.name, folders);
    const folder = link && folders.find(f => f.id === link.folder);
    return folder ? [{ id: r.id!, name: r.name, folder: folder.id, prefix: link!.prefix, label: link!.prefix ? link!.prefix.split('/').pop()! : folder.name }] : [];
  });
}


/** Write the item into `dir` of `root`, keeping both on a name clash; the stored path. */
async function write(root: Root, dir: string, input: LauncherInput, name: string): Promise<string> {
  if (input.type === 'file' || input.type === 'image') {
    if (!input.file?.source) throw Error('input_not_readable');
    let state = await files.import(root.id, join(dir, name), input.file.source, { keepBoth: true });
    while (state.status === 'running') {
      await new Promise(r => setTimeout(r, 250));
      state = await operations.state(state.id) as typeof state;
    }
    await operations.release(state.id).catch(() => {});
    if (state.status !== 'completed') throw Error(state.error ?? state.status);
    return (state.result as { path?: string } | null)?.path ?? join(dir, name);
  }
  const taken = (await files.result(await files.list(root.id, dir))).map(e => e.name);
  const path = join(dir, freeName(name, taken));
  await files.result(await files.writeText(root.id, path, input.type === 'url' ? webloc(input.value) : input.value, 'absent'));
  return path;
}

/** Ask where in the small window; null when the user cancels or closes it. */
async function ask(request: Omit<ToPicker, 'type' | 'roots'>): Promise<{ root: string; remember: boolean } | null> {
  asking?.resolve(null);
  const choice = new Promise<{ root: string; remember: boolean } | null>(resolve => { asking = { request, resolve }; });
  await appWindows.open({ id: PICKER, entry: 'ui/store.html', title: await t('store_title'), width: 440, height: 500 });
  const timeout = setTimeout(() => asking?.resolve(null), 5 * 60_000);
  try { return await choice; } finally { clearTimeout(timeout); asking = null; await appWindows.close(PICKER).catch(() => {}); }
}

/** The picker window's side of the conversation. */
export function listen() {
  return channel.onMessage<FromPicker>(message => {
    if (!asking) return;
    if (message?.type === 'store.hello') {
      void driveRoots().then(roots => channel.post({ type: 'store.request', ...asking!.request, roots: roots.map(r => ({ name: r.name, label: r.label })) } satisfies ToPicker));
    } else if (message?.type === 'store.choose' && typeof message.root === 'string') {
      asking.resolve({ root: message.root, remember: message.remember === true });
    } else if (message?.type === 'store.cancel') {
      asking.resolve(null);
    }
  });
}

/** Watch the stored file until the engine reports it synced or failed, and say so once. */
async function follow(root: Root, path: string, name: string, id: string) {
  const until = Date.now() + FOLLOW_MS;
  const rel = join(root.prefix, path);
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 3000));
    const state = (await drive.fileStates(root.folder, [rel]).catch(() => ({})) as Record<string, { state: string; reason?: string }>)[rel];
    if (state?.state === 'synced') { await notifications.show(id, await t('store_uploaded'), name).catch(() => {}); return; }
    if (state?.state === 'failed') { await notifications.show(id, await t('store_upload_failed'), `${name} · ${await t(`r_${state.reason ?? 'other'}`, {}, 'r_other')}`).catch(() => {}); return; }
  }
}

/** `netdisk.store` (`choose` false: the sender's last folder when there is one) and `netdisk.store-to` (always ask). */
export async function receive(args: unknown, choose: boolean): Promise<{ ok: boolean; name?: string; folder?: string; cancelled?: boolean; error?: string }> {
  const input = launcher.input(args) ?? ((args as { input?: LauncherInput } | null)?.input ?? null);
  if (!input) throw Error('invalid_argument');
  const session = launcher.session(args);
  const from = input.source || 'unknown';
  const name = nameFor(input);
  const id = `store-${Date.now().toString(36)}`;
  try {
    const remembered = (await storage.get<Record<string, Destination>>('destinations')) ?? {};
    let roots = await driveRoots();
    let dest: Destination | null = choose ? null : remembered[from] ?? null;
    let root = dest ? roots.find(r => r.name === dest!.root) : undefined;
    if (!root) {
      const picked = await ask({ name, size: input.file?.size ?? input.value.length, from, remembered: remembered[from]?.root ?? null });
      if (!picked) {
        if (session) await session.result({ tone: 'info', title: await t('store_cancelled') });
        return { ok: false, cancelled: true };
      }
      roots = await driveRoots();
      root = roots.find(r => r.name === picked.root);
      if (!root) throw Error('drive_folder_not_found');
      dest = { root: root.name, dir: '' };
      if (picked.remember) { remembered[from] = dest; await storage.set('destinations', remembered); }
    }
    const path = await write(root, dest!.dir, input, name);
    const stored = path.split('/').pop()!;
    const folder = [root.label, ...dest!.dir.split('/').filter(Boolean)].join(' / ');
    await notifications.show(id, await t('store_done', { folder }), `${stored} · ${await t('store_uploading')}`).catch(() => {});
    if (session) await session.result({ tone: 'success', title: await t('store_done', { folder }), message: stored });
    void follow(root, path, stored, id);
    return { ok: true, name: stored, folder };
  } catch (error) {
    const reason = code(error);
    const text = await t(`e_${reason}`, { folders: '' }, reason);
    await notifications.show(id, await t('store_failed'), text).catch(() => {});
    if (session) await session.result({ tone: 'error', title: await t('store_failed'), message: text });
    return { ok: false, error: reason };
  }
}
