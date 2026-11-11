// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf, birthYearFor, schoolYearStart } from '../web/grade.js';

const at = s => new Date(s + 'T12:00:00');

test('född 2015 går i årskurs 5 hösten 2026 (planens exempel)', () => {
  assert.equal(gradeOf({ birthYear: 2015 }, at('2026-11-11')), 5);
});

test('läsåret byts 1 juli', () => {
  assert.equal(schoolYearStart(at('2027-06-30')), 2026);
  assert.equal(schoolYearStart(at('2027-07-01')), 2027);
  assert.equal(gradeOf({ birthYear: 2015 }, at('2027-07-01')), 6);
});

test('gradeOffset och gränser', () => {
  assert.equal(gradeOf({ birthYear: 2015, gradeOffset: -1 }, at('2026-11-11')), 4);
  assert.equal(gradeOf({ birthYear: 2030 }, at('2026-11-11')), 0);
  assert.equal(gradeOf({ birthYear: 2000 }, at('2026-11-11')), 9);
});

test('gamla profiler utan födelseår använder grade', () => {
  assert.equal(gradeOf({ grade: 3 }), 3);
  assert.equal(gradeOf({}), 5);
});

test('migrering: födelseår ur årskurs ger samma årskurs tillbaka', () => {
  for (const g of [1, 4, 9]) assert.equal(gradeOf({ birthYear: birthYearFor(g, at('2026-11-11')) }, at('2026-11-11')), g);
});
