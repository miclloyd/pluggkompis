// Körs vid bygget (flake.nix → checks.js): node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, scheduleFor, ageCap, toggleDay } from '../web/plan.js';
import { pickNext } from '../web/engine.js';

// Fiktiv framtid (läsåret 2044/45), som i grade.test.mjs.
const at = s => Date.parse(s + 'T12:00:00');
const NOW = at('2044-11-14'); // en måndag

// Ett prov med många mål och stora frågebanker: mer arbete än som ryms på några dagar.
function bigTest(n = 20, weight = g => (g < 5 ? 3 : 2)) {
  const goals = [], banks = {};
  for (let g = 0; g < n; g++) {
    goals.push({ id: 'g' + g, type: 'samband', weight: weight(g), order: g });
    banks['g' + g] = [1, 2, 3, 4, 5].flatMap(l => [0, 1, 2].map(i => ({ id: `g${g}l${l}i${i}`, level: l, kind: 'explain' })));
  }
  return { goals, banks };
}

test('dagstak efter årskurs', () => {
  assert.equal(ageCap(2), 10);
  assert.equal(ageCap(4), 20);
  assert.equal(ageCap(6), 20);
  assert.equal(ageCap(8), 30);
  assert.equal(scheduleFor({ birthYear: 2034 }, NOW).cap, 20); // åk 4 hösten 2044
  assert.equal(scheduleFor({ birthYear: 2034, maxMinutes: 15 }, NOW).cap, 15);
  assert.deepEqual(scheduleFor({ birthYear: 2034 }, NOW).restDays, [5, 6]);
  assert.deepEqual(scheduleFor({ birthYear: 2034, schedule: { restDays: [] } }, NOW).restDays, []);
});

test('ingen dag över taket, och helgen är ledig', () => {
  const { goals, banks } = bigTest();
  const schedule = scheduleFor({ birthYear: 2034, schedule: { trainingDays: [0], training: [15, 30], free: [20, 60] } }, NOW);
  const plan = buildPlan({ test: { testDate: '2044-11-25' }, goals, mastery: {}, banks, attempts: [], schedule, now: NOW });
  for (const d of plan.days.filter(d => !d.off)) assert.ok(d.minutes <= 20, `${d.key}: ${d.minutes} min`);
  const weekend = plan.days.filter(d => d.weekday >= 5);
  assert.ok(weekend.length > 0 && weekend.every(d => d.off), 'lördag och söndag lediga');
  assert.equal(plan.cap, 20);
});

test('räcker inte tiden sänks ambitionen, inte vilan', () => {
  const { goals, banks } = bigTest();
  const schedule = scheduleFor({ birthYear: 2034 }, NOW);
  const plan = buildPlan({ test: { testDate: '2044-11-18' }, goals, mastery: {}, banks, attempts: [], schedule, now: NOW });
  assert.ok(plan.aim, 'planen siktar lägre');
  // De viktigaste målen (vikt 3) får aldrig lägre mål än de övriga.
  const t = id => plan.targets[id] || 5;
  for (let g = 0; g < 5; g++) for (let o = 5; o < 20; o++) assert.ok(t('g' + g) >= t('g' + o));
  // Ett litet prov med snabba flervalsfrågor ryms.
  const quick = { g0: banks.g0.map(i => ({ ...i, kind: 'mcq' })) };
  const roomy = buildPlan({ test: { testDate: '2044-11-18' }, goals: goals.slice(0, 1), mastery: {}, banks: quick, attempts: [], schedule, now: NOW });
  assert.equal(roomy.aim, null, 'litet prov: alla mål till högsta nivån');
});

