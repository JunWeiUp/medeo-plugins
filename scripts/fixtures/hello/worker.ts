import { definePlugin, storage } from '@medeo-plugin/sdk';
export const { activate, deactivate } = definePlugin({
  activate(context) {
    context.commands.register('counter.increment', async () => {
      const previous = await storage.get<number>('counter');
      const counter = (typeof previous === 'number' ? previous : 0) + 1;
      await storage.set('counter', counter);
      return { counter };
    });
  },
});
