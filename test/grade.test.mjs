// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf, birthYearFor, schoolYearStart } from '../web/grade.js';

// Fiktiv framtid (läsåret 2040/41), så att inga årtal i det publika repot kan
// sammanfalla med verkliga barns födelseår.
const at = s => new Date(s + 'T12:00:00');

test('född 2026 går i årskurs 8 hösten 2040', () => {
  assert.equal(gradeOf({ birthYear: 2026 }, at('2040-11-11')), 8);
});

test('läsåret byts 1 juli', () => {
  assert.equal(schoolYearStart(at('2041-06-30')), 2040);
  assert.equal(schoolYearStart(at('2041-07-01')), 2041);
  assert.equal(gradeOf({ birthYear: 2026 }, at('2041-07-01')), 9);
});

test('gradeOffset och gränser', () => {
  assert.equal(gradeOf({ birthYear: 2026, gradeOffset: -1 }, at('2040-11-11')), 7);
  assert.equal(gradeOf({ birthYear: 2040 }, at('2040-11-11')), 0);
  assert.equal(gradeOf({ birthYear: 1990 }, at('2040-11-11')), 9);
});

test('gamla profiler utan födelseår använder grade', () => {
  assert.equal(gradeOf({ grade: 3 }), 3);
  assert.equal(gradeOf({ grade: 0 }), 0); // serverns barnvy kan ge 0
  assert.equal(gradeOf({ grade: '' }), 5);
  assert.equal(gradeOf({ grade: 12 }), 9);
  assert.equal(gradeOf({}), 5);
});

test('migrering: födelseår ur årskurs ger samma årskurs tillbaka', () => {
  for (const g of [1, 4, 9]) assert.equal(gradeOf({ birthYear: birthYearFor(g, at('2040-11-11')) }, at('2040-11-11')), g);
});
