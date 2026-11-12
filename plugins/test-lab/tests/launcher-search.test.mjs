import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recent, search } from '../src/launcher-search.ts';

const app = (title, bundle = 'com.example.' + title.toLowerCase()) => ({ id: title, title, path: `/Applications/${title}.app`, bundle_id: bundle });
test('exact, prefix, substring and word matches rank in order; recent wins ties', () => {
  const entries = [app('Notes'), app('Notesmith'), app('Sticky Notes'), app('Calendar', 'com.apple.iCal'), app('Mail')];
  assert.deepEqual(search(entries, 'notes', new Map()).map(e => e.title), ['Notes', 'Notesmith', 'Sticky Notes']);
  assert.deepEqual(search(entries, 'apple ical', new Map()).map(e => e.title), ['Calendar']);
  const recent = new Recent();
  recent.used('/Applications/Mail.app');
  assert.equal(search(entries, '', recent.order)[0].title, 'Mail');
  assert.deepEqual(search(entries, 'zzz', recent.order), []);
});
