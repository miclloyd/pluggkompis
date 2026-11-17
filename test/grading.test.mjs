// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeFree, previousGrade, questionKey, GRADE_VERSION, TIERS } from '../web/grading.js';
import { gradePrompt } from '../web/prompts.js';
import { blockedItems, withoutItems, replayMastery, newMastery } from '../web/engine.js';

const item = { id: 'i1', kind: 'short', level: 3, q: 'Vilka linjer möts i gränspunkten?', answer: 'Parallella linjer.', must: ['nämner parallella linjer'] };
const test_ = { grade: 6, subject: 'Bild' };

// Låtsas-AI som minns anropen.
function fakeAi(met = [true]) {
  const calls = [];
  return { calls, complete: async opts => { calls.push(opts); return { json: { met, feedback: 'ok', confidence: 'hög' } }; } };
}

test('rättningen är stabil: temperatur 0 i varje anrop', async () => {
  const ai = fakeAi();
  await gradeFree({ ai, test: test_, item, answer: 'Det är stödlinjerna som möts' });
  assert.ok(ai.calls.length >= 1 && ai.calls.every(c => c.stable === true));
});

test('provläget rättas av den noggranna modellen direkt', async () => {
  const ai = fakeAi();
  const g = await gradeFree({ ai, test: test_, item, answer: 'Det är stödlinjerna som möts', careful: true });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].tier, TIERS.careful);
  assert.equal(g.v, GRADE_VERSION);
});

test('samma svar på samma fråga får samma rättning, utan AI-anrop', async () => {
  const prev = { itemId: 'i1', answer: 'Det är STÖDLINJERNA som möts!', score: 0.5, ts: 2, grading: { tier: 'default', met: [false], feedback: 'f', v: GRADE_VERSION, qk: questionKey(item) } };
  const ai = fakeAi();
  const g = await gradeFree({ ai, test: test_, item, answer: 'det är stödlinjerna som möts', attempts: [prev] });
  assert.equal(ai.calls.length, 0);
  assert.equal(g.score, 0.5);
  assert.equal(g.verdict, 'almost');
  assert.equal(g.tier, 'tidigare');
});

test('gamla rättningar (före de nya reglerna) återanvänds inte, förälderns beslut gör det', () => {
  const old = { itemId: 'i1', answer: 'stödlinjerna', score: 0, ts: 1, grading: { tier: 'quick', met: [false] } };
  assert.equal(previousGrade(item, 'stödlinjerna', [old]), null);
  const decided = { ...old, score: 1, resolved: 'accepted', grading: { ...old.grading, qk: questionKey(item) } };
  assert.equal(previousGrade(item, 'stödlinjerna', [decided]).score, 1);
  const self = { ...old, grading: { tier: 'själv', v: GRADE_VERSION } };
  assert.equal(previousGrade(item, 'stödlinjerna', [self]), null, 'barnets egen bedömning återanvänds inte');
  const other = { ...old, itemId: 'i2', grading: { tier: 'quick', v: GRADE_VERSION } };
  assert.equal(previousGrade(item, 'stödlinjerna', [other]), null, 'annan fråga');
});

test('rättningsprompten godtar ämnets eget begrepp och ber om samma bedömning varje gång', () => {
  const p = gradePrompt({ test: test_, item, answer: 'stödlinjerna' });
  assert.ok(p.includes('ämnets vedertagna namn'));
  assert.ok(p.includes('uppfylls aldrig av bara ett namn'), 'regeln gäller inte förklaringspunkter');
  assert.ok(p.includes('bara upprepar ord ur frågan'), 'att upprepa frågan räcker inte');
  assert.ok(p.includes('Bedöm samma svar på samma sätt varje gång'));
});

test('flaggade frågor används inte förrän föräldern släppt dem', () => {
  const flags = [
    { kind: 'question', itemId: 'a', status: 'open' },
    { kind: 'question', itemId: 'b', status: 'faulty' },
    { kind: 'question', itemId: 'c', status: 'ok' },
    { kind: 'grading', itemId: 'd', status: 'open' },
  ];
  const blocked = blockedItems(flags);
  assert.deepEqual([...blocked].sort(), ['a', 'b']);
  const banks = withoutItems({ g: [{ id: 'a' }, { id: 'c' }, { id: 'd' }] }, blocked);
  assert.deepEqual(banks.g.map(i => i.id), ['c', 'd']);
});

