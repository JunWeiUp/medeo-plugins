import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPoints, resize, move, hitHandle, windowAt, placeToolbar, round, intersect } from '../src/geometry.ts';
import { fileName, stamp, expandHome } from '../src/naming.ts';
import { normalize, DEFAULTS } from '../src/settings.ts';
import { valid, fromKey, symbols } from '../src/shortcuts.ts';
import { split, CHUNK, joinLines } from '../src/protocol.ts';
import { formatNumber, constrain } from '../src/annotations.ts';

const D = { x: 0, y: 0, w: 1000, h: 800 };

test('drag rectangle is normalized and clamped to the display', () => {
  assert.deepEqual(fromPoints({ x: 300, y: 200 }, { x: 100, y: 50 }, D), { x: 100, y: 50, w: 200, h: 150 });
  assert.deepEqual(fromPoints({ x: 900, y: 700 }, { x: 1200, y: 900 }, D), { x: 900, y: 700, w: 100, h: 100 });
});

test('shift square follows the longer side but stays on the display', () => {
  assert.deepEqual(fromPoints({ x: 100, y: 100 }, { x: 300, y: 150 }, D, true), { x: 100, y: 100, w: 200, h: 200 });
  assert.deepEqual(fromPoints({ x: 100, y: 100 }, { x: 0, y: 90 }, D, true), { x: 0, y: 0, w: 100, h: 100 });
  const r = fromPoints({ x: 900, y: 100 }, { x: 1000, y: 600 }, D, true);
  assert.equal(r.w, r.h); assert.ok(r.x + r.w <= 1000);
});

test('resize flips past the opposite edge, move stops at the edges', () => {
  const s = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepEqual(resize(s, 'e', { x: 50, y: 0 }, D), { x: 50, y: 100, w: 50, h: 100 });
  assert.deepEqual(resize(s, 'se', { x: 400, y: 300 }, D), { x: 100, y: 100, w: 300, h: 200 });
  assert.deepEqual(move(s, -500, 2000, D), { x: 0, y: 700, w: 100, h: 100 });
});

test('handles prefer corners', () => {
  const s = { x: 100, y: 100, w: 8, h: 8 };
  assert.equal(hitHandle(s, { x: 101, y: 101 }), 'nw');
  assert.equal(hitHandle({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 98 }), 's');
  assert.equal(hitHandle({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50 }), null);
});

test('front window wins, else the display', () => {
  const front = { x: 10, y: 10, w: 100, h: 100 }, back = { x: 0, y: 0, w: 500, h: 500 };
  assert.equal(windowAt([front, back], { x: 50, y: 50 }, D), front);
  assert.equal(windowAt([front, back], { x: 300, y: 300 }, D), back);
  assert.equal(windowAt([front, back], { x: 900, y: 700 }, D), D);
});

test('toolbar goes below, then above, then inside', () => {
  const size = { w: 400, h: 40 };
  assert.deepEqual(placeToolbar({ x: 500, y: 100, w: 300, h: 200 }, size, D), { x: 400, y: 308, above: false });
  assert.equal(placeToolbar({ x: 0, y: 500, w: 300, h: 290 }, size, D).above, true);
  const full = placeToolbar(D, size, D);
  assert.ok(full.y + 40 <= 800 && full.x >= 4);
});

test('round and intersect', () => {
  assert.deepEqual(round({ x: 1.4, y: 1.6, w: 10.2, h: 10.2 }), { x: 1, y: 2, w: 11, h: 10 });
  assert.equal(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }), null);
});

test('file names never overwrite', () => {
  const d = new Date(2026, 10, 9, 14, 5, 1);
  assert.equal(stamp(d), '20261109_140501');
  const taken = new Set(['Medeo_20261109_140501.png', 'Medeo_20261109_140501_1.png']);
  assert.equal(fileName('Medeo', d, n => taken.has(n)), 'Medeo_20261109_140501_2.png');
  assert.equal(expandHome('~/Pictures/x', '/Users/a', '/f'), '/Users/a/Pictures/x');
  assert.equal(expandHome('relative', '/Users/a', '/f'), '/f');
});

test('settings fall back to defaults and never bind one shortcut twice', () => {
  assert.deepEqual(normalize(null), DEFAULTS);
  assert.deepEqual(normalize({ shortcutArea: 'A', saveDir: 3, format: 'gif' }), DEFAULTS);
  assert.equal(normalize({ shortcutArea: null }).shortcutArea, null);
  assert.equal(normalize({ shortcutArea: 'Alt+A', shortcutQuick: 'alt+a' }).shortcutQuick, null);
  assert.equal(normalize({ shortcutOcr: 'Command+Shift+T' }).shortcutOcr, 'Command+Shift+T');
  assert.equal(normalize({ shortcutCapture: 'Alt+A' }).shortcutArea, 'Alt+A');
  assert.equal(normalize({ enterAction: 'save', format: 'jpeg', downscale: true }).format, 'jpeg');
});

test('number formats and shift constraint', () => {
  assert.deepEqual([1, 4, 9, 14, 2026].map(n => formatNumber(n, 'roman')), ['I', 'IV', 'IX', 'XIV', 'MMXXVI']);
  assert.deepEqual([1, 26, 27, 52].map(n => formatNumber(n, 'alpha')), ['A', 'Z', 'AA', 'AZ']);
  assert.equal(formatNumber(3, 'alphaLower'), 'c');
  const p = constrain({ x: 0, y: 0 }, { x: 100, y: 10 }, 'line');
  assert.ok(Math.abs(p.y) < 1e-9 && Math.abs(p.x - Math.hypot(100, 10)) < 1e-9);
  assert.deepEqual(constrain({ x: 0, y: 0 }, { x: 30, y: -50 }, 'rect'), { x: 50, y: -50 });
});

test('OCR lines come back in reading order', () => {
  const lines = [{ t: 'world', x: 0.5, y: 0.8, h: 0.1 }, { t: 'second', x: 0.1, y: 0.5, h: 0.1 }, { t: 'hello', x: 0.1, y: 0.81, h: 0.1 }];
  assert.equal(joinLines(lines), 'hello world\nsecond');
});

test('shortcuts', () => {
  assert.ok(valid('Alt+A')); assert.ok(valid('F1')); assert.ok(!valid('Shift+A')); assert.ok(!valid('A')); assert.ok(!valid('Alt+Shift'));
  assert.equal(fromKey({ code: 'KeyA', altKey: true, ctrlKey: false, shiftKey: true, metaKey: false }), 'Alt+Shift+A');
  assert.equal(fromKey({ code: 'AltLeft', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }), null);
  assert.equal(symbols('Shift+Alt+A'), '⌥⇧A');
});

test('chunks reassemble', () => {
  const s = 'x'.repeat(CHUNK * 2 + 5);
  assert.equal(split(s).length, 3); assert.equal(split(s).join(''), s); assert.deepEqual(split(''), ['']);
});
