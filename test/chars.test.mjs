import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { htmPreact: { html: () => null, useState: () => [false, () => {}] } };
const { charsForLangs, withChars, SPECIAL, insertAt, upperOf } = await import('../web/chars.js');

test('tecken per språk, aldrig de som finns på svenskt tangentbord', () => {
  assert.deepEqual(charsForLangs('sv-es'), SPECIAL.es);
  assert.deepEqual(charsForLangs('es-sv'), SPECIAL.es);
  assert.deepEqual(charsForLangs('sv-en'), []);
  assert.deepEqual(charsForLangs('sv-de'), ['ü', 'ß']);
  assert.deepEqual(charsForLangs(''), []);
  for (const list of Object.values(SPECIAL)) for (const c of 'åäöÅÄÖ') assert.ok(!list.includes(c));
});

test('bara glosmål får tecken, och banken ändras inte', () => {
  const goals = [{ id: 'a', type: 'glosa', langs: 'sv-es' }, { id: 'b', type: 'glosa', langs: 'sv-en' }, { id: 'c', type: 'fakta', langs: 'sv-es' }];
  const banks = { a: [{ id: 1 }], b: [{ id: 2 }], c: [{ id: 3 }] };
  const out = withChars(goals, banks);
  assert.deepEqual(out.a[0].chars, SPECIAL.es);
  assert.equal(out.b[0].chars, undefined);
  assert.equal(out.c[0].chars, undefined);
  assert.equal(banks.a[0].chars, undefined);
});

test('språket som namn eller regionkod', () => {
  assert.deepEqual(charsForLangs('svenska-spanska'), SPECIAL.es);
  assert.deepEqual(charsForLangs('sv-ES'), SPECIAL.es);
  assert.deepEqual(charsForLangs('es-ES'), SPECIAL.es);
  assert.deepEqual(charsForLangs('svenska, tyska'), SPECIAL.de);
  assert.deepEqual(charsForLangs('swedish-spanish'), SPECIAL.es);
});

test('infogning vid markören och över en markering', () => {
  assert.deepEqual(insertAt('nio', 2, 2, 'ñ'), { value: 'niño', caret: 3 });
  assert.deepEqual(insertAt('nixxo', 2, 4, 'ñ'), { value: 'niño', caret: 3 });
  assert.deepEqual(insertAt('ni', undefined, undefined, 'ñ'), { value: 'niñ', caret: 3 });
  assert.deepEqual(insertAt('', 5, 9, '¿'), { value: '¿', caret: 1 });
});

test('versaler, och ß står kvar', () => {
  assert.equal(upperOf('ñ'), 'Ñ');
  assert.equal(upperOf('é'), 'É');
  assert.equal(upperOf('ß'), 'ß');
  assert.equal(upperOf('¿'), '¿');
});
