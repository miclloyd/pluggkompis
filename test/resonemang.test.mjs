import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHigh, gradePrompt, bankHighPrompt, MOVES } from '../web/prompts.js';

const goals = [{ id: 'r1', type: 'resonemang', sources: [{ m: 'm1', p: 1 }], text: 'Kunna resonera om varför man fastar' }];
const refs = new Set(['m1:1']);
const src = { m: 'm1', p: 1 };
const base = { goal: 'r1', kind: 'explain', q: 'Varför tror du …?', answer: 'Därför att …', src };

test('resonemangsdragen blir punkter i mallen efter faktapunkterna', () => {
  const out = validateHigh({ items: [
    { ...base, level: 3, kind: 'short', must: ['fasta under ramadan'], moves: ['orsak'] },
    { ...base, level: 3, kind: 'short', must: ['fasta'], moves: ['orsak'] },
    { ...base, level: 4, must: ['fasta'], moves: ['orsak', 'exempel'] },
    { ...base, level: 4, must: ['fasta'], moves: ['orsak', 'följd'] },
    { ...base, level: 5, must: ['fasta', 'ramadan'], moves: ['orsak', 'följd', 'synvinkel'] },
  ] }, goals, refs);
  assert.equal(out.ok, true, out.errors.join('; '));
  const l5 = out.byGoal.r1.find(i => i.level === 5);
  assert.deepEqual(l5.must, ['fasta', 'ramadan', MOVES.orsak, MOVES.följd, MOVES.synvinkel]);
  assert.deepEqual(l5.moves, ['orsak', 'följd', 'synvinkel']);
});

test('fel antal drag, okänt drag eller utan orsak stoppas', () => {
  const bad = [
    { ...base, level: 4, must: ['fasta'], moves: ['orsak'] },
    { ...base, level: 4, must: ['fasta'], moves: ['exempel', 'följd'] },
    { ...base, level: 4, must: ['fasta'], moves: ['orsak', 'gissning'] },
    { ...base, level: 3, kind: 'short', must: ['a', 'b'], moves: ['orsak'] },
  ];
  const out = validateHigh({ items: bad }, goals, refs);
  assert.equal(Object.values(out.byGoal).flat().length, 0);
});

test('andra måltyper påverkas inte', () => {
  const g = [{ id: 'f1', type: 'samband', sources: [{ m: 'm1', p: 1 }] }];
  const out = validateHigh({ items: [{ ...base, goal: 'f1', level: 4, must: ['a', 'b'] }] }, g, refs);
  assert.equal(out.byGoal.f1.length, 1);
  assert.equal(out.byGoal.f1[0].moves, undefined);
});

test('rättningsprompten ber om en följdfråga, aldrig facit, för resonemang', () => {
  const test0 = { grade: 5, subject: 'Religion' };
  const p = gradePrompt({ test: test0, item: { q: 'q', answer: 'a', must: ['fasta', MOVES.orsak, MOVES.exempel], moves: ['orsak', 'exempel'] }, answer: 'svar' });
  assert.match(p, /Punkterna 2–3 är resonemangsdrag/);
  assert.match(p, /EN följdfråga/);
  const vanlig = gradePrompt({ test: test0, item: { q: 'q', answer: 'a', must: ['x'] }, answer: 'svar' });
  assert.doesNotMatch(vanlig, /följdfråga/);
});

test('bankprompten förklarar trappan bara när det finns resonemangsmål', () => {
  const t = { grade: 5, subject: 'SO', description: '' };
  assert.match(bankHighPrompt({ test: t, goals: [{ ...goals[0], type: 'resonemang' }], sourceText: '' }), /trappa av resonemangsdrag/);
  assert.doesNotMatch(bankHighPrompt({ test: t, goals: [{ ...goals[0], type: 'samband' }], sourceText: '' }), /trappa av resonemangsdrag/);
});
