// The history rules, with no Node or platform involved.
// Run: node --test plugins/clipboard/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotate, counts, htmlText, matchesQuery, preview, prune, search, upsert } from '../src/history.ts';

const entry = (id, kind, text, copiedAt, extra = {}) => ({ id, kind, hash: `${kind}:${text}`, text, size: text.length, app: 'Notes', bundle: null, createdAt: copiedAt, copiedAt, ...extra });

test('a repeated copy moves to the top and keeps its id', () => {
  let list = [entry('a', 'text', 'one', 1), entry('b', 'text', 'two', 2)];
  const again = upsert(list, entry('c', 'text', 'one', 9));
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.entries.map(e => [e.id, e.copiedAt]), [['a', 9], ['b', 2]]);
  const fresh = upsert(again.entries, entry('d', 'text', 'three', 10));
  assert.equal(fresh.duplicate, false);
  assert.deepEqual(fresh.entries.map(e => e.id), ['d', 'a', 'b']);
});

test('pruning keeps the newest within the count and age limits', () => {
  const list = [entry('old', 'text', 'x', 0), entry('a', 'text', 'a', 90), entry('b', 'text', 'b', 95), entry('c', 'text', 'c', 99)];
  const { kept, removed } = prune(list, 100, { maxItems: 2, maxAgeMs: 50 });
  assert.deepEqual(kept.map(e => e.id), ['c', 'b']);
  assert.deepEqual(removed.map(e => e.id).sort(), ['a', 'old']);
});

test('search needs every word, ignores case and also matches the app', () => {
  const e = entry('a', 'text', 'Hello Medeo World', 1);
  assert.ok(matchesQuery(e, 'medeo hello'));
  assert.ok(matchesQuery(e, 'notes'));
  assert.ok(!matchesQuery(e, 'hello mars'));
  assert.ok(matchesQuery(e, '   '));
});

test('categories group HTML and RTF as rich text', () => {
  const list = [entry('t', 'text', 'a', 1), entry('h', 'html', 'b', 2), entry('r', 'rtf', 'c', 3), entry('i', 'image', '', 4), entry('f', 'files', '/tmp/a.txt', 5, { files: ['/tmp/a.txt'] })];
  assert.deepEqual(counts(list), { all: 5, text: 1, rich: 2, image: 1, files: 1, favorite: 0 });
  assert.deepEqual(search(list, '', 'rich').map(e => e.id), ['h', 'r']);
  assert.deepEqual(search(list, 'a.txt', 'all').map(e => e.id), ['f']);
});

test('previews fold blank lines and cut long text', () => {
  assert.equal(preview('a\n\n\n  b\t\tc'), 'a\nb c');
  assert.equal(preview('x'.repeat(300), 10), `${'x'.repeat(10)}…`);
  assert.equal(htmlText('<p>Hi&nbsp;<b>there</b></p><script>x()</script>'), 'Hi there\n ');
});

test('starred entries are never pruned and do not use up the count', () => {
  const list = [entry('fav', 'text', 'f', 0, { favorite: true }), entry('a', 'text', 'a', 98), entry('b', 'text', 'b', 99)];
  const { kept, removed } = prune(list, 100, { maxItems: 1, maxAgeMs: 50 });
  assert.deepEqual(kept.map(e => e.id), ['b', 'fav']);
  assert.deepEqual(removed.map(e => e.id), ['a']);
});

test('stars and notes: set, cleared, searchable, own category', () => {
  let list = [entry('a', 'text', 'alpha', 1), entry('b', 'text', 'beta', 2)];
  list = annotate(list, 'a', { favorite: true, note: '  invoice number  ' });
  assert.equal(list[0].favorite, true); assert.equal(list[0].note, 'invoice number');
  assert.deepEqual(search(list, 'invoice', 'all').map(e => e.id), ['a']);
  assert.deepEqual(search(list, '', 'favorite').map(e => e.id), ['a']);
  assert.equal(counts(list).favorite, 1);
  list = annotate(list, 'a', { favorite: false, note: '' });
  assert.ok(!('favorite' in list[0]) && !('note' in list[0]));
  assert.equal(annotate(list, 'missing', { favorite: true }), null);
  assert.equal(annotate(list, 'b', { note: 'x'.repeat(900) })[1].note.length, 500);
});
