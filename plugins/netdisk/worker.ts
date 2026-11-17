// Netdisk's window does the browsing; the worker receives what other plugins send
// ("Send to › Medeo Drive", Screenshot / Clipboard "Store to Medeo Drive").
import { definePlugin } from '@medeo-plugin/sdk';
import { listen, receive } from './src/receive.ts';
export const { activate, deactivate } = definePlugin({
  activate(context) {
    context.commands.register('netdisk.store', args => receive(args, false));
    context.commands.register('netdisk.store-to', args => receive(args, true));
    context.subscriptions.push({ dispose: listen() });
  },
});
