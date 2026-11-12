// Disk analysis against a synthetic folder; no real user data is read.
// Run: node --test plugins/mac-cleaner/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALWAYS_KEPT, analyze, FOLD_BYTES, graft, KEEP_BYTES, locate, MAX_CHILDREN, prune, restricted, trim } from '../src/analyze.ts';
import { crumbs, squarify, view } from '../src/disk.ts';

function home() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mac-cleaner-disk-')));
  const file = (rel, bytes = 5000) => { const p = path.join(root, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, Buffer.alloc(bytes, 1)); return p; };
  return { root, file };
}
const opts = (root, extra = {}) => ({ root, home: root, includeProtected: false, cancelled: () => false, ...extra });
const find = (node, name) => node.children.find(c => c.name === name);

test('folders add up their files, largest first; links and hard links count once', async () => {
  const { root, file } = home();
  const big = file('Movies/clip.mov', FOLD_BYTES * 2);
  file('Movies/b.txt', 10);
  file('Documents/a.txt', 4000);
  linkSync(big, path.join(root, 'Movies/clip-link.mov'));
  symlinkSync(path.join(root, 'Movies'), path.join(root, 'link-to-movies'));
  const tree = await analyze(opts(root));
  assert.equal(tree.kind, 'directory');
  assert.deepEqual(tree.children.map(c => c.name).slice(0, 1), ['Movies']);
  const movies = find(tree, 'Movies');
  assert.ok(movies.bytes >= FOLD_BYTES * 2 && movies.bytes < FOLD_BYTES * 3, 'the hard link adds nothing');
  assert.equal(movies.files, 3);
  assert.equal(tree.files, 5);
  // The symlink is an entry of its own size, never followed.
  assert.ok(find(tree, 'link-to-movies').bytes < 4096 * 2);
});

test('small folders are folded and opened by walking them again', async () => {
  const { root, file } = home();
  file('big/huge.bin', FOLD_BYTES * 2);
  file('small/inner/a.txt', 100);
  const tree = await analyze(opts(root));
  const small = find(tree, 'small');
  assert.equal(small.children, undefined);
  assert.equal(view(tree).entries.find(e => e.name === 'small').folded, true);
  assert.ok(find(tree, 'big').children, 'a big folder keeps its entries');
  // Opening it: a fresh walk of that folder, grafted in place.
  file('small/inner/b.txt', 100);
  const fresh = await analyze(opts(path.join(root, 'small')));
  const before = tree.bytes;
  assert.ok(graft(tree, fresh));
  assert.ok(find(tree, 'small').children.length);
  assert.equal(tree.bytes - before, fresh.bytes - small.bytes);
  assert.equal(find(tree, 'small').files, 2);
});

test('protected locations are listed but not read unless asked', async () => {
  const { root, file } = home();
  file('Library/Containers/com.example.app/Data/x', 9000);
  file('Library/Mail/V10/mail.db', 9000);
  file('Pictures/Photos Library.photoslibrary/database/x', 9000);
  file('Library/Caches/com.apple.Safari/c', 9000);
  file('Library/Developer/CoreSimulator/Devices/D/com.apple.x/c', 9000);
  const tree = await analyze(opts(root));
  const lib = find(tree, 'Library');
  for (const name of ['Containers', 'Mail']) {
    const n = lib.children ? find(lib, name) : null;
    if (n) { assert.equal(n.kind, 'restricted'); assert.equal(n.bytes, 0); }
  }
  assert.ok(restricted(path.join(root, 'Library/Containers'), root));
  assert.ok(restricted(path.join(root, 'Library/Caches/com.apple.Safari'), root));
  assert.ok(!restricted(path.join(root, 'Library/Developer/CoreSimulator/Devices/D/com.apple.x'), root));
  assert.ok(restricted('/Volumes/x/Photos Library.photoslibrary', root));
  assert.ok(!restricted('/Applications/Xcode.app', root));
  const all = await analyze(opts(root, { includeProtected: true }));
  assert.ok(all.bytes > tree.bytes);
  assert.equal(all.files, 5);
  assert.equal(tree.files, 1, 'only the simulator file is read');
});

test('a stopped walk returns quickly; a missing root is null', async () => {
  const { root, file } = home();
  for (let i = 0; i < 30; i++) file(`d${i}/x/y/z.txt`, 10);
  let n = 0;
  const tree = await analyze(opts(root, { cancelled: () => ++n > 3 }));
  assert.ok(tree.files < 30);
  assert.equal(await analyze(opts(path.join(root, 'nope'))), null);
  const single = await analyze(opts(file('one.bin', 8192)));
  assert.equal(single.kind, 'file');
});

test('progress reports running totals', async () => {
  const { root, file } = home();
  file('a/1', 100); file('b/2', 100);
  const seen = [];
  await analyze(opts(root, { progress: (files, bytes, folder) => seen.push({ files, bytes, folder }) }));
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1).files, 2);
});

