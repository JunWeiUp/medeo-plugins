import test from 'node:test';
import assert from 'node:assert/strict';
import { busy, code, crumbs, drivePath, format, join, linkFor, matches, parent, size, sortEntries, unavailable, when } from '../src/logic.ts';

test('paths and breadcrumbs', () => {
  assert.equal(join('', 'a'), 'a');
  assert.equal(join('a/b', 'c'), 'a/b/c');
  assert.equal(parent('a/b/c'), 'a/b');
  assert.equal(parent('a'), '');
  assert.deepEqual(crumbs('a/b'), [{ name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]);
  assert.deepEqual(crumbs(''), []);
});

test('listing order, hidden entries and search', () => {
  const e = (name, kind = 'file') => ({ path: name, name, kind, size: 0, revision: '' });
  const sorted = sortEntries([e('b10.png'), e('.DS_Store'), e('B2.png'), e('docs', 'directory'), e('link', 'link'), e('a', 'directory')]);
  assert.deepEqual(sorted.map(x => x.name), ['a', 'docs', 'B2.png', 'b10.png']);
  assert.ok(matches(e('首页 v3.png'), '首页'));
  assert.ok(matches(e('Report.PDF'), 'report'));
  assert.ok(!matches(e('a.png'), 'zzz'));
});

test('sizes, speeds, times and messages', () => {
  assert.equal(size(512), '512 B');
  assert.equal(size(1536), '1.5 KB');
  assert.equal(size(820 * 1024 * 1024), '820 MB');
  const now = new Date(2026, 10, 16, 15, 0).getTime();
  assert.equal(when(new Date(2026, 10, 16, 9, 5).getTime(), now), '09:05');
  assert.equal(when(new Date(2026, 9, 3).getTime(), now), '10-3');
  assert.equal(when(new Date(2025, 0, 2).getTime(), now), '2025-1-2');
  assert.equal(when(null, now), '—');
  assert.equal(format('{n} items · {x}', { n: 3 }), '3 items · {x}');
});

test('roots link to the drive folder they live in', () => {
  const folders = [{ id: 'f1', name: '设计素材' }, { id: 'f2', name: '客户交付' }];
  assert.deepEqual(linkFor('/Users/me/Medeo/设计素材', folders), { folder: 'f1', prefix: '' });
  assert.deepEqual(linkFor('~/Medeo/客户交付/2026/合同', folders), { folder: 'f2', prefix: '2026/合同' });
  assert.equal(linkFor('/Users/me/Desktop', folders), null);
  assert.equal(drivePath({ prefix: '2026' }, 'a.pdf'), '2026/a.pdf');
  assert.equal(drivePath({ prefix: '' }, 'a.pdf'), 'a.pdf');
});

test('moving states, availability and error codes', () => {
  assert.ok(busy({ a: { state: 'uploading', progress: 0.4 } }));
  assert.ok(!busy({ a: { state: 'synced' }, b: { state: 'failed' } }));
  assert.equal(unavailable(new Error("Error invoking remote method 'platform:plugin': Error: drive_signed_out")), 'signed_out');
  assert.equal(unavailable(new Error('capability_unavailable')), 'unsupported');
  assert.equal(unavailable(new Error('native_tray_timeout')), 'unavailable');
  assert.equal(unavailable(new Error('file_exists')), null);
  assert.equal(code(new Error("Error invoking remote method 'platform:plugin': Error: file_exists")), 'file_exists');
});

import { arrange, badge, badgeText, freeName, kindOf, range, total } from '../src/logic.ts';
test('kinds and badges', () => {
  const f = (name, kind = 'file') => ({ name, kind });
  assert.equal(kindOf(f('a', 'directory')), 'folder');
  assert.equal(kindOf(f('首页 v3.PNG')), 'img');
  assert.equal(kindOf(f('clip.mov')), 'video');
  assert.equal(kindOf(f('x.pdf')), 'pdf');
  assert.equal(kindOf(f('README')), 'other');
  assert.equal(kindOf(f('.hidden')), 'other');
  assert.equal(badgeText(f('a.jpeg')), 'JPEG');
  assert.equal(badgeText(f('a.markdown')), 'MARK');
  assert.equal(badgeText(f('Makefile')), 'FILE');
  assert.deepEqual(badge({ state: 'uploading', progress: 0.62 }), { cls: 'up', glyph: '', progress: 62 });
  assert.equal(badge({ state: 'unknown' }), null);
  assert.equal(badge(undefined), null);
});
test('arranging, ranges, totals and free names', () => {
  const e = (name, size, modified_ms, kind = 'file') => ({ path: name, name, kind, size, revision: '', modified_ms });
  const list = [e('b.png', 30, 3), e('a.pdf', 10, 9), e('dir', 0, 1, 'directory'), e('c.mov', 20, 5)];
  assert.deepEqual(arrange(list).map(x => x.name), ['dir', 'a.pdf', 'b.png', 'c.mov']);
  assert.deepEqual(arrange(list, { key: 'size', desc: true }).map(x => x.name), ['dir', 'b.png', 'c.mov', 'a.pdf']);
  assert.deepEqual(arrange(list, { key: 'modified', desc: false }).map(x => x.name), ['dir', 'b.png', 'c.mov', 'a.pdf']);
  assert.deepEqual(range(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(range(['a', 'b'], null, 'b'), ['b']);
  assert.equal(total(list, ['a.pdf', 'b.png', 'dir']), 40);
  assert.equal(freeName('新建文件夹', ['新建文件夹', '新建文件夹 2']), '新建文件夹 3');
  assert.equal(freeName('x', []), 'x');
});

test('a sent item is stored under a safe name', async () => {
  const { nameFor, webloc } = await import('../src/logic.ts');
  assert.equal(nameFor({ type: 'image', value: '/x/y.png', file: { name: '截图 1.png' } }), '截图 1.png');
  assert.equal(nameFor({ type: 'text', value: '会议纪要：首页改版/三个方向\n第二行' }), '会议纪要：首页改版 三个方向 第二行.txt');
  assert.equal(nameFor({ type: 'text', value: 'x'.repeat(100) }).length, 44);
  assert.equal(nameFor({ type: 'url', value: 'https://medeo.app/home' }), 'medeo.app.webloc');
  assert.equal(nameFor({ type: 'url', value: 'https://a.b/', title: 'Medeo 首页' }), 'Medeo 首页.webloc');
  assert.equal(nameFor({ type: 'text', value: '   ' }), 'Text.txt');
  assert.match(webloc('https://a.b/?x=1&y=<2>'), /<string>https:\/\/a\.b\/\?x=1&amp;y=&lt;2>/);
});
