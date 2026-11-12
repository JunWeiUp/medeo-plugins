import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withFakeHost } from '@medeo-plugin/sdk/testing';

const root = fileURLToPath(new URL('..', import.meta.url));
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('timed out waiting for worker');
};

test('tray quit flushes history and cleans resources before exiting successfully', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clipboard-quit-'));
  const output = path.join(dir, 'worker.mjs');
  try {
    await build({ entryPoints: [path.join(root, 'worker.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', define: { 'process.exit': 'globalThis.testClipboardExit' }, plugins: [{
      name: 'fake-pasteboard', setup(builder) {
        builder.onLoad({ filter: /\/src\/pasteboard\.ts$/ }, () => ({ contents: `
          export class Pasteboard {
            static instances = [];
            constructor(helper, incoming, copy, state) { this.copy = copy; this.state = state; Pasteboard.instances.push(this); }
            start() { this.started = true; this.state(true, null); }
            stop() { this.stopped = true; }
            async trusted() { return false; }
          }
          globalThis.testPasteboard = Pasteboard;
        `, loader: 'js' }));
      },
    }] });
    let items = [], pending = [], shortcutEvents = [], trayCount = 0, closed = 0, unregistered = 0, removed = 0, opened = 0;
    const exits = [];
    globalThis.testClipboardExit = code => {
      assert.equal(closed, 1);
      assert.equal(unregistered, 1);
      assert.equal(removed, 1);
      const history = JSON.parse(readFileSync(path.join(dir, 'data/history.json'), 'utf8'));
      assert.deepEqual(history.entries.map(row => row.text), ['kept-history']);
      exits.push(code);
    };
    await withFakeHost({ handlers: {
      'i18n.t': args => args.key,
      'shortcuts.register': () => null,
      'shortcuts.unregister': () => { unregistered++; return null; },
      'shortcuts.events': () => shortcutEvents.splice(0),
      'tray.set': args => { items = args.items; trayCount++; return null; },
      'tray.events': () => pending.splice(0),
      'tray.remove': () => { removed++; return null; },
      'windows.close': () => { closed++; return null; },
      'windows.list': () => [],
      'windows.open': () => { opened++; return null; },
    } }, async host => {
      host.context.storagePath = path.join(dir, 'data');
      host.context.extensionPath = root;
      const { activate } = await import(pathToFileURL(output).href);
      activate(host.context);
      await waitFor(() => trayCount >= 2);
      const initialTrayCount = trayCount;
      assert.equal(items.at(-1).id, 'tray.quit');
      const first = globalThis.testPasteboard.instances[0];
      first.copy({ text: 'kept-history' });
      pending.push({ id: 'tray.quit' }, { id: 'tray.open' });
      host.emitEvent({ type: 'signal', channel: 'tray' });
      await waitFor(() => exits.length === 1);
      assert.deepEqual(exits, [0]);
      assert.equal(first.stopped, true);
      assert.equal(closed, 1);
      assert.equal(unregistered, 1);
      assert.equal(opened, 0, 'queued open after quit is discarded');
      host.emitEvent({ type: 'signal', channel: 'permissions' });
      shortcutEvents.push({ id: 'open' });
      host.emitEvent({ type: 'signal', channel: 'shortcuts' });
      host.emitLocaleChanged({ locale: 'en' });
      first.copy({ text: 'must-not-record-after-quit' });
      await new Promise(r => setTimeout(r, 60));
      assert.equal(trayCount, initialTrayCount, 'signals must not resurrect the tray');
      assert.equal(opened, 0);
      assert.deepEqual(exits, [0], 'quit requests exactly one normal process exit');
    });
  } finally {
    delete globalThis.testPasteboard;
    delete globalThis.testClipboardExit;
    await rm(dir, { recursive: true, force: true });
  }
});
