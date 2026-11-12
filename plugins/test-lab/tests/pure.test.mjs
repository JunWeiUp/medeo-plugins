import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accelerator, normalize, resample } from '../src/pure.ts';

const key = (code, key, mods = {}) => ({ code, key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
test('key presses become accelerators the Host accepts', () => {
  assert.equal(accelerator(key('KeyK', 'k', { metaKey: true, shiftKey: true })), 'Command+Shift+K');
  assert.equal(accelerator(key('Digit5', '%', { altKey: true, shiftKey: true })), 'Alt+Shift+5');
  assert.equal(accelerator(key('Space', ' ', { ctrlKey: true })), 'Control+Space');
  assert.equal(accelerator(key('ArrowUp', 'ArrowUp', { metaKey: true })), 'Command+Up');
  assert.equal(accelerator(key('F10', 'F10')), 'F10');
  // Modifiers alone, a bare letter and punctuation (outside [A-Za-z0-9+_-]) are not shortcuts.
  assert.equal(accelerator(key('MetaLeft', 'Meta', { metaKey: true })), undefined);
  assert.equal(accelerator(key('KeyA', 'a')), undefined);
  assert.equal(accelerator(key('Comma', ',', { metaKey: true })), undefined);
  for (const a of ['Command+Shift+K', 'Control+Space', 'Command+Up']) assert.match(a, /^[A-Za-z0-9+_-]+$/);
});

test('waveforms keep their peaks at any width and quiet takes stay quiet', () => {
  const peaks = Array.from({ length: 240 }, (_, i) => (i === 100 ? 0.8 : 0.1));
  const narrow = resample(peaks, 24);
  assert.equal(narrow.length, 24);
  assert.equal(Math.max(...narrow), 0.8);
  assert.deepEqual(resample([0.2, 0.4], 4), [0.2, 0.2, 0.4, 0.4]);
  assert.deepEqual(resample([], 10), []);
  assert.deepEqual(normalize([0.2, 0.4]), [0.5, 1]);
  assert.ok(Math.max(...normalize([0.001, 0.002])) < 0.05);
});
