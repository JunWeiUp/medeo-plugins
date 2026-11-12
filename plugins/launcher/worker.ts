// Launcher: ⌥Space (a default keybinding the user can change in the plugin center) toggles a
// floating search panel. The panel page does the searching; the worker only shows and hides it.
import { appWindows, channel, definePlugin, i18n } from '@medeo-plugin/sdk';
import { PANEL, type FromWorker, type ToWorker } from './src/protocol.ts';

const SIZE = { width: 720, height: 476 };
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>) => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
const post = (message: FromWorker) => channel.post(message);

async function visible() {
  try { return (await appWindows.list()).some(w => w.id === PANEL && w.visible); } catch { return false; }
}
async function show() {
  const title = await i18n.t('plugin.name').catch(() => 'Launcher');
  // Reopening a hidden panel keeps its page (and the loaded app list) and moves it to the pointer.
  await appWindows.open({ id: PANEL, entry: 'ui/index.html', title, ...SIZE, panel: true });
  post({ type: 'shown' });
}
const hide = () => appWindows.hide(PANEL).catch(() => {});

export const { activate, deactivate } = definePlugin({
  activate(context) {
    context.commands.register('launcher.toggle', () => serial(async () => {
      if (await visible()) { await hide(); return { visible: false }; }
      await show();
      return { visible: true };
    }));
    context.subscriptions.push({ dispose: channel.onMessage<ToWorker>(message => {
      if (message?.type === 'hide') void serial(hide);
    }) });
  },
});
