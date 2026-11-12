import { capabilities, definePlugin, i18n, storage, system } from '@medeo-plugin/sdk';
import { startInputProvider } from './src/ime-worker';
import { startLocalServerFixture } from './src/server-worker';

export interface Check { name: string; ok: boolean; detail?: unknown; error?: string }
export interface SelfTest { passed: boolean; checks: Check[]; permissions: { permission: string; granted: boolean; methods: number; available: number }[] }

async function check(name: string, run: () => Promise<unknown>): Promise<Check> {
  try { return { name, ok: true, detail: await run() }; }
  catch (error) { return { name, ok: false, error: String(error instanceof Error ? error.message : error) }; }
}

/** Calls only what has no effect outside this plugin: no clipboard, notifications, Keychain or files. */
async function selfTest(): Promise<SelfTest> {
  const catalog = await capabilities.list();
  const granted = (permission: string) => catalog.some(c => c.permission === permission && c.granted);
  const checks = [
    await check('capabilities.list', async () => catalog.length),
    await check('capabilities.labels', async () => Object.keys(await capabilities.labels()).length),
    await check('i18n.state', async () => (await i18n.state()).locale),
    await check('i18n.t', async () => await i18n.t('lab.selftest')),
  ];
  if (granted('storage')) checks.push(await check('storage', async () => {
    const value = { at: Date.now() };
    await storage.set('selftest', value);
    const read = await storage.get<typeof value>('selftest');
    await storage.remove('selftest');
    if (read?.at !== value.at) throw Error('storage round-trip returned ' + JSON.stringify(read));
    return 'round-trip';
  }));
  if (granted('system_info')) checks.push(await check('system.info', () => system.info()));
  return {
    passed: checks.every(c => c.ok),
    checks,
    permissions: catalog.filter(c => c.declared).map(c => ({ permission: c.permission, granted: c.granted, methods: c.methods.length, available: c.available_methods.length })),
  };
}

export const { activate, deactivate } = definePlugin({
  activate(context) {
    // The local server and input method tabs answer from the background, as their single-permission packages do.
    const stopServer = startLocalServerFixture();
    context.subscriptions.push({ dispose: stopServer }, startInputProvider());
    context.commands.register('lab.selftest', selfTest);
  },
});
