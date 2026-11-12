// Layout geometry, cycles, displays and the ring, with no platform involved.
// Run: node --test plugins/window-ring/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, History, frameFor, nextInCycle, nextScreen, onNextDisplay, ringAction, screenAt, screenOf } from '../src/layout.ts';

const area = { x: 0, y: 25, width: 1440, height: 875 };
const win = { x: 100, y: 100, width: 800, height: 600 };
// The layout measured by the host on a real three-display desk (see the helper smoke test).
const screens = [
  { id: '1', frame: { x: 0, y: 0, width: 1512, height: 982 }, visible_frame: { x: 0, y: 33, width: 1512, height: 949 } },
  { id: '3', frame: { x: -2560, y: -99, width: 2560, height: 1440 }, visible_frame: { x: -2560, y: -69, width: 2560, height: 1410 } },
  { id: '5', frame: { x: 1512, y: 0, width: 1920, height: 1080 }, visible_frame: { x: 1512, y: 30, width: 1920, height: 1050 } },
];

test('halves, quarters and thirds tile the area exactly', () => {
  assert.deepEqual(frameFor('left-half', area, win), { x: 0, y: 25, width: 720, height: 875 });
  assert.deepEqual(frameFor('right-half', area, win), { x: 720, y: 25, width: 720, height: 875 });
  assert.deepEqual(frameFor('bottom-right', area, win), { x: 720, y: 463, width: 720, height: 438 });
  assert.deepEqual(frameFor('center-third', area, win), { x: 480, y: 25, width: 480, height: 875 });
  assert.deepEqual(frameFor('right-two-thirds', area, win), { x: 480, y: 25, width: 960, height: 875 });
  assert.deepEqual(frameFor('maximize', area, win), area);
});

test('a gap is kept around the edges and once between neighbours', () => {
  const left = frameFor('left-half', area, win, 10), right = frameFor('right-half', area, win, 10);
  assert.equal(left.x, 10);
  assert.equal(right.x - (left.x + left.width), 10);
  assert.equal(right.x + right.width, area.width - 10);
  assert.equal(left.y, area.y + 10);
});

test('center keeps the size, shrinking only what does not fit', () => {
  assert.deepEqual(frameFor('center', area, win), { x: 320, y: 163, width: 800, height: 600 });
  assert.deepEqual(frameFor('center', area, { ...win, width: 3000 }), { x: 0, y: 163, width: 1440, height: 600 });
});

test('non-geometric actions have no frame', () => {
  assert.equal(frameFor('undo', area, win), null);
  assert.equal(frameFor('next-display', area, win), null);
  for (const a of ACTIONS.filter(a => a !== 'undo' && a !== 'next-display')) assert.ok(frameFor(a, area, win), a);
});

test('pressing again steps through the cycle only while the window stays put', () => {
  const half = frameFor('left-half', area, win);
  assert.equal(nextInCycle('left-half', undefined, win), 'left-half');
  assert.equal(nextInCycle('left-half', { action: 'left-half', frame: half }, half), 'left-two-thirds');
  assert.equal(nextInCycle('left-half', { action: 'left-third', frame: half }, half), 'left-half');
  // Apps that round their size by a few points still count as "where we put it".
  assert.equal(nextInCycle('left-half', { action: 'left-half', frame: half }, { ...half, height: half.height - 6 }), 'left-two-thirds');
  assert.equal(nextInCycle('left-half', { action: 'left-half', frame: half }, win), 'left-half');
  assert.equal(nextInCycle('left-half', { action: 'left-half', frame: half }, half, false), 'left-half');
  assert.equal(nextInCycle('top-half', { action: 'top-half', frame: half }, half), 'top-half');
});

test('the ring maps eight directions, and the centre maximizes', () => {
  assert.equal(ringAction(0, 0), 'maximize');
  assert.equal(ringAction(10, 5), 'maximize');
  assert.equal(ringAction(100, 0), 'right-half');
  assert.equal(ringAction(0, -100), 'top-half');
  assert.equal(ringAction(0, 100), 'bottom-half');
  assert.equal(ringAction(-100, 0), 'left-half');
  assert.equal(ringAction(80, -80), 'top-right');
  assert.equal(ringAction(-80, 80), 'bottom-left');
  assert.equal(ringAction(100, -40), 'right-half'); // 22° above the axis is still "right"
  assert.equal(ringAction(100, -45), 'top-right');
});

test('displays are found by overlap and by point, negative coordinates included', () => {
  assert.equal(screenOf({ x: -2000, y: 100, width: 800, height: 600 }, screens).id, '3');
  assert.equal(screenOf({ x: 1400, y: 100, width: 800, height: 600 }, screens).id, '5');
  assert.equal(screenAt(-10, 500, screens).id, '3');
  assert.equal(screenAt(5000, 500, screens).id, '5');
});

test('next display keeps the relative place and wraps around left to right', () => {
  const half = frameFor('left-half', screens[0].visible_frame, win);
  const moved = onNextDisplay(half, screens);
  assert.deepEqual(moved, { x: 1512, y: 30, width: 960, height: 1050 });
  assert.equal(screenOf(onNextDisplay(moved, screens), screens).id, '3');
  assert.equal(onNextDisplay(win, [screens[0]]), null);
});

test('undo history is per window and bounded', () => {
  const h = new History(2, 2);
  h.push('a', { ...win, x: 1 }); h.push('a', { ...win, x: 2 }); h.push('a', { ...win, x: 3 });
  assert.equal(h.pop('a').x, 3);
  assert.equal(h.pop('a').x, 2);
  assert.equal(h.pop('a'), undefined);
  h.push('b', win); h.push('c', win); h.push('d', win);
  assert.equal(h.pop('b'), undefined);
  assert.ok(h.pop('d'));
});

test('the next display goes left to right and wraps', () => {
  assert.equal(nextScreen(screens[0].frame, screens).id, '5');
  assert.equal(nextScreen(screens[2].frame, screens).id, '3');
  assert.equal(nextScreen(screens[1].frame, screens).id, '1');
  assert.equal(nextScreen(win, [screens[0]]), undefined);
});
