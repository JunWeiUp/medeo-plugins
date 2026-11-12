import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Usage, initials, rank, score } from '../src/search.ts';
import { answer, appEntries as appItems } from '../src/results.ts';

const apps = appItems([
  { id: '1', title: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', bundle_id: 'com.microsoft.VSCode' },
  { id: '2', title: 'Safari', path: '/Applications/Safari.app', bundle_id: 'com.apple.Safari' },
  { id: '3', title: 'System Settings', path: '/System/Applications/System Settings.app', bundle_id: 'com.apple.systempreferences' },
  { id: '4', title: 'Calculator', path: '/System/Applications/Calculator.app', bundle_id: 'com.apple.calculator' },
  { id: '5', title: 'Calendar', path: '/System/Applications/Calendar.app', bundle_id: 'com.apple.iCal' },
  { id: '6', title: 'FaceTime', path: '/System/Applications/FaceTime.app', bundle_id: 'com.apple.FaceTime' },
]);
const titles = list => list.map(i => i.title);

test('prefix beats word prefix beats initials beats substring beats fuzzy', () => {
  const s = q => score({ key: 'k', title: 'Visual Studio Code' }, q);
  assert.ok(s('visual') > s('studio') && s('studio') > s('vsc') && s('vsc') > s('dio') && s('dio') > s('vsde'));
  assert.equal(score({ key: 'k', title: 'Safari' }, 'xyz'), 0);
  assert.equal(initials('FaceTime'), 'ft');
});
test('ranks apps, with use breaking ties', () => {
  const usage = new Usage();
  // The closer (shorter) completion first, until the other is the one you use.
  assert.deepEqual(titles(rank(apps, 'cal', usage)), ['Calendar', 'Calculator']);
  usage.used('app:com.apple.calculator'); usage.used('app:com.apple.calculator');
  assert.deepEqual(titles(rank(apps, 'cal', usage)), ['Calculator', 'Calendar']);
  // Use never lifts a weak match over a strong one.
  for (let i = 0; i < 50; i++) usage.used('app:com.apple.Safari');
  assert.equal(rank(apps, 'sys', usage)[0].title, 'System Settings');
  assert.equal(rank(apps, 'vsc', usage)[0].title, 'Visual Studio Code');
  assert.equal(rank(apps, 'com.apple.safari', usage)[0].title, 'Safari');
});
test('usage decays and stays bounded', () => {
  let now = 0;
  const usage = new Usage({}, () => now);
  usage.used('a');
  const fresh = usage.boost('a');
  now += 60 * 86_400_000;
  assert.ok(usage.boost('a') < fresh / 4);
  for (let i = 0; i < 600; i++) { now++; usage.used(`k${i}`); }
  assert.equal(Object.keys(usage.entries).length, 500);
  assert.equal(usage.recent(1)[0], 'k599');
});
test('a calculation or conversion copies the plain value', () => {
  const labels = { calc: 'Calculator', convert: 'Conversion' };
  assert.equal(answer('12*3', labels).title, '36');
  assert.equal(answer('1234.5*1000', labels, 'en').title, '1,234,500');
  assert.equal(answer('1234.5*1000', labels, 'en').copy, '1234500');
  assert.equal(answer('10 km to mi', labels).title, '6.21371192237 mi');
  assert.equal(answer('safari', labels), null);
});
