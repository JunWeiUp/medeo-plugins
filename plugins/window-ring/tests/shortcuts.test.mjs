import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, duplicateOf, effective, fromKey, same, symbols, valid } from '../src/shortcuts.ts';

const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('recorded keys become Electron accelerators in a fixed modifier order', () => {
  assert.equal(fromKey(key('KeyR', { ctrlKey: true, altKey: true })), 'Control+Alt+R');
  assert.equal(fromKey(key('ArrowLeft', { metaKey: true, altKey: true, shiftKey: true })), 'Alt+Shift+Command+Left');
  assert.equal(fromKey(key('Digit3', { ctrlKey: true })), 'Control+3');
  assert.equal(fromKey(key('F12', { altKey: true })), 'Alt+F12');
  assert.equal(fromKey(key('BracketLeft', { ctrlKey: true })), 'Control+[');
  assert.equal(fromKey(key('ControlLeft', { ctrlKey: true })), null, 'a modifier alone is not finished yet');
});

test('a global shortcut needs ⌃, ⌥ or ⌘', () => {
  assert.ok(valid('Control+Alt+R'));
  assert.ok(valid('Command+Shift+K'));
  assert.ok(!valid('Shift+K'));
  assert.ok(!valid('K'));
  assert.ok(!valid('Control+Alt'));
  assert.ok(!valid('Control+Control+K'));
});

test('overrides: unknown ids, junk and values equal to the default are dropped', () => {
  assert.deepEqual(clean({ 'left-half': 'Control+Alt+H', nope: 'Control+X', 'right-half': 'Control+Alt+Right', undo: null, center: 'Shift+C', ring: 5 }),
    { 'left-half': 'Control+Alt+H', undo: null });
  assert.deepEqual(clean(null), {});
  const now = effective({ 'left-half': 'Control+Alt+H', undo: null });
  assert.equal(now['left-half'], 'Control+Alt+H');
  assert.equal(now.undo, null);
  assert.equal(now.ring, 'Control+Alt+R');
});

test('one key never does two things in the plugin', () => {
  const now = effective({});
  assert.equal(duplicateOf('left-half', 'Alt+Control+R', now), 'ring');
  assert.equal(duplicateOf('ring', 'Control+Alt+R', now), undefined, 'its own key is not a duplicate');
  assert.equal(duplicateOf('left-half', 'Control+Alt+H', now), undefined);
  assert.ok(same('Alt+Control+r', 'Control+Alt+R'));
});

test('shown with macOS symbols', () => {
  assert.deepEqual(symbols('Alt+Control+Left'), ['⌃', '⌥', '←']);
  assert.deepEqual(symbols('Command+Shift+Enter'), ['⇧', '⌘', '↩']);
});
