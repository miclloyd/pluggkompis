// Dagsplan: hur många minuter varje dag fram till provet, och hur många nya mål som introduceras.
// Ren logik. Planen räknas om varje gång från läget just nu, så den anpassar sig om barnet
// ligger före eller efter.
//
//   Bekanta    de första dagarna: korta pass, nivå 1, några nya mål i taget
//   Bygga      huvuddelen: längst pass, framtungt
//   Befästa    näst sista dagarna: svaga mål och repetition
//   Lugnt      dagen före provet: kort repetition, inget nytt

import { practiceMax, dayKey } from './engine.js';
import { gradeOf } from './grade.js';

export const DEFAULT_SCHEDULE = { trainingDays: [], training: [15, 30], free: [20, 60] };
export const REST_DAYS = [5, 6]; // lördag och söndag: ingen dagsplan om inget annat är valt

// Ledig/Plugga för en dag i provets plan (förälderns knapp). offDates går före allt; en ledig
// veckodag (schedule.restDays) blir pluggdag via studyDates. Returnerar ändringen av provet.
export function toggleDay(day, offDates = [], studyDates = []) {
  const without = (l, k) => l.filter(x => x !== k);
  if (offDates.includes(day.key)) return { offDates: without(offDates, day.key) };
  if (day.restDay && studyDates.includes(day.key)) return { studyDates: without(studyDates, day.key) };
  if (day.off && day.restDay) return { studyDates: [...studyDates, day.key] };
  return { offDates: [...offDates, day.key] };
}

// Tak per dag efter årskurs. Skolan är den stora källan till kunskap; hemmaplugget är ett
// komplement och ska rymmas klart under tumregeln 10 minuter × årskurs för allt hemarbete
// (läxor inräknade). Taket gäller alltid: räcker tiden inte sänks ambitionen, inte vilan.
export function ageCap(grade) {
  if (!Number.isFinite(grade)) return 10; // okänd årskurs: lägsta taket
  return grade <= 3 ? 10 : grade <= 6 ? 20 : 30;
}

// Schemat som planen räknar med: profilens val, standard för det som saknas, dagstaket
// (profilens maxMinutes eller taket för årskursen) och lediga veckodagar.
export function scheduleFor(profile, now = Date.now()) {
  const s = { ...DEFAULT_SCHEDULE, ...(profile?.schedule || {}) };
  const own = Number(profile?.maxMinutes);
  return { ...s, cap: own > 0 ? own : ageCap(gradeOf(profile, new Date(now))), restDays: s.restDays ?? REST_DAYS };
}

// Ambition när allt inte ryms inom taket: först lägre mål för mål med lägre vikt, sedan för alla.
// Vikt 3 = de viktigaste målen enligt läraren/underlaget.
const AMBITION = [
  { label: null, target: () => null },
  { label: 'Mål med lägre vikt övas till nivå 3.', target: g => ((g.weight || 2) < 3 ? 3 : null) },
  { label: 'Mål med lägre vikt övas till nivå 2.', target: g => ((g.weight || 2) < 3 ? 2 : null) },
  { label: 'De viktigaste målen övas till nivå 3, övriga till nivå 2.', target: g => ((g.weight || 2) < 3 ? 2 : 3) },
  { label: 'Alla mål övas till nivå 2.', target: () => 2 },
];
export const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']; // index 0 = måndag

const PHASE = {
  bekanta: { label: 'Bekanta', weight: 0.6 },
  bygga: { label: 'Bygga', weight: 1.3 },
  befasta: { label: 'Befästa', weight: 0.9 },
  lugnt: { label: 'Lugnt', weight: 0.35 },
};
export const PHASE_LABEL = Object.fromEntries(Object.entries(PHASE).map(([k, v]) => [k, v.label]));

// Sekunder per svar om barnet inte har egen historik än.
const DEFAULT_SEC = { mcq: 15, match: 40, cloze: 25, write: 20, short: 60, explain: 120, sentence: 50, order: 40, dictation: 20, math: 45 };
// Svar som behövs per nivå: med snabbspår ofta 3, annars 5. Långa fritextsvar och glosor
// behöver färre, eftersom varje svar tar längre tid eller målet är litet.
function answersFor(goal, level) {
  if (goal.type === 'glosa') return level >= 4 ? 2 : 3;
  if (level >= 4) return 3;
  if (level === 3) return 4;
  return 4.5;
}
const MISS_FACTOR = 1.25;

const weekdayIdx = d => (new Date(d + 'T12:00:00').getDay() + 6) % 7;

// Barnets eget tempo per frågetyp: median av tiden mellan svar, bara svar i följd (< 3 min).
export function secondsPerAnswer(attempts) {
  const sorted = attempts.slice().sort((a, b) => a.ts - b.ts);
  const gaps = {};
  for (let i = 1; i < sorted.length; i++) {
    const g = (sorted[i].ts - sorted[i - 1].ts) / 1000;
    if (g > 2 && g < 180) (gaps[sorted[i].kind] ||= []).push(g);
  }
  const out = { ...DEFAULT_SEC };
  for (const [k, list] of Object.entries(gaps)) {
    if (list.length >= 3) { list.sort((a, b) => a - b); out[k] = list[Math.floor(list.length / 2)]; }
  }
  return out;
}

