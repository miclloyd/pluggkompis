// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalTrend, isStuck, weakestGoals, tipDecision } from '../web/engine.js';
import { tipMaterial, tipPrompt, validateTip } from '../web/prompts.js';

const T0 = Date.parse('2044-11-14T12:00:00');
// n svar på ett mål; score(i) ger poängen för svar i (äldst först).
const answers = (goalId, n, score, extra = {}) => Array.from({ length: n }, (_, i) =>
  ({ goalId, itemId: `${goalId}-i${i % 3}`, score: score(i), ts: T0 + i * 60000, answer: 0, ...extra }));

test('trenden räknar bara egna svar, de tio senaste', () => {
  const a = [...answers('g', 15, i => (i < 5 ? 0 : 1)), ...answers('g', 4, () => 0, { helped: true }), ...answers('g', 2, () => 0, { dontKnow: true }), ...answers('g', 3, () => 0, { exam: 'x' })];
  const t = goalTrend('g', a);
  assert.equal(t.own, 15);
  assert.equal(t.recent, 10);
  assert.equal(t.recentScore, 1);
});

test('fastkört: många svar och ungefär varannan fel', () => {
  assert.equal(isStuck(goalTrend('g', answers('g', 20, i => i % 2))), true);
  assert.equal(isStuck(goalTrend('g', answers('g', 8, () => 0))), false, 'för få svar');
  assert.equal(isStuck(goalTrend('g', answers('g', 20, i => (i % 4 ? 1 : 0)))), false, '75 % rätt');
});

test('svagaste målen: fastkörda först, klara och oövade räknas inte', () => {
  const goals = ['a', 'b', 'c', 'd'].map(id => ({ id, type: 'fakta', text: id }));
  const banks = Object.fromEntries(goals.map(g => [g.id, [1, 2, 3].map(l => ({ id: g.id + l, level: l, kind: 'mcq' }))]));
  const mastery = { c: { level: 3, passedMax: true } };
  const attempts = [...answers('a', 10, () => 0.5), ...answers('b', 20, i => i % 2), ...answers('c', 10, () => 0)];
  assert.deepEqual(weakestGoals({ goals, mastery, banks, attempts, n: 2 }).map(g => g.id), ['b', 'a']);
  // Mål med 85 % rätt eller mer föreslås inte.
  const good = [...answers('a', 10, i => (i < 1 ? 0 : 1)), ...answers('b', 10, () => 0.9)];
  assert.deepEqual(weakestGoals({ goals, mastery, banks, attempts: good, n: 2 }).map(g => g.id), []);
});

// Ett litet material: två sidor, frågor från båda, missar på sidan 2.
function setup() {
  const goals = [{ id: 'g', text: 'Kunna förklara vad en gränspunkt är', type: 'begrepp' }];
  const banks = { g: [
    { id: 'g-i0', level: 1, kind: 'mcq', q: 'Var ligger gränspunkten?', options: ['På horisontlinjen', 'Under marken'], answer: 0, src: { m: 'mA', p: 2 } },
    { id: 'g-i1', level: 1, kind: 'mcq', q: 'Vad heter linjen?', options: ['Horisontlinje', 'Stödlinje'], answer: 0, src: { m: 'mA', p: 1 } },
    { id: 'g-i2', level: 2, kind: 'short', q: 'Förklara gränspunkt.', answer: 'Punkten där linjerna möts.', src: { m: 'mA', p: 2 } },
  ] };
  const materials = [{ ref: 'mA', name: 'Perspektiv', pages: [{ p: 1, text: 'Horisontlinjen är ...' }, { p: 2, text: 'Gränspunkten ligger på horisontlinjen ...' }, { p: 3, text: 'Annat' }] }];
  const attempts = answers('g', 12, i => (i % 2 ? 1 : 0)).map((a, i) => ({ ...a, itemId: i % 2 ? 'g-i1' : 'g-i0', answer: 1 }));
  return { goals, banks, materials, attempts };
}

test('underlaget: missarnas sidor först, bara sidor som finns', () => {
  const m = tipMaterial(setup());
  assert.equal(m.pages[0].p, 2, 'sidan med missarna först');
  assert.ok(m.pages.every(p => p.p !== 3), 'sidor utan frågor följer inte med');
  assert.equal(m.goals[0].misses[0].given, 'Under marken');
  assert.equal(m.goals[0].misses[0].correct, 'På horisontlinjen');
  const prompt = tipPrompt({ test: { grade: 6, subject: 'Bild' }, material: m });
  assert.ok(new TextEncoder().encode(prompt).length < 40000);
  assert.ok(prompt.includes('[material "mA", sida 2]'));
});

