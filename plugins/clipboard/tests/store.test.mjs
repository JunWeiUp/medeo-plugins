// The on-disk history in a temporary storagePath: ingest, dedupe, copy back, delete, reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const fresh = () => { let now = 1000; const store = new Store(mkdtempSync(path.join(tmpdir(), 'clipboard-')), () => now++); return store; };

test('text, HTML and files become entries; a repeat is one entry', async () => {
  const store = fresh(); await store.load();
  const a = await store.ingest({ text: 'hello', app: 'Notes', bundle: 'com.apple.Notes' });
  assert.equal(a.entry.kind, 'text'); assert.equal(a.entry.size, 5);
  const h = await store.ingest({ text: 'bold', html: '<b>bold</b>' });
  assert.equal(h.entry.kind, 'html');
  assert.deepEqual(await store.body(h.entry), { text: 'bold', html: '<b>bold</b>', rtf: null });
  const f = await store.ingest({ files: ['/etc/hosts', '/tmp'], text: 'hosts' });
  assert.equal(f.entry.kind, 'files'); assert.equal(f.entry.size, 2);
  assert.deepEqual(await store.body(f.entry), { files: ['/etc/hosts', '/tmp'] });
  const again = await store.ingest({ text: 'hello' });
  assert.equal(again.duplicate, true); assert.equal(again.entry.id, a.entry.id);
  assert.deepEqual(store.entries.map(e => e.kind), ['text', 'files', 'html']);
  assert.equal(await store.ingest({ skipped: 'concealed' }), null);
  assert.equal(await store.ingest({ text: '   ' }), null);
});

test('an image is kept by content hash with a thumbnail, and swept on delete', async () => {
  const store = fresh(); await store.load();
  const incoming = path.join(store.incoming, 'incoming-1.png'); writeFileSync(incoming, PNG);
  const { entry } = await store.ingest({ image: incoming });
  assert.equal(entry.kind, 'image'); assert.equal(entry.width, 2); assert.equal(entry.height, 2);
  assert.ok(existsSync(path.join(store.blobs, `${entry.hash}.png`)));
  assert.match(await store.thumbnail(entry), /^data:image\/jpeg;base64,/);
  await store.remove([entry.id]);
  assert.deepEqual(readdirSync(store.blobs), []);
});

test('the history survives a restart', async () => {
  const store = new Store(mkdtempSync(path.join(tmpdir(), 'clipboard-'))); await store.load();
  await store.ingest({ text: 'keep me' }); await store.flush();
  const again = new Store(store.dir); await again.load();
  assert.deepEqual(again.entries.map(e => e.text), ['keep me']);
  await again.remove('all'); await again.flush();
  const empty = new Store(store.dir); await empty.load();
  assert.equal(empty.entries.length, 0);
});
