// Run: node --test plugins/launcher/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, formatNumber } from '../src/calc.ts';

test('arithmetic follows precedence and associativity', () => {
  assert.equal(calculate('1+2*3'), 7);
  assert.equal(calculate('(1+2)*3'), 9);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('-2^2'), -4);
  assert.equal(calculate('2^-1'), 0.5);
  assert.equal(calculate('10 % 4'), 2);
  assert.equal(calculate('7 / 2'), 3.5);
  assert.equal(calculate('2**10'), 1024);
  assert.equal(calculate('3 × 4 ÷ 2'), 6);
  assert.equal(calculate('5!'), 120);
  assert.equal(calculate('1,000 * 3'), 3000);
  assert.equal(calculate('1e3 + 1'), 1001);
  assert.equal(calculate('12*3='), 36);
});
test('functions, constants and implicit multiplication', () => {
  assert.equal(calculate('sqrt(16)'), 4);
  assert.equal(calculate('sqrt 16 + 1'), 5);
  assert.ok(Math.abs(calculate('2pi') - 2 * Math.PI) < 1e-12);
  assert.equal(calculate('3(4+1)'), 15);
  assert.equal(calculate('log(1000)'), 3);
  assert.equal(calculate('abs(-3)+round(2.5)'), 6);
});
test('anything that is not a calculation is null', () => {
  for (const text of ['', '42', '-5', 'safari', 'calc', '1+', '(1+2', '1/0', 'foo(2)', '1,2+3', 'alert(1)', '2 apples + 3', 'x'.repeat(300)])
    assert.equal(calculate(text), null, text);
});
test('results are printed without float noise', () => {
  assert.equal(formatNumber(calculate('0.1+0.2')), '0.3');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(2 ** 60), '1.1529215e18');
});
