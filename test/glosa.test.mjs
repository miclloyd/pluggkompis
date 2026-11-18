// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glosaBank, GLOSA_MIN } from '../web/glosa.js';
import { hasSpellingLure, gradeLocal } from '../web/engine.js';

const words = [['säng', 'bed'], ['garderob', 'wardrobe'], ['kudde', 'pillow'], ['bokhylla', 'bookshelf'], ['soffa', 'sofa/couch'],
  ['fåtölj', 'armchair'], ['bord', 'table'], ['kylskåp', 'fridge'], ['spegel', 'mirror'], ['gardiner', 'curtains']];
const goals = words.map(([term, translation], i) => ({ id: 'g' + i, type: 'glosa', term, translation, langs: 'sv-en', sources: [{ m: 'm1', p: 1 }] }));

test('glosor: nivå 1–3 byggs ur ordlistan, alla nivåer har frågor', () => {
  for (const g of goals) {
    const bank = glosaBank(g, goals);
    for (const l of [1, 2, 3]) assert.ok(bank.filter(i => i.level === l).length >= 2, `${g.term} nivå ${l}`);
    assert.ok(bank.every(i => i.src.m === 'm1' && i.id && i.goalId === g.id));
  }
});

test('glosor: rätt svar finns bland alternativen, inga felstavningar, unika alternativ', () => {
  for (const g of goals) for (const it of glosaBank(g, goals).filter(i => i.kind === 'mcq')) {
    assert.ok(it.answer >= 0 && it.answer < it.options.length);
    assert.ok(!it.options.some((o, i) => i !== it.answer && ['couch', 'sofa'].includes(o) && g.translation.includes(o)), 'synonym som fel alternativ');
    assert.equal(new Set(it.options).size, it.options.length);
    assert.equal(hasSpellingLure(it), false);
    assert.equal(it.options.length, it.level === 1 ? 3 : 4);
  }
});

test('glosor: skrivfrågor åt båda hållen, alla former godtas (sofa/couch)', () => {
  const sofa = glosaBank(goals[4], goals).filter(i => i.kind === 'write');
  assert.deepEqual(sofa.map(i => i.q), ['Skriv på engelska: soffa', 'Skriv på svenska: sofa']);
  assert.equal(sofa[0].answer, 'sofa');
  assert.deepEqual(sofa[0].accept, ['couch']);
  assert.equal(gradeLocal(sofa[0], 'couch').score, 1);
  assert.equal(gradeLocal(sofa[0], 'sofa').score, 1);
});

test('glosor: para ihop med fyra ord ur förhöret, samma frö ger samma frågor', () => {
  const m = glosaBank(goals[0], goals).find(i => i.kind === 'match');
  assert.equal(m.pairs.length, 4);
  assert.ok(m.pairs.some(([a, b]) => a === 'säng' && b === 'bed'));
  assert.deepEqual(glosaBank(goals[0], goals), glosaBank(goals[0], goals));
});

test('glosor: för få ord i förhöret → ingen kodad bank (AI tar över)', () => {
  assert.deepEqual(glosaBank(goals[0], goals.slice(0, GLOSA_MIN - 1)), []);
  const other = { ...goals[0], id: 'x', langs: 'sv-de' };
  assert.deepEqual(glosaBank(other, [...goals, other]), [], 'ett annat språkpar räknas inte');
});

test('bygget: glosförhöret blir klart utan AI-anrop', async () => {
  const { buildBank } = await import('../web/pipeline.js');
  const saved = {};
  const repo = { saveBank: async (_, gid, items) => { saved[gid] = items; } };
  const r = await buildBank({ ai: null, repo, test: { id: 't' }, goals, materials: [{ ref: 'm1', pages: [{ p: 1 }] }], existing: {} });
  assert.deepEqual(r.short, []);
  assert.equal(Object.keys(saved).length, goals.length);
});

test('glosor: en synonym hos en annan glosa blir aldrig ett fel alternativ', () => {
  const extra = [...goals, { id: 'gx', type: 'glosa', term: 'schäslong', translation: 'couch', langs: 'sv-en', sources: [{ m: 'm1', p: 1 }] }];
  for (const it of glosaBank(extra[4], extra)) {
    if (it.kind === 'mcq') assert.ok(!it.options.some((o, i) => i !== it.answer && o === 'couch'), it.q);
    if (it.kind === 'match') assert.ok(!it.pairs.some(([, b]) => b === 'couch'), 'para ihop');
  }
});

test('glosor: homonymer (samma term, annan översättning) blir inte fel alternativ och godtas', () => {
  const hom = [...goals, { id: 'gh', type: 'glosa', term: 'bord', translation: 'desk', langs: 'SV-EN', sources: [{ m: 'm1', p: 1 }] }];
  const table = glosaBank(hom[6], hom); // bord = table
  for (const it of table.filter(i => i.kind === 'mcq')) assert.ok(!it.options.some((o, i) => i !== it.answer && o === 'desk'), it.q);
  const w = table.find(i => i.kind === 'write' && i.answer === 'table');
  assert.ok(w.accept.includes('desk'));
  assert.ok(glosaBank(hom.at(-1), hom).length > 0, 'SV-EN räknas som samma språkpar som sv-en');
});

test('glosor: en tredje glosa som delar homonymens översättning blir inte heller fel alternativ', () => {
  const three = [...goals,
    { id: 'gh', type: 'glosa', term: 'bord', translation: 'desk', langs: 'sv-en', sources: [{ m: 'm1', p: 1 }] },
    { id: 'gs', type: 'glosa', term: 'skrivbord', translation: 'desk', langs: 'sv-en', sources: [{ m: 'm1', p: 1 }] }];
  const table = glosaBank(three[6], three); // bord = table
  for (const it of table) {
    if (it.kind === 'mcq') assert.ok(!it.options.some((o, i) => i !== it.answer && o === 'desk'), it.q);
    if (it.kind === 'match') assert.ok(!it.pairs.some(([, b]) => b === 'desk'), 'para ihop');
  }
  assert.ok(table.find(i => i.kind === 'write' && i.answer === 'table').accept.includes('desk'));
});
