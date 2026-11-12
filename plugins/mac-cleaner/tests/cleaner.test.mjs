// Scan and clean against a synthetic home; no real user data is read.
// Run: node --test plugins/mac-cleaner/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolvePath } from '../src/env.ts';
import { isProtected } from '../src/protect.ts';
import { scan, scopeOf } from '../src/scan.ts';
import { defaultSelection, GROUPS, subRows, tick } from '../src/general.ts';
import { clean, trashBatches } from '../src/clean.ts';
import { groups, safeIds, size, total } from '../src/view.ts';
import { PATH_RULES, COMMAND_RULES } from '../src/catalog.ts';

function home() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mac-cleaner-')));
  const file = (rel, bytes = 5000) => { const p = path.join(root, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, Buffer.alloc(bytes)); };
  file('Library/Developer/Xcode/DerivedData/App-abc/Build/x.o');
  file('Library/Developer/Xcode/DerivedData/Other-def/info.plist');
  file('Library/Caches/Google/Chrome/Default/Cache/data_0');
  file('Library/Logs/com.apple.secret/log.txt');
  file('Library/Logs/SomeApp/log.txt');
  file('Library/Developer/CoreSimulator/Devices/D1/data/Library/Caches/com.apple.mobilesafari/c.db');
  file('custom-gradle/caches/modules-2/a.jar');
  file('.Trash/old.zip');
  file('Projects/web/node_modules/left-pad/index.js');
  file('Projects/web/node_modules/left-pad/node_modules/inner/index.js');
  file('Projects/web/src/index.js');
  file('Projects/rust/target/debug/app');
  file('Projects/.hidden/node_modules/x.js');
  mkdirSync(path.join(root, 'Library/Caches/app.medeo.desktop.stg'), { recursive: true });
  // An installed app for the junk cleanup: its cache, a crash report, and localizations.
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.demo</string><key>CFBundleName</key><string>Demo &amp; Co</string><key>CFBundleDevelopmentRegion</key><string>ja</string></dict></plist>`;
  file('Applications/Demo.app/Contents/Info.plist', 0); writeFileSync(path.join(root, 'Applications/Demo.app/Contents/Info.plist'), plist);
  for (const l of ['Base', 'en', 'fr', 'de', 'ja', 'zh-Hans', 'es']) file(`Applications/Demo.app/Contents/Resources/${l}.lproj/Localizable.strings`);
  // An app with nothing but removable localizations is left alone.
  file('Applications/Only.app/Contents/Info.plist', 0); writeFileSync(path.join(root, 'Applications/Only.app/Contents/Info.plist'), plist.replace('com.example.demo', 'com.example.only').replace('Demo &amp; Co', 'Only').replace('<string>ja</string>', '<string>ko</string>'));
  for (const l of ['fr', 'it']) file(`Applications/Only.app/Contents/Resources/${l}.lproj/x.strings`);
  file('Library/Caches/com.example.demo/data.db');
  file('Library/Application Support/Demo & Co/user.db');
  file('Library/Application Support/CrashReporter/Demo & Co-ABC.plist');
  file('Library/Logs/DiagnosticReports/Demo & Co-2026-10-01.ips');
  file('Downloads/setup.dmg'); file('Downloads/backup.tar.gz'); file('Downloads/notes.txt');
  return root;
}
const run = async (root, extra = {}) => {
  const items = [];
  await scan({ scope: 'developer', home: root, env: { GRADLE_USER_HOME: path.join(root, 'custom-gradle') }, projectRoots: ['~/Projects'], commands: false, cancelled: () => false,
    appRoots: ['~/Applications'], systemLanguages: ['zh-Hans-CN', 'es-419'], appLanguages: async id => (id === 'com.example.demo' ? ['de'] : []), ...extra }, i => items.push(i));
  return items;
};

test('rules are complete and unique', () => {
  assert.equal(PATH_RULES.length, 77);
  assert.equal(COMMAND_RULES.length, 13);
  assert.equal(new Set(PATH_RULES.map(r => r.id)).size, PATH_RULES.length);
});
test('toolchain variables follow the environment, then defaults', () => {
  assert.equal(resolvePath('${GOMODCACHE}/cache', {}, '/h'), '/h/go/pkg/mod/cache');
  assert.equal(resolvePath('${GOMODCACHE}/cache', { GOPATH: '/gp' }, '/h'), '/gp/pkg/mod/cache');
  assert.equal(resolvePath('${UV_CACHE_DIR}', { XDG_CACHE_HOME: '/x' }, '/h'), '/x/uv');
  assert.equal(resolvePath('${NOPE}/a', {}, '/h'), '${NOPE}/a');
});
test('scan finds rule items, project artifacts and skips system data', async () => {
  const root = home(), items = await run(root);
  const paths = items.map(i => path.relative(root, i.path)).sort();
  assert.deepEqual(paths, [
    'Library/Developer/CoreSimulator/Devices/D1/data/Library/Caches/com.apple.mobilesafari',
    'Library/Developer/Xcode/DerivedData/App-abc',
    'Library/Developer/Xcode/DerivedData/Other-def',
    'Projects/rust/target',
    'Projects/web/node_modules',
    'custom-gradle/caches/modules-2',
  ]);
  const byPath = Object.fromEntries(items.map(i => [path.relative(root, i.path), i]));
  assert.equal(byPath['Projects/rust/target'].risk, 'review');
  assert.equal(byPath['Projects/web/node_modules'].risk, 'safe');
  // Nested node_modules are measured inside the outer one, not listed again.
  assert.ok(byPath['Projects/web/node_modules'].bytes >= 10_000);
  assert.ok(items.every(i => i.bytes > 0 && i.kind === 'path'));
  assert.deepEqual(groups(items).map(g => g.category), ['projects', 'xcode', 'simulator', 'android']);
});
test('protected paths are refused, through links too', () => {
  const root = home();
  for (const p of ['/', '/System/Library', '/usr/bin', '/private/var/db/x', root, `${root}/.Trash`, `${root}/Library/Keychains/login.keychain-db`, `${root}/Library/Caches/app.medeo.desktop.stg`])
    assert.ok(isProtected(p, root), p);
  symlinkSync('/System', path.join(root, 'sys'));
  assert.ok(isProtected(path.join(root, 'sys'), root));
  assert.ok(!isProtected(`${root}/Library/Caches/Homebrew`, root));
});
test('trash batches stay under the request limit', () => {
  const long = Array.from({ length: 600 }, (_, i) => `/Users/x/${'a'.repeat(200)}/${i}`);
  const batches = trashBatches(long);
  assert.ok(batches.every(b => b.length <= 256 && Buffer.byteLength(JSON.stringify({ paths: b })) < 64 * 1024));
  assert.equal(batches.flat().length, 600);
});
test('clean deletes, trashes and runs commands; refuses protected paths', async () => {
  const root = home(), items = [...await run(root), ...await run(root, { scope: 'general' })];
  const pick = rel => items.find(i => path.relative(root, i.path) === rel);
  const trashed = [];
  const deps = { home: root, trash: async paths => paths.map(p => (trashed.push(p), { path: p, trashed: !p.endsWith('Other-def'), error: p.endsWith('Other-def') ? 'busy' : undefined })) };
  const chosen = [pick('Library/Developer/Xcode/DerivedData/App-abc'), pick('Library/Developer/Xcode/DerivedData/Other-def'), pick('.Trash/old.zip'),
    { ...pick('Library/Logs/SomeApp'), path: path.join(root, 'Library/Keychains'), id: 'evil' }];
  const outcomes = await clean(chosen, 'trash', deps);
  const by = Object.fromEntries(outcomes.map(o => [o.id, o]));
  // Already in the Trash: removed for good, not handed to the Trash again.
  assert.ok(!existsSync(path.join(root, '.Trash/old.zip')) && by[chosen[2].id].ok);
  assert.deepEqual(trashed.map(p => path.relative(root, p)), ['Library/Developer/Xcode/DerivedData/App-abc', 'Library/Developer/Xcode/DerivedData/Other-def']);
  assert.ok(by[chosen[0].id].ok && by[chosen[0].id].freed > 0);
  assert.deepEqual([by[chosen[1].id].ok, by[chosen[1].id].error], [false, 'busy']);
  assert.deepEqual([by.evil.ok, by.evil.error], [false, 'protected']);
  // Delete permanently.
  const node = pick('Projects/web/node_modules');
  assert.ok((await clean([node], 'delete', deps))[0].ok);
  assert.ok(!existsSync(node.path) && existsSync(path.join(root, 'Projects/web/src/index.js')));
  // A command item runs its rule's arguments.
  const calls = [];
  const command = { id: 'cli.go-clean-cache', rule: 'cli.go-clean-cache', category: 'go', risk: 'safe', kind: 'command', path: '/usr/local/go/bin/go', name: '', bytes: 10 };
  const [result] = await clean([command], 'trash', { ...deps, run: async (exe, args) => (calls.push([exe, ...args]), { code: 0, output: '' }) });
  assert.deepEqual(calls, [['/usr/local/go/bin/go', 'clean', '-cache']]);
  assert.ok(result.ok);
});
test('junk cleanup: app junk, unused localizations, downloads, system rules', async () => {
  const root = home(), items = await run(root, { scope: 'general' });
  const rel = i => path.relative(root, i.path);
  const by = Object.fromEntries(items.map(i => [rel(i), i]));
  assert.deepEqual(items.map(rel).sort(), [
    '.Trash/old.zip',
    'Applications/Demo.app/Contents/Resources/fr.lproj',
    'Downloads/backup.tar.gz',
    'Downloads/setup.dmg',
    'Library/Application Support/CrashReporter/Demo & Co-ABC.plist',
    'Library/Caches/Google/Chrome/Default/Cache',
    'Library/Caches/com.example.demo',
    'Library/Logs/DiagnosticReports',
    'Library/Logs/SomeApp',
  ]);
  // App data is never junk; Base/en/zh, the system's es, the app's own de and its ja region stay; Only.app would lose everything.
  assert.deepEqual([by['Library/Caches/com.example.demo'].category, by['Library/Caches/com.example.demo'].app], ['appJunk', 'Demo & Co']);
  assert.equal(by['Library/Application Support/CrashReporter/Demo & Co-ABC.plist'].category, 'appJunk');
  assert.equal(by['Library/Logs/DiagnosticReports'].rule, 'system.logs');
  assert.deepEqual([by['Applications/Demo.app/Contents/Resources/fr.lproj'].language, by['Applications/Demo.app/Contents/Resources/fr.lproj'].risk], ['fr', 'review']);
  assert.deepEqual([by['Downloads/setup.dmg'].rule, by['Downloads/backup.tar.gz'].rule], ['downloads.installer', 'downloads.archive']);
  // Defaults tick safe and review rows, never localizations, downloads or the Trash.
  const ticked = new Set(defaultSelection(items, null).map(id => rel(items.find(i => i.id === id))));
  assert.deepEqual([...ticked].sort(), ['Library/Application Support/CrashReporter/Demo & Co-ABC.plist', 'Library/Caches/Google/Chrome/Default/Cache', 'Library/Caches/com.example.demo', 'Library/Logs/DiagnosticReports', 'Library/Logs/SomeApp']);
  assert.deepEqual(defaultSelection(items, ['language']).map(id => rel(items.find(i => i.id === id))), ['Applications/Demo.app/Contents/Resources/fr.lproj']);
  assert.deepEqual(subRows(GROUPS[1].rows[0], items).map(s => [s.key, s.items.length]), [['Demo & Co', 2]]);
  assert.equal(tick(['a', 'b'], new Set(['a'])), 'some');
});
test('every junk cleanup rule exists in the catalog', () => {
  const known = new Set([...PATH_RULES.map(r => r.id), 'app.junk', 'language.lproj', 'downloads.installer', 'downloads.archive']);
  for (const row of GROUPS.flatMap(g => g.rows)) for (const r of row.rules) assert.ok(known.has(r), r);
  // Every general-scope path rule is shown on the page.
  const shown = new Set(GROUPS.flatMap(g => g.rows.flatMap(r => r.rules)));
  for (const r of PATH_RULES.filter(r => scopeOf(r.category) === 'general')) assert.ok(shown.has(r.id), r.id);
});
test('cancelling stops the scan', async () => {
  const root = home();
  assert.deepEqual(await run(root, { cancelled: () => true }), []);
});
test('command sizes are not added to what a clean frees', () => {
  const path = { kind: 'path', bytes: 100 }, command = { kind: 'command', bytes: 100 };
  assert.equal(total([path, command]), 100);
});
test('sizes read naturally', () => {
  assert.equal(size(999), '999 B');
  assert.equal(size(1_500_000), '1.5 MB');
  assert.equal(size(23_000_000_000), '23 GB');
  assert.equal(size(21_524_000_000), '21.52 GB');
  assert.equal(size(840_940_000), '840.9 MB');
});
