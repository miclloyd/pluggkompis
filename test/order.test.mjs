import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeLocal, correctAnswerText } from '../web/engine.js';
import { validateBank } from '../web/prompts.js';

const item = { kind: 'order', steps: ['A', 'B', 'C', 'D'] };

test('rätt ordning ger rätt', () => {
  assert.deepEqual(gradeLocal(item, ['A', 'B', 'C', 'D']), { score: 1, verdict: 'right' });
});

test('två grannar bytta (minst fyra steg) ger nästan rätt', () => {
  assert.equal(gradeLocal(item, ['B', 'A', 'C', 'D']).score, 0.5);
  assert.equal(gradeLocal(item, ['A', 'B', 'D', 'C']).score, 0.5);
});

test('mer än ett byte, eller tre steg, ger fel', () => {
  assert.equal(gradeLocal(item, ['B', 'C', 'D', 'A']).score, 0); // tre byten bort
  assert.equal(gradeLocal(item, ['D', 'C', 'B', 'A']).score, 0);
  assert.equal(gradeLocal(item, ['B', 'A', 'D', 'C']).score, 0);
  assert.equal(gradeLocal({ kind: 'order', steps: ['x', 'y', 'z'] }, ['y', 'x', 'z']).score, 0);
  assert.equal(gradeLocal(item, ['A', 'B']).score, 0);
  assert.equal(gradeLocal(item, ['A', 'A', 'C', 'D']).score, 0);
  assert.equal(gradeLocal(item, null).score, 0);
});

test('slumpade gissningar ger sällan delpoäng (fyra steg: 3 av 23 fel ordningar)', () => {
  const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  const wrong = perms(item.steps).filter(p => p.join() !== item.steps.join());
  assert.equal(wrong.filter(p => gradeLocal(item, p).score === 0.5).length, 3);
});

test('facit som numrerad lista', () => {
  assert.equal(correctAnswerText(item), '1. A\n2. B\n3. C\n4. D');
});

test('validateBank tar emot ordningsfrågor och stoppar trasiga', () => {
  const goals = [{ id: 'g1', type: 'fakta', sources: [{ m: 'm1', p: 1 }] }];
  const refs = new Set(['m1:1']);
  const src = { m: 'm1', p: 1 };
  const ok = { goal: 'g1', level: 2, kind: 'order', q: 'Ordning', steps: ['x', 'y', 'z'], src };
  const out = validateBank({ items: [ok, { ...ok, steps: ['x', 'x', 'y'] }, { ...ok, steps: ['x', 'y'] }, { ...ok, level: 1 }] }, goals, refs);
  assert.equal(out.byGoal.g1.filter(i => i.kind === 'order').length, 1);
  assert.equal(out.errors.filter(e => /ordning|steg/.test(e)).length, 3);
});

test('diktamen rättas som skrivfråga', () => {
  const it = { kind: 'dictation', answer: 'necessary', accept: [] };
  assert.equal(gradeLocal(it, 'necessary').score, 1);
  assert.equal(gradeLocal(it, 'xyz').score, 0);
  assert.equal(correctAnswerText(it), 'necessary');
});

test('diktamen skapas bara för diktabla glosor med känt språk och nivå 3 i banken', async () => {
  // speech.js importerar lib.js (Preact); en tom stub räcker för logiken.
  globalThis.window = { speechSynthesis: {}, SpeechSynthesisUtterance: function () {}, htmPreact: { html: () => null } };
  const { withDictation } = await import('../web/speech.js');
  const lvl3 = [{ id: 'w', level: 3, kind: 'write' }];
  const goals = [
    { id: 'a', type: 'glosa', translation: 'necessary', langs: 'sv-en' },
    { id: 'b', type: 'glosa', translation: 'a dog / the dog', langs: 'sv-en' },
    { id: 'c', type: 'glosa', translation: 'Hund', langs: 'sv-xx' },
    { id: 'd', type: 'glosa', translation: 'house', langs: 'sv-en' },
    { id: 'e', type: 'fakta', translation: 'x' },
  ];
  const banks = { a: lvl3, b: lvl3, c: lvl3, d: [{ id: 'm', level: 1, kind: 'mcq' }], e: lvl3 };
  const out = withDictation(goals, banks);
  assert.deepEqual(Object.keys(out).filter(k => out[k].some(i => i.kind === 'dictation')), ['a']);
  assert.equal(out.a.find(i => i.kind === 'dictation').lang, 'en');
  assert.equal(banks.a.length, 1, 'originalbanken ändras inte');
  delete globalThis.window;
});
