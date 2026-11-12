// Preferences: defaults for bad values, shortcut capture and labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorOf, DEFAULTS, limitsOf, normalize, shortcutLabel, validShortcut } from '../src/settings.ts';

test('bad or missing values fall back to the defaults', () => {
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(normalize({ shortcut: 'C', maxItems: 7, retentionDays: 2, autoPaste: 'yes' }), DEFAULTS);
  assert.deepEqual(normalize({ shortcut: '', maxItems: 5000, retentionDays: 0, autoPaste: false, paused: true }),
    { shortcut: '', maxItems: 5000, retentionDays: 0, autoPaste: false, paused: true });
  assert.equal(limitsOf(normalize({ retentionDays: 0 })).maxAgeMs, Infinity);
});

test('shortcuts need a modifier and a real key', () => {
  const key = (code, mods = {}) => acceleratorOf({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, code, ...mods });
  assert.equal(key('KeyC', { altKey: true }), 'Alt+C');
  assert.equal(key('KeyV', { metaKey: true, shiftKey: true }), 'Command+Shift+V');
  assert.equal(key('Digit1', { ctrlKey: true }), 'Control+1');
  assert.equal(key('F5', { altKey: true }), 'Alt+F5');
  assert.equal(key('KeyC'), null);
  assert.equal(key('AltLeft', { altKey: true }), null);
  assert.ok(validShortcut('Alt+C') && validShortcut('') && !validShortcut('Alt+ç'));
  assert.equal(shortcutLabel('Command+Shift+V'), '⇧⌘V');
  assert.equal(shortcutLabel('Alt+C'), '⌥C');
});