test('many entries fold into one "smaller items" entry', () => {
  const file = (i, bytes) => ({ name: `f${i}`, path: `/r/f${i}`, kind: 'file', bytes, files: 1, modified: 0 });
  // Big entries: up to MAX_CHILDREN kept.
  const big = Array.from({ length: MAX_CHILDREN + 50 }, (_, i) => file(i, KEEP_BYTES + i));
  const kept = trim(big, '/r');
  assert.equal(kept.length, MAX_CHILDREN);
  const other = kept.find(c => c.kind === 'other');
  assert.equal(other.count, 51);
  assert.equal(kept.reduce((n, c) => n + c.bytes, 0), big.reduce((n, c) => n + c.bytes, 0));
  assert.ok(kept.every((c, i) => !i || kept[i - 1].bytes >= c.bytes), 'largest first');
  // Small entries: only the largest ALWAYS_KEPT stay; a protected folder always stays.
  const small = Array.from({ length: 100 }, (_, i) => file(i, 1000 + i)).concat([{ name: 'Mail', path: '/r/Mail', kind: 'restricted', bytes: 0, files: 0, modified: 0 }]);
  const few = trim(small, '/r');
  assert.equal(few.length, ALWAYS_KEPT + 2);
  assert.ok(few.some(c => c.kind === 'restricted'));
  assert.equal(few.find(c => c.kind === 'other').count, 100 - ALWAYS_KEPT);
  // Trimming again (files first, then with the subfolders) keeps a single "other".
  const again = trim([...few, file('x', 5)], '/r');
  assert.equal(again.filter(c => c.kind === 'other').length, 1);
  assert.equal(again.find(c => c.kind === 'other').count, 100 - ALWAYS_KEPT + 1);
});

test('locate and prune keep totals right', () => {
  const leaf = { name: 'x', path: '/r/a/x', kind: 'file', bytes: 30, files: 1, modified: 0 };
  const a = { name: 'a', path: '/r/a', kind: 'directory', bytes: 50, files: 2, modified: 0, children: [leaf, { name: 'y', path: '/r/a/y', kind: 'file', bytes: 20, files: 1, modified: 0 }] };
  const ab = { name: 'ab', path: '/r/ab', kind: 'file', bytes: 5, files: 1, modified: 0 };
  const tree = { name: 'r', path: '/r', kind: 'directory', bytes: 55, files: 3, modified: 0, children: [a, ab] };
  assert.deepEqual(locate(tree, '/r/a/x').map(n => n.name), ['r', 'a', 'x']);
  assert.deepEqual(locate(tree, '/r/ab').map(n => n.name), ['r', 'ab'], '"/r/a" is not a prefix of "/r/ab"');
  assert.equal(locate(tree, '/elsewhere'), null);
  assert.equal(prune(tree, '/r/a/x'), leaf);
  assert.equal(a.bytes, 20); assert.equal(tree.bytes, 25); assert.equal(tree.files, 2);
  assert.equal(prune(tree, '/r'), null, 'the root itself is never removed');
});

test('treemap fills the box without overlaps', () => {
  const box = { x: 0, y: 0, w: 400, h: 300 }, sizes = [500, 300, 120, 50, 20, 10, 0];
  const rects = squarify(sizes, box);
  assert.equal(rects.length, sizes.length);
  const area = rects.reduce((n, r) => n + r.w * r.h, 0);
  assert.ok(Math.abs(area - 400 * 300) < 1e-6);
  for (const [i, r] of rects.entries()) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 400 + 1e-6 && r.y + r.h <= 300 + 1e-6);
    if (sizes[i]) assert.ok(Math.abs(r.w * r.h - sizes[i] * 400 * 300 / 1000) < 1e-6);
    for (const q of rects.slice(i + 1)) {
      const overlap = Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x)) * Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y));
      assert.ok(overlap < 1e-6);
    }
  }
  assert.deepEqual(squarify([], box), []);
  assert.equal(squarify([0, 0], box)[0].w, 0);
});

test('breadcrumbs from the root down', () => {
  assert.deepEqual(crumbs('/Users/me', '/Users/me/Library/Caches').map(c => c.name), ['me', 'Library', 'Caches']);
  assert.deepEqual(crumbs('/', '/Applications/Xcode.app').map(c => c.path), ['/', '/Applications', '/Applications/Xcode.app']);
  assert.deepEqual(crumbs('/Users/me', '/Users/meow').length, 1);
});

test('the tree is live while the walk runs', async () => {
  const { root, file } = home();
  for (let i = 0; i < 20; i++) file(`d${i}/sub/x.bin`, 200_000);
  let growing = null;
  const seen = [];
  const done = await analyze(opts(root, { live: t => { growing = t; }, progress: () => {
    // Mid-walk: the root is pending, has its folders, and its total only grows.
    seen.push({ bytes: growing.bytes, pending: !!growing.pending, folders: growing.children.filter(c => c.kind === 'directory').length, view: view(growing) });
  } }));
  assert.equal(done, growing, 'the live tree is the result');
  assert.ok(seen.length > 2 && seen.every(s => s.pending));
  assert.ok(seen.every((s, i) => !i || s.bytes >= seen[i - 1].bytes));
  assert.equal(seen.at(-1).folders, 20);
  assert.ok(seen.some(s => s.view.entries.some(e => e.pending)), 'folders being counted are marked');
  assert.ok(!done.pending && !JSON.stringify(view(done)).includes('"pending":true'));
  assert.equal(done.files, 20);
});
