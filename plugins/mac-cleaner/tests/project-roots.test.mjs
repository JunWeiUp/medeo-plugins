import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeRoot, parseRoots, rootIdentity, suggestions } from '../src/project-roots.ts';

test('project paths preserve commas and unicode; normalize aliases and reject files/missing/relative paths', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cleaner-roots-')));
  try {
    const folder = path.join(home, '项目, One');
    await mkdir(folder); await symlink(folder, path.join(home, 'alias')); await writeFile(path.join(home, 'file'), 'x');
    assert.deepEqual(parseRoots('~/项目, One\n~/alias\n'), ['~/项目, One', '~/alias']);
    assert.equal(await normalizeRoot('~/项目, One/', home), folder);
    assert.equal(await normalizeRoot(path.join(home, 'alias'), home), folder);
    assert.equal(await rootIdentity('~/alias', home), folder);
    for (const value of ['relative', '~/missing', '~/file', '~/bad\nname']) await assert.rejects(normalizeRoot(value, home));
    assert.equal(await rootIdentity('~/missing', home), path.join(home, 'missing'));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('quick add reports available, added and unavailable directories without alias duplicates', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cleaner-suggestions-')));
  try {
    await mkdir(path.join(home, 'Projects')); await mkdir(path.join(home, 'Documents/code'), { recursive: true });
    await symlink(path.join(home, 'Projects'), path.join(home, 'Code'));
    const rows = await suggestions([path.join(home, 'Projects')], home);
    assert.deepEqual(rows.find(r => r.path === '~/Projects'), { path: '~/Projects', available: true, added: true });
    assert.equal(rows.some(r => r.path === '~/Code'), false);
    assert.deepEqual(rows.find(r => r.path === '~/Documents/code'), { path: '~/Documents/code', available: true, added: false });
    assert.deepEqual(rows.find(r => r.path === '~/dev'), { path: '~/dev', available: false, added: false });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('real worker serializes rapid adds, rejects invalid paths, preserves commas and removes only the requested root', async () => {
  const { build } = await import('esbuild');
  const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cleaner-worker-')));
  const a = path.join(fixture, '项目, A'), b = path.join(fixture, 'B');
  await mkdir(a); await mkdir(b);
  const messages = [], values = { project_roots: '' };
  let listener;
  globalThis.__cleanerRootsTest = {
    channel: { post: async m => messages.push(structuredClone(m)), onMessage: fn => { listener = fn; return () => {}; } },
    config: { all: async () => ({ ...values }), set: async (k, v) => { await new Promise(r => setTimeout(r, 10)); values[k] = v; }, onDidChange: () => () => {} },
    definePlugin: x => x, trash: async () => { throw Error('unexpected trash'); },
    i18n: { t: async k => k, state: async () => ({ locale: 'en' }) }, launcher: { session: () => null }
  };
  try {
    const bundle = await build({ entryPoints: ['plugins/mac-cleaner/worker.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
      plugins: [{ name: 'sdk-fixture', setup(build) {
        build.onResolve({ filter: /^@medeo-plugin\/sdk$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const { channel, config, definePlugin, trash, i18n, launcher } = globalThis.__cleanerRootsTest;', loader: 'js' }));
      } }] });
    const worker = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
    worker.activate({ subscriptions: [], commands: { register: () => ({ dispose() {} }) } });
    const wait = async fn => { for (let n = 0; n < 200; n++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail('worker timeout'); };
    listener({ type: 'roots', action: 'add', roots: [a] });
    listener({ type: 'roots', action: 'add', roots: [b] });
    await wait(() => parseRoots(values.project_roots).length === 2);
    assert.deepEqual(parseRoots(values.project_roots), [a, b]);
    listener({ type: 'roots', action: 'add', roots: [a + '/'] });
    await wait(() => messages.some(m => m.key === 'settings.projects.duplicate'));
    listener({ type: 'roots', action: 'add', roots: [path.join(fixture, 'missing')] });
    await wait(() => messages.some(m => m.key === 'settings.projects.invalid'));
    assert.deepEqual(parseRoots(values.project_roots), [a, b]);
    listener({ type: 'roots', action: 'remove', roots: [a] });
    await wait(() => values.project_roots === b);
    assert.equal((await import('node:fs')).existsSync(a), true);
    worker.deactivate();
  } finally { delete globalThis.__cleanerRootsTest; await rm(fixture, { recursive: true, force: true }); }
});