test('återanvändning: förälderns beslut gäller, även på ett återanvänt svar, med rätt besked', () => {
  const reused = { itemId: 'i1', answer: 'stödlinjerna', score: 1, originalScore: 0, resolved: 'accepted', ts: 5,
    grading: { tier: 'tidigare', met: [false], feedback: 'Saknas: parallella', v: GRADE_VERSION, qk: questionKey(item) } };
  const g = previousGrade(item, 'Stödlinjerna', [reused]);
  assert.equal(g.score, 1);
  assert.deepEqual(g.met, [true]);
  assert.match(g.feedback, /vuxen/);
});

test('återanvändning: provläget tar bara den noggranna modellens rättningar', () => {
  const quick = { itemId: 'i1', answer: 'stödlinjerna', score: 0, ts: 1, grading: { tier: TIERS.fast, met: [false], v: GRADE_VERSION, qk: questionKey(item) } };
  assert.ok(previousGrade(item, 'stödlinjerna', [quick]), 'övningen får återanvända snabbmodellen');
  assert.equal(previousGrade(item, 'stödlinjerna', [quick], { careful: true }), null);
  const careful = { ...quick, grading: { ...quick.grading, tier: TIERS.careful } };
  assert.ok(previousGrade(item, 'stödlinjerna', [careful], { careful: true }));
});

test('återanvändning: inte en bestridd rättning, inte när frågan ändrats', () => {
  const base = { itemId: 'i1', answer: 'stödlinjerna', score: 0, ts: 1, grading: { tier: TIERS.careful, met: [false], v: GRADE_VERSION, qk: questionKey(item) } };
  assert.equal(previousGrade(item, 'stödlinjerna', [{ ...base, disputed: true }]), null);
  assert.equal(previousGrade({ ...item, must: ['nämner stödlinjer'] }, 'stödlinjerna', [base]), null);
});

test('provläget: gradeFree med careful återanvänder inte snabbmodellen utan rättar noggrant', async () => {
  const quick = { itemId: 'i1', answer: 'stödlinjerna', score: 0, ts: 1, grading: { tier: TIERS.fast, met: [false], v: GRADE_VERSION, qk: questionKey(item) } };
  assert.ok(previousGrade(item, 'stödlinjerna', [quick]), 'utan careful hade den återanvänts');
  const ai = fakeAi();
  const g = await gradeFree({ ai, test: test_, item, answer: 'stödlinjerna', attempts: [quick], careful: true });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].tier, TIERS.careful);
  assert.equal(g.score, 1);
});

test('återanvändning: förälderns Delvis rätt gäller i provläget och ger halva punkterna', () => {
  const two = { ...item, must: ['nämner stödlinjer', 'nämner att de är parallella'] };
  const partial = { itemId: 'i1', answer: 'stödlinjerna', score: 0.5, originalScore: 0, resolved: 'partial', ts: 3,
    grading: { tier: TIERS.fast, met: [false, false], v: GRADE_VERSION, qk: questionKey(two) } };
  const g = previousGrade(two, 'stödlinjerna', [partial], { careful: true });
  assert.equal(g.score, 0.5);
  assert.deepEqual(g.met, [true, false]);
});

test('begreppsregeln gäller inte glosfrågor', () => {
  const glosa = { ...item, kind: 'sentence' };
  assert.ok(!gradePrompt({ test: test_, item: glosa, answer: 'x' }).includes('vedertagna namn'));
});

test('en borttagen fråga (void) räknas inte i nivån', () => {
  const goal = { id: 'g', type: 'fakta' };
  const bank = [1, 2, 3].map(l => ({ id: 'x' + l, level: l, kind: 'mcq' }));
  const right = Array.from({ length: 5 }, (_, i) => ({ goalId: 'g', itemId: 'x1', score: 1, ts: 1000 + i }));
  const up = replayMastery(goal, right, '2099-01-01', bank);
  const voided = replayMastery(goal, right.map(a => ({ ...a, void: true })), '2099-01-01', bank);
  assert.ok(up.level > 1, 'fem rätt ger nivå upp');
  assert.deepEqual(voided.level, newMastery('g').level, 'samma svar som void ger ingen nivå');
});

test('ett omprövat och höjt svar (ai-accepted) återanvänds, inte ett äldre lägre', () => {
  const k = questionKey(item);
  const old = { itemId: 'i1', answer: 'stödlinjerna', score: 0, ts: 1, grading: { tier: TIERS.fast, met: [false], v: GRADE_VERSION, qk: k } };
  const raised = { itemId: 'i1', answer: 'stödlinjerna', score: 1, ts: 2, disputed: true, resolved: 'ai-accepted', grading: { tier: TIERS.careful, met: [true], v: GRADE_VERSION, qk: k } };
  assert.equal(previousGrade(item, 'stödlinjerna', [old, raised]).score, 1);
});
