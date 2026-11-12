import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const json = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

test('Test Lab declares every sandbox permission in its permission cases', async () => {
  const [manifest, cases] = await Promise.all([json('../manifest.json'), json('../cases.json')]);
  assert.deepEqual(manifest.permissions, cases.filter(c => c.permission !== 'node').map(c => c.grant));
});

test('every catalog has the same keys as the default one', async () => {
  const manifest = await json('../manifest.json');
  const base = Object.keys(await json('../' + manifest.localization.catalogs[manifest.localization.default_locale])).sort();
  for (const path of Object.values(manifest.localization.catalogs)) assert.deepEqual(Object.keys(await json('../' + path)).sort(), base, path);
});
