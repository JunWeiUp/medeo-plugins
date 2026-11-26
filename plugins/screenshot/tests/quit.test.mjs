import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withFakeHost } from '@one2x/medeo-plugin-sdk/testing';

const root = fileURLToPath(new URL('..', import.meta.url));
const waitFor = async predicate => {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('timed out waiting for screenshot worker');
};

test('screenshot tray quit cleans up windows, shortcuts, and tray before exiting cleanly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'screenshot-quit-'));
  const output = path.join(dir, 'worker.mjs');
  try {
    await build({
      entryPoints: [path.join(root, 'worker.ts')],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'esm',
      define: { 'process.exit': 'globalThis.testScreenshotExit' },
    });
    let items = [], pending = [], trayCount = 0, closed = 0, unregistered = 0, removed = 0, opened = 0;
    const exits = [];
    globalThis.testScreenshotExit = code => {
      assert.ok(closed >= 5, 'closes overlay/settings/hud/border/review windows');
      assert.ok(unregistered >= 1, 'unregisters bound shortcuts');
      assert.equal(removed, 1, 'removes menu bar tray icon');
      exits.push(code);
    };
    await withFakeHost({ handlers: {
      'i18n.t': args => args.key,
      'shortcuts.list': () => [],
      'shortcuts.register': () => null,
      'shortcuts.unregister': () => { unregistered++; return null; },
      'shortcuts.events': () => [],
      'capture.devices': () => ({ status: 'ready', cameras: [], microphones: [], displays: [] }),
      'tray.set': args => { items = args.items; trayCount++; return null; },
      'tray.events': () => pending.splice(0),
      'tray.remove': () => { removed++; return null; },
      'windows.close': () => { closed++; return null; },
      'windows.open': () => { opened++; return null; },
    } }, async host => {
      host.context.storagePath = path.join(dir, 'data');
      host.context.extensionPath = root;
      const { activate } = await import(pathToFileURL(output).href);
      activate(host.context);
      await waitFor(() => trayCount >= 1);
      const initialTrayCount = trayCount;
      assert.equal(items.at(-1).id, 'tray.quit');

      // Queue tray.quit followed by tray.settings — settings must be discarded after quit.
      pending.push({ id: 'tray.quit' }, { id: 'tray.settings' });
      host.emitEvent({ type: 'signal', channel: 'tray' });
      await waitFor(() => exits.length === 1);
      assert.deepEqual(exits, [0]);
      assert.equal(opened, 0, 'queued action after quit is discarded');

      // Subsequent signals must not resurrect the tray or windows.
      host.emitEvent({ type: 'signal', channel: 'permissions' });
      host.emitLocaleChanged({ locale: 'en' });
      await new Promise(r => setTimeout(r, 60));
      assert.equal(trayCount, initialTrayCount, 'signals must not resurrect the tray');
      assert.deepEqual(exits, [0]);
    });
  } finally {
    delete globalThis.testScreenshotExit;
    await rm(dir, { recursive: true, force: true });
  }
});