test('lästipset får bara peka på sidor i underlaget', () => {
  const m = tipMaterial(setup());
  const ok = validateTip({ tips: [{ goal: 1, read: [{ m: 'mA', p: 2, what: 'rutan' }, { m: 'mA', p: 9, what: 'finns inte' }], mistake: null, explain: 'Förklaring.', try: 'Rita.' }] }, m);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.tips[0].read, [{ m: 'mA', p: 2, what: 'rutan' }]);
  const bad = validateTip({ tips: [{ goal: 1, read: [{ m: 'mA', p: 9 }], explain: 'x', try: 'y' }] }, m);
  assert.equal(bad.ok, false, 'bara påhittade sidor');
  assert.equal(validateTip({ tips: [] }, m).ok, false);
  assert.equal(validateTip({ tips: [{ goal: 1, read: [{ m: 'mA', p: '2' }], mistake: 'null', explain: 'x', try: 'y' }] }, m).tips[0].mistake, null);
});

test('två mål med olika sidor: båda får en sida', () => {
  const goals = [{ id: 'a', text: 'Mål A' }, { id: 'b', text: 'Mål B' }];
  const item = (id, p) => ({ id, level: 1, kind: 'mcq', q: id, options: ['x', 'y'], answer: 0, src: { m: 'm', p } });
  // Mål a har många frågor på sidorna 1–5; mål b bara en fråga på sidan 9.
  const banks = { a: [1, 2, 3, 4, 5].flatMap(p => [item(`a${p}x`, p), item(`a${p}y`, p)]), b: [item('b9', 9)] };
  const materials = [{ ref: 'm', name: 'M', pages: [1, 2, 3, 4, 5, 9].map(p => ({ p, text: 'sida ' + p })) }];
  const m = tipMaterial({ goals, banks, attempts: [], materials });
  assert.equal(m.pages.length, 4);
  assert.ok(m.pages.some(p => p.p === 9), 'mål b:s enda sida är med');
  const v = validateTip({ tips: [{ goal: 1, read: [{ m: 'm', p: 1 }], explain: 'x', try: 'y' }, { goal: 2, read: [{ m: 'm', p: 9 }, { m: 'm', p: 9 }], explain: 'x', try: 'y' }] }, m);
  assert.equal(v.ok, true);
  assert.equal(v.tips[1].read.length, 1, 'samma sida bara en gång');
});

test('prompten ryms i 40 kB även med fulla sidor och åäö', () => {
  const long = 'åäö'.repeat(3000);
  const goals = [{ id: 'a', text: long }, { id: 'b', text: long }];
  const item = (id, p) => ({ id, level: 1, kind: 'short', q: long, answer: long, src: { m: 'm', p } });
  const banks = { a: [1, 2].map(p => item('a' + p, p)), b: [3, 4].map(p => item('b' + p, p)) };
  const attempts = ['a1', 'a2', 'b3', 'b4'].flatMap((id, j) => Array.from({ length: 6 }, (_, i) => ({ goalId: id[0], itemId: id, score: 0, answer: long, ts: T0 + j * 1e6 + i })));
  const materials = [{ ref: 'm', name: 'M', pages: [1, 2, 3, 4].map(p => ({ p, text: long + long })) }];
  const prompt = tipPrompt({ test: { grade: 6, subject: 'Bild' }, material: tipMaterial({ goals, banks, attempts, materials }) });
  assert.ok(new TextEncoder().encode(JSON.stringify(prompt)).length <= 34000);
  assert.ok(prompt.includes('[material "m", sida 4]'), 'alla sidor kvar, bara kortare');
});

test('tipDecision: dagens tips återanvänds, taket stoppar', () => {
  const now = T0, day = 864e5;
  const tip = (goalIds, ts = now - 1000) => ({ kind: 'tip', profileId: 'p', ts, tips: goalIds.map(goalId => ({ goalId })) });
  assert.deepEqual(tipDecision({ chats: [tip(['a', 'b'])], profileId: 'p', goalIds: ['b'], now, perDay: 6 }), { cached: [{ goalId: 'b' }] });
  assert.ok(tipDecision({ chats: [tip(['a'], now - day)], profileId: 'p', goalIds: ['a'], now, perDay: 6 }).ask, 'gårdagens tips räknas inte');
  assert.ok(tipDecision({ chats: [{ ...tip(['a']), profileId: 'q' }], profileId: 'p', goalIds: ['a'], now, perDay: 6 }).ask, 'annat barn');
  const six = Array.from({ length: 6 }, (_, i) => tip(['x' + i]));
  assert.ok(tipDecision({ chats: six, profileId: 'p', goalIds: ['a'], now, perDay: 6 }).limit);
});
