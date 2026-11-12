import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launcherItems } from '../src/launcher.ts';

const labels = { paste: 'Paste', copy: 'Copy', plain: 'Paste as plain text', star: 'Star', unstar: 'Unstar', remove: 'Delete', image: 'Image', files: 'Files', from: 'From', copied: 'Copied', note: 'Note', kind: 'Type', kinds: { text: 'Text', image: 'Image', files: 'Files', html: 'Rich text' } };
const now = 1_000_000_000;
const entries = [
  { id: '1', kind: 'text', hash: 'a', text: '\n  Invoice header: ACME\nTax id 123', size: 30, app: 'WeChat', bundle: null, createdAt: now - 60_000, copiedAt: now - 60_000, favorite: true, note: 'expenses' },
  { id: '2', kind: 'text', hash: 'b', text: 'https://example.com/invoice', size: 27, app: 'Safari', bundle: null, createdAt: now, copiedAt: now },
  { id: '3', kind: 'files', hash: 'c', text: '/Users/me/invoice.pdf', size: 1, files: ['/Users/me/invoice.pdf'], app: 'Finder', bundle: null, createdAt: now, copiedAt: now },
  { id: '4', kind: 'image', hash: 'd', text: '', size: 9, width: 1440, height: 900, app: null, bundle: null, createdAt: now, copiedAt: now },
];
const opts = { scoped: false, limit: 20, now, locale: 'en', blobs: '/data/blobs', labels };

test('matches become results that carry their data with its type', () => {
  const items = launcherItems(entries, 'invoice', opts);
  assert.deepEqual(items.map(i => [i.id, i.type, i.data]), [['1', 'text', entries[0].text], ['2', 'url', 'https://example.com/invoice'], ['3', 'file', '/Users/me/invoice.pdf']]);
  assert.equal(items[0].title, 'Invoice header: ACME');
  assert.match(items[0].subtitle, /^★ · WeChat · .+ · expenses$/);
  assert.deepEqual(items[0].actions.map(a => a.id), ['paste', 'copy', 'plain', 'star', 'delete']);
  assert.equal(items[0].actions[3].title, 'Unstar');
  assert.ok(items[0].detail.metadata.some(m => m.label === 'Note' && m.value === 'expenses'));
  assert.deepEqual(items[2].actions.map(a => a.id), ['paste', 'copy', 'star', 'delete']);
});
test('global searches need two characters; the scope lists recent ones; images point at their file', () => {
  assert.deepEqual(launcherItems(entries, 'i', opts), []);
  const scoped = launcherItems(entries, '', { ...opts, scoped: true, limit: 2 });
  assert.deepEqual(scoped.map(i => i.id), ['1', '2']);
  const [image] = launcherItems(entries.slice(3), '', { ...opts, scoped: true });
  assert.deepEqual([image.title, image.type, image.data], ['Image 1440×900', 'image', '/data/blobs/d.png']);
  assert.equal(image.detail.text, undefined);
});