test('missade dagar gör inte passen längre än taket', () => {
  const { goals, banks } = bigTest();
  const schedule = scheduleFor({ birthYear: 2034 }, NOW);
  // Barnet övade första dagen och sedan inget på en vecka.
  const attempts = [{ ts: at('2044-11-07'), goalId: 'g0', kind: 'explain' }];
  const plan = buildPlan({ test: { testDate: '2044-11-18' }, goals, mastery: {}, banks, attempts, schedule, now: NOW });
  for (const d of plan.days.filter(d => !d.off)) assert.ok(d.minutes <= 20);
});

test('helgen är ledig även nära provet, och taket gäller ändå', () => {
  const { goals, banks } = bigTest(3);
  const sat = at('2044-11-19');
  const plan = buildPlan({ test: { testDate: '2044-11-21' }, goals, mastery: {}, banks, attempts: [], schedule: scheduleFor({ birthYear: 2034 }, sat), now: sat });
  assert.ok(plan.days.every(d => d.off), 'lördag och söndag lediga');
  assert.equal(plan.aim, null, 'inga pluggdagar: ingen sänkt ambition att rapportera');
});

test('eget tak som inte är jämnt femtal överskrids aldrig', () => {
  const { goals, banks } = bigTest();
  const plan = buildPlan({ test: { testDate: '2044-11-25' }, goals, mastery: {}, banks, attempts: [], schedule: scheduleFor({ birthYear: 2034, maxMinutes: 12 }, NOW), now: NOW });
  for (const d of plan.days.filter(d => !d.off)) assert.ok(d.minutes <= 12, `${d.key}: ${d.minutes}`);
  assert.equal(ageCap(NaN), 10);
});

test('toggleDay: Ledig och Plugga', () => {
  const sat = { key: '2044-11-19', restDay: true, off: true };
  assert.deepEqual(toggleDay(sat, [], []), { studyDates: ['2044-11-19'] });
  assert.deepEqual(toggleDay({ ...sat, off: false }, [], ['2044-11-19']), { studyDates: [] });
  const mon = { key: '2044-11-14', restDay: false, off: false };
  assert.deepEqual(toggleDay(mon, [], []), { offDates: ['2044-11-14'] });
  assert.deepEqual(toggleDay({ ...mon, off: true }, ['2044-11-14'], []), { offDates: [] });
  // Förälderns lediga dag går före: tas bort först, även för en helgdag.
  assert.deepEqual(toggleDay(sat, ['2044-11-19'], ['2044-11-19']), { offDates: [] });
});

test('studyDates gör en ledig veckodag till pluggdag', () => {
  const { goals, banks } = bigTest(3);
  const plan = buildPlan({ test: { testDate: '2044-11-25' }, goals, mastery: {}, banks, attempts: [], schedule: scheduleFor({ birthYear: 2034 }, NOW), studyDates: ['2044-11-19'], now: NOW });
  assert.equal(plan.days.find(d => d.key === '2044-11-19').off, false);
  assert.equal(plan.days.find(d => d.key === '2044-11-20').off, true);
});

test('pickNext: mål som klarat sin målnivå kommer efter de andra', () => {
  const goals = [{ id: 'a', type: 'samband', weight: 2 }, { id: 'b', type: 'samband', weight: 2 }];
  const banks = { a: [{ id: 'a3', level: 3, kind: 'mcq' }], b: [{ id: 'b3', level: 3, kind: 'mcq' }] };
  const masteryById = { a: { goalId: 'a', level: 3, history: [] }, b: { goalId: 'b', level: 3, history: [] } };
  for (let i = 0; i < 20; i++) {
    // a har målnivå 2 och står på 3: klar. b har ingen sänkt målnivå.
    assert.equal(pickNext({ goals, masteryById, banks, now: NOW, targets: { a: 2 } }).goal.id, 'b');
  }
  // Står målet på sin målnivå är den kvar att klara (som i remainingWork): inget avdrag.
  const picked = new Set();
  for (const r of [0, 0.5, 0.99]) picked.add(pickNext({ goals, masteryById, banks, now: NOW, targets: { a: 3 }, rand: () => r }).goal.id);
  assert.ok(picked.has('a'));
});
