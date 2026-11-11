import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeLocal, correctAnswerText } from '../web/engine.js';
import { validateBank } from '../web/prompts.js';

const item = { kind: 'order', steps: ['A', 'B', 'C', 'D'] };

test('rätt ordning ger rätt', () => {
  assert.deepEqual(gradeLocal(item, ['A', 'B', 'C', 'D']), { score: 1, verdict: 'right' });
});

test('ett steg på fel ställe ger nästan rätt', () => {
  assert.equal(gradeLocal(item, ['B', 'A', 'C', 'D']).score, 0.5); // två grannar bytta
  assert.equal(gradeLocal(item, ['B', 'C', 'D', 'A']).score, 0.5); // ett steg flyttat
});

test('mer än ett fel ger fel', () => {
  assert.equal(gradeLocal(item, ['D', 'C', 'B', 'A']).score, 0);
  assert.equal(gradeLocal(item, ['B', 'A', 'D', 'C']).score, 0);
  assert.equal(gradeLocal(item, ['A', 'B']).score, 0);
  assert.equal(gradeLocal(item, null).score, 0);
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