// Minuter övade en viss dag, räknat på samma sätt som tempot.
export function minutesOnDay(attempts, key) {
  const day = attempts.filter(a => dayKey(a.ts) === key).sort((a, b) => a.ts - b.ts);
  let sec = 0;
  for (let i = 0; i < day.length; i++) {
    const g = i ? (day[i].ts - day[i - 1].ts) / 1000 : Infinity;
    sec += g < 180 ? g : 20;
  }
  return Math.round(sec / 60);
}

// Återstående arbete i sekunder: nivåer kvar per mål, gånger svar per nivå och tempo.
//   targets: högsta nivå att öva till per mål (saknas = målets högsta nivå)
export function remainingWork({ goals, mastery, banks, secs, targets = {} }) {
  let seconds = 0;
  for (const g of goals) {
    const bank = banks[g.id] || [];
    const top = practiceMax(g, bank);
    const max = targets[g.id] ? Math.min(top, targets[g.id]) : top;
    const m = mastery[g.id];
    const level = m?.level || 1;
    if (m?.passedMax && level >= top) continue;
    if (level > max) continue;
    for (let l = level; l <= max; l++) {
      const items = bank.filter(i => i.level === l);
      if (!items.length) continue;
      const avg = items.reduce((a, i) => a + (secs[i.kind] || 30), 0) / items.length;
      const done = l === level ? (m?.history || []).filter(h => h.l === l && h.s >= 1).length : 0;
      seconds += Math.max(1, answersFor(g, l) - done) * avg * MISS_FACTOR;
    }
  }
  // Repetition: ungefär hälften av målen kommer upp en gång per dag, som klickfråga.
  const repetitionPerDay = goals.length * 0.5 * (secs.mcq || 15);
  return { seconds, repetitionPerDay };
}

function phases(n) {
  if (n <= 0) return [];
  if (n === 1) return ['lugnt'];
  if (n === 2) return ['bygga', 'lugnt'];
  if (n === 3) return ['bekanta', 'bygga', 'lugnt'];
  const bekanta = n >= 8 ? 2 : 1;
  const befasta = n >= 7 ? 2 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1) out.push('lugnt');
    else if (i < bekanta) out.push('bekanta');
    else if (i >= n - 1 - befasta) out.push('befasta');
    else out.push('bygga');
  }
  return out;
}

const round5 = x => Math.max(5, Math.round(x / 5) * 5);

