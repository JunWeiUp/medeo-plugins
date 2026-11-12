import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/units.ts';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('converts within a category with several spellings', () => {
  near(convert('10 km to mi').result, 6.2137119224);
  near(convert('1 mile in meters').result, 1609.344);
  near(convert('12in to cm').result, 30.48);
  near(convert('1.5gb to mb').result, 1500);
  near(convert('1 GiB to MB').result, 1073.741824);
  near(convert('3h to min').result, 180);
  near(convert('2 lb = kg').result, 0.90718474);
  near(convert('100 km/h to mph').result, 62.1371192237);
  near(convert('1 acre to m2').result, 4046.8564224);
  near(convert('5 公斤 换成 斤').result, 10);
  assert.equal(convert('10 km to mi').to, 'mi');
});
test('temperatures convert through kelvin', () => {
  near(convert('100f in c').result, 37.7777777778);
  near(convert('0 °C to °F').result, 32);
  near(convert('-40 c to f').result, -40);
  near(convert('0 k to c').result, -273.15);
});
test('mismatched or unknown units are not conversions', () => {
  for (const text of ['10 km to kg', '10 parsec to m', 'km to mi', '10 km', 'to mi', 'hello to world'])
    assert.equal(convert(text), null, text);
});