// Bygger planen från i dag till dagen före provet.
//   offDates:   dagar utan plugg ('YYYY-MM-DD')
//   studyDates: lediga veckodagar (schedule.restDays) som ändå blir pluggdagar
//   schedule:   helst scheduleFor(profile): med cap (minuter per dag) och restDays
export function buildPlan({ test, goals, mastery, banks, attempts, schedule = DEFAULT_SCHEDULE, offDates = [], studyDates = [], now = Date.now() }) {
  if (!test.testDate) return null;
  const today = dayKey(now);
  // Planen börjar första övningsdagen, så faserna står still när planen räknas om.
  const firstPractice = attempts.reduce((k, a) => { const d = dayKey(a.ts); return !k || d < k ? d : k; }, null);
  const start = firstPractice && firstPractice < today ? firstPractice : today;
  const allDays = [];
  for (let t = Date.parse(start + 'T12:00:00'); dayKey(t) < test.testDate; t += 864e5) {
    const key = dayKey(t);
    const wd = weekdayIdx(key);
    const restDay = (schedule.restDays || []).includes(wd);
    allDays.push({ key, weekday: wd, past: key < today, restDay, off: offDates.includes(key) || (restDay && !studyDates.includes(key)), training: (schedule.trainingDays || []).includes(wd) });
  }
  for (const d of allDays) d.done = minutesOnDay(attempts, d.key);
  const days = allDays.filter(d => !d.past);
  if (!days.length) return { days, allDays, start, tooLate: true, totalMinutes: 0, shortfall: 0 };

  const ph = phases(allDays.filter(d => !d.off).length);
  allDays.filter(d => !d.off).forEach((d, i) => { d.phase = ph[i]; });
  const active = days.filter(d => !d.off);
  const activeAll = allDays.filter(d => !d.off);
  const introEnd = activeAll[Math.max(0, Math.ceil(activeAll.length * 0.4) - 1)]?.key || today;

  const secs = secondsPerAnswer(attempts);
  const doneToday = minutesOnDay(attempts, today);
  const cap = schedule.cap > 0 ? schedule.cap : Infinity;

  // Fördela efter vikt, inom dagens tak. Bekanta-dagar hålls på lägsta nivån i spannet,
  // lugna dagar högst 15 minuter. Taket (cap) gäller alla dagar.
  const caps = active.map(d => {
    const [lo0, hi0] = d.training ? schedule.training : schedule.free;
    const hi = Math.min(hi0, cap);
    const lo = Math.min(lo0, hi);
    if (d.phase === 'bekanta') return [Math.min(10, lo), lo];
    if (d.phase === 'lugnt') return [5, Math.min(15, lo)];
    return [Math.min(10, lo), hi];
  });
  // Den högsta ambitionen som ryms inom dagarnas tak (minus det som redan är gjort i dag).
  const room = caps.reduce((a, c) => a + c[1], 0) - doneToday;
  let aim = AMBITION[0], targets = {}, work;
  for (const step of active.length ? AMBITION : AMBITION.slice(0, 1)) {
    const t = {};
    for (const g of goals) { const v = step.target(g); if (v) t[g.id] = v; }
    const w = remainingWork({ goals, mastery, banks, secs, targets: t });
    aim = step; targets = t; work = w;
    if ((w.seconds + w.repetitionPerDay * active.length) / 60 <= room + 0.5) break;
  }
  if (!active.length) return { days, allDays, start, introEnd, today: null, totalMinutes: Math.round(work.seconds / 60), shortfall: Math.round(work.seconds / 60), secs, cap, aim: aim.label, targets };
  const needMin = (work.seconds + work.repetitionPerDay * active.length) / 60 + doneToday;
  const w = active.map(d => PHASE[d.phase].weight);
  let base = needMin / w.reduce((a, b) => a + b, 0);
  let mins = active.map((_, i) => Math.min(caps[i][1], Math.max(caps[i][0], w[i] * base)));
  // Det som inte rymdes på en dag läggs på dagar med utrymme kvar, i första hand de tidiga.
  for (let pass = 0; pass < 3; pass++) {
    const short = needMin - mins.reduce((a, b) => a + b, 0);
    if (short <= 0.5) break;
    const room = active.map((d, i) => (d.phase === 'bygga' || d.phase === 'befasta' ? caps[i][1] - mins[i] : 0));
    const total = room.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    mins = mins.map((m, i) => m + Math.min(room[i], short * room[i] / total));
  }
  // Hela femminuter, men aldrig över dagens tak (ett eget tak kan vara t.ex. 12).
  active.forEach((d, i) => { d.minutes = Math.min(caps[i][1], round5(mins[i])); d.range = caps[i]; });
  const planned = active.reduce((a, d) => a + d.minutes, 0);

  return {
    days,
    allDays,
    start,
    introEnd,
    today: days[0].key === today && !days[0].off ? days[0] : null,
    totalMinutes: Math.round(needMin),
    shortfall: Math.max(0, Math.round(needMin - planned)),
    secs,
    cap,          // minuter per dag som mest
    aim: aim.label, // null = alla mål till högsta nivån; annars vad planen siktar på
    targets,      // målnivå per mål när ambitionen är sänkt
  };
}

// Vilka mål barnet får öva i dag. Nya mål introduceras några i taget, så att början känns
// hanterbar: alla mål ska vara introducerade efter ungefär 40 % av dagarna fram till provet.
// Ligger barnet före (alla introducerade mål på nivå 2 eller högre) släpps fler fram.
export function allowedGoals({ goals, mastery, attempts, plan, now = Date.now() }) {
  const today = dayKey(now);
  const firstSeen = {};
  for (const a of attempts) {
    const k = dayKey(a.ts);
    if (!firstSeen[a.goalId] || k < firstSeen[a.goalId]) firstSeen[a.goalId] = k;
  }
  const ordered = goals.slice().sort((a, b) => (b.weight || 2) - (a.weight || 2) || (a.order || 0) - (b.order || 0));
  const before = ordered.filter(g => firstSeen[g.id] && firstSeen[g.id] < today);
  const startedToday = ordered.filter(g => firstSeen[g.id] === today);
  const untouched = ordered.filter(g => !firstSeen[g.id]);
  const unintroducedAtStart = untouched.length + startedToday.length;

  let perDay;
  if (plan?.days?.length) {
    // Aktiva dagar från i dag till och med slutet av introduktionen (40 % av hela planen).
    const introDays = Math.max(1, plan.days.filter(d => !d.off && d.key <= (plan.introEnd || today)).length);
    perDay = Math.ceil(unintroducedAtStart / introDays);
  } else {
    perDay = 5;
  }
  if (!before.length) perDay = Math.max(perDay, 4); // första dagen: minst fyra mål att jobba med

  let budget = Math.max(0, perDay - startedToday.length);
  let allowed = [...before, ...startedToday, ...untouched.slice(0, budget)];
  const rest = untouched.slice(budget);
  const ahead = allowed.length > 0 && allowed.every(g => (mastery[g.id]?.level || 1) >= 2 || mastery[g.id]?.passedMax);
  if (ahead && rest.length) allowed = [...allowed, ...rest.slice(0, 2)];
  return { allowed, newToday: Math.min(perDay, unintroducedAtStart), remaining: rest.length };
}
