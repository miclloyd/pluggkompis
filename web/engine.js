// Pedagogisk motor: nivåer, mastery, Leitner-repetition, urval och lokal rättning.
// Ren logik utan DOM och utan lagring, så den kan testas direkt.

export const GOAL_TYPES = ['begrepp', 'fakta', 'samband', 'resonemang', 'glosa'];
export const TYPE_LABEL = {
  begrepp: 'Begrepp', fakta: 'Fakta', samband: 'Samband', resonemang: 'Resonemang', glosa: 'Glosa',
};

// Högsta nivå per måltyp. Fakta och begrepp är klara efter nivå 3 (förstå), glosor efter
// nivå 4 (använda ordet i en mening), samband och resonemang går hela vägen till nivå 5.
export const TYPE_MAX = { begrepp: 3, fakta: 3, glosa: 4, samband: 5, resonemang: 5 };

// Frågetyper som rättas av AI (fritext). Övriga rättas lokalt.
export const FREE_KINDS = ['short', 'explain', 'sentence'];
export const isFree = item => FREE_KINDS.includes(item?.kind);

// Högsta nivå som kan övas just nu: måltypens tak, men aldrig högre än vad frågebanken har frågor för.
export function practiceMax(goal, bank) {
  const typeMax = TYPE_MAX[goal.type] || 3;
  if (!bank) return typeMax;
  const top = bank.reduce((a, i) => Math.max(a, i.level), 0);
  return Math.max(1, Math.min(typeMax, top || 1));
}

// Ett mål som var klart på en lägre nivå fortsätter uppåt när frågor för nästa nivå finns.
export function refreshMastery(goal, m, bank) {
  if (!m || !m.passedMax) return m;
  const max = practiceMax(goal, bank);
  if (m.level >= max) return m;
  return { ...m, level: m.level + 1, levelN: 0, passedMax: false, missStreak: 0, due: 0 };
}

const DAY = 864e5;
const BOX_DAYS = [0, 1, 3, 7];          // Leitner: låda 0 = samma pass, sedan 1, 3, 7 dagar
const RETRY_MS = 4 * 60e3;              // en miss kommer tillbaka efter några minuter

export function shrinkFactor(now, testDate) {
  if (!testDate) return 1;
  const daysLeft = (Date.parse(testDate) - now) / DAY;
  return Math.min(1, Math.max(0.15, daysLeft / 14));
}

export function newMastery(goalId) {
  return { goalId, level: 1, history: [], missStreak: 0, box: 0, due: 0, passedMax: false, seen: {} };
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Regler för nivåbyte:
//   Upp:        minst 4 poäng på de 5 senaste svaren på nivån
//   Snabbspår:  de 3 första svaren på en nivå är alla rätt
//   Ned:        3 missar i rad
//   Eget hopp:  provperiod på 3 svar; 2 missar ger tillbaka till nivån man kom från, utan
//               annan förlust, och spärrar nytt hopp till nästa dag eller 3 rätt i rad
export const FAST_TRACK = 3;
export const JUMP_MIN_RIGHT = 2;
const JUMP_TRIAL = 3;
const JUMP_TRIAL_MISSES = 2;

function changeLevel(next, level) {
  next.level = level;
  next.levelN = 0;
  next.missStreak = 0;
}

export function applyResult(m, goal, { score, itemId, now, testDate, max: maxIn }) {
  const next = { ...m, history: [...(m.history || [])], seen: { ...(m.seen || {}) }, jumps: [...(m.jumps || [])] };
  const max = maxIn ?? practiceMax(goal);
  next.history.push({ l: m.level, s: score, t: now });
  if (next.history.length > 12) next.history = next.history.slice(-12);
  if (itemId) next.seen[itemId] = now;
  next.lastPracticed = now;
  next.levelN = (m.levelN || 0) + 1;

  let event = null;
  if (score >= 1) next.missStreak = 0;
  else if (score === 0) next.missStreak = (m.missStreak || 0) + 1;

  if (next.jumpBlock) next.jumpBlock = { ...next.jumpBlock, streak: score >= 1 ? (next.jumpBlock.streak || 0) + 1 : 0 };

  // Provperiod efter eget hopp
  let trialDone = false;
  if (m.jump && m.level === m.jump.to) {
    const j = { ...m.jump, n: m.jump.n + 1, misses: m.jump.misses + (score === 0 ? 1 : 0) };
    const last = next.jumps.length - 1;
    if (j.misses >= JUMP_TRIAL_MISSES) {
      next.history = next.history.filter(h => h.l !== m.level);
      changeLevel(next, j.from);
      next.levelN = next.history.filter(h => h.l === j.from).length;
      next.jump = null;
      next.passedMax = false;
      next.jumpBlock = { day: dayKey(now), streak: 0 };
      if (last >= 0) next.jumps[last] = { ...next.jumps[last], held: false };
      event = 'jumpBack';
      trialDone = true;
    } else if (j.n >= JUMP_TRIAL) {
      next.jump = null;
      if (last >= 0) next.jumps[last] = { ...next.jumps[last], held: true };
    } else {
      next.jump = j;
    }
  }

  if (!trialDone) {
    const atLevel = next.history.filter(h => h.l === next.level).slice(-5);
    const sum = atLevel.reduce((a, h) => a + h.s, 0);
    const fast = next.levelN === FAST_TRACK && atLevel.length >= FAST_TRACK && atLevel.slice(-FAST_TRACK).every(h => h.s >= 1);
    if ((atLevel.length >= 5 && sum >= 4) || fast) {
      if (next.level < max) {
        next.history = next.history.filter(h => h.l !== m.level);
        changeLevel(next, next.level + 1);
        next.jump = null;
        event = fast ? 'fast' : 'up';
      } else if (!next.passedMax) { next.passedMax = true; event = 'mastered'; }
    } else if (next.missStreak >= 3 && next.level > 1 && !next.jump) {
      changeLevel(next, next.level - 1);
      event = 'down';
      next.passedMax = false;
    }
  }

  const f = shrinkFactor(now, testDate);
  if (score >= 1) {
    next.box = Math.min(BOX_DAYS.length - 1, (m.box || 0) + 1);
    next.due = now + BOX_DAYS[next.box] * DAY * f;
  } else {
    next.box = 0;
    next.due = now + RETRY_MS;
  }
  return { mastery: next, event };
}

// Räknar fram ett måls mastery från alla sparade svar, i tidsordning. Används när en förälder
// ändrar rättningen av ett svar, så att nivån blir som om svaret hade rättats så från början.
// events: händelser som också påverkar nivån, i dag bara egna hopp ({ type:'jump', goalId, ts }).
export function replayMastery(goal, attempts, testDate, bank, events = []) {
  let m = newMastery(goal.id);
  // Svar där barnet tittade i materialet först, och svar i provläget, påverkar inte nivån.
  const own = [
    ...attempts.filter(a => a.goalId === goal.id && !a.helped && !a.exam).map(a => ({ ...a, _t: 'answer' })),
    ...events.filter(e => e.goalId === goal.id && e.type === 'jump').map(e => ({ ...e, _t: 'jump' })),
  ].sort((a, b) => a.ts - b.ts);
  // Nivåtaket är frågebanken som den ser ut nu; frågor för högre nivåer finns bara när de skapats.
  const max = practiceMax(goal, bank);
  for (const a of own) {
    if (a._t === 'jump') { if (m.level < max) m = jumpUp(m, a.ts); continue; }
    m = applyResult(m, goal, { score: a.score, itemId: a.itemId, now: a.ts, testDate, max }).mastery;
  }
  return m;
}

export function rightAtLevel(m) {
  return (m?.history || []).filter(h => h.l === m.level && h.s >= 1).length;
}

// firstDay: dagen barnet först övade på provet. Hopp finns inte den dagen.
export function canJump(goal, m, bank, { now, firstDay }) {
  if (!m) return { ok: false, why: 'Inte övat än' };
  const max = practiceMax(goal, bank);
  if (m.level >= max) return { ok: false, why: 'Högsta nivån' };
  if (m.jump) return { ok: false, why: 'Provar redan en högre nivå' };
  if (!firstDay || dayKey(now) === firstDay) return { ok: false, why: 'Första dagen' };
  if (rightAtLevel(m) < JUMP_MIN_RIGHT) return { ok: false, why: `Behöver ${JUMP_MIN_RIGHT} rätt på nivån först` };
  if (m.jumpBlock && m.jumpBlock.day === dayKey(now) && (m.jumpBlock.streak || 0) < 3) return { ok: false, why: 'Försök igen i morgon' };
  return { ok: true, to: m.level + 1 };
}

export function jumpUp(m, now) {
  const next = { ...m, jumps: [...(m.jumps || [])] };
  changeLevel(next, m.level + 1);
  next.passedMax = false;
  next.due = 0;
  next.jumpBlock = null;
  next.jump = { from: m.level, to: m.level + 1, n: 0, misses: 0, at: now };
  next.jumps.push({ from: m.level, to: m.level + 1, at: now, held: null });
  return next;
}

export function goalProgress(goal, m, bank) {
  const max = practiceMax(goal, bank);
  if (!m) return 0;
  if (m.level < max && m.passedMax) return (m.level) / max;
  if (m.passedMax) return 1;
  const atLevel = (m.history || []).filter(h => h.l === m.level).slice(-5);
  const partial = Math.min(1, atLevel.reduce((a, h) => a + h.s, 0) / 4);
  return Math.min(0.99, ((m.level - 1) + partial) / max);
}

export function testProgress(goals, masteryById, banks = {}) {
  if (!goals.length) return 0;
  return goals.reduce((a, g) => a + goalProgress(g, masteryById[g.id], banks[g.id]), 0) / goals.length;
}

// Väljer nästa mål och fråga. Mål som inte är klara går först, lägst nivå och tidigast
// förfallna före andra; vikt 1–3 ger tyngre mål fler frågor. Klara mål kommer tillbaka
// bara när de förfaller (repetition).
// Flerval där ett felaktigt alternativ är en felstavning av rätt svar ("moské", "moskè", "mosske").
// Forskningen visar att barn som ser felstavningar oftare stavar fel själva efteråt, så sådana
// frågor används inte, även om de redan finns i en äldre frågebank.
export function hasSpellingLure(item) {
  if (item.kind !== 'mcq' || !Array.isArray(item.options)) return false;
  const right = stripAccents(normalize(item.options[item.answer] || ''));
  // Bara enstaka ord: "Tre gånger"/"Fem gånger" eller "11 dagar"/"7 dagar" är inga felstavningar.
  if (right.length < 3 || /\s|\d/.test(right)) return false;
  return item.options.some((o, i) => {
    if (i === item.answer) return false;
    const n = stripAccents(normalize(o));
    if (/\s|\d/.test(n)) return false;
    return n !== right && levenshtein(n, right) <= Math.max(1, Math.round(right.length * 0.3));
  });
}

export function pickNext({ goals, masteryById, banks, recent = [], now, rand = Math.random }) {
  const candidates = [];
  for (const g of goals) {
    const m = refreshMastery(g, masteryById[g.id], banks[g.id]) || newMastery(g.id);
    const atLevel = (banks[g.id] || []).filter(it => it.level === m.level);
    const clean = atLevel.filter(it => !hasSpellingLure(it));
    const items = clean.length ? clean : atLevel;
    if (!items.length) continue;
    const due = (m.due || 0) <= now;
    if (m.passedMax && !due) continue;
    const recentGoal = recent.slice(-2).some(r => r.goalId === g.id);
    let score = 0;
    score += m.passedMax ? 0 : 100;
    score += due ? 40 : 0;
    score -= m.level * 10;
    score += (g.weight || 2) * 6;
    score -= recentGoal ? 60 : 0;
    score += rand() * 12;
    candidates.push({ g, m, items, score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const { g, m, items } = candidates[0];
  const recentIds = new Set(recent.map(r => r.itemId));
  const ranked = items
    .map(it => ({ it, last: (m.seen || {})[it.id] || 0, inRecent: recentIds.has(it.id) }))
    .sort((a, b) => (a.inRecent - b.inRecent) || (a.last - b.last) || (rand() - 0.5));
  return { goal: g, mastery: m, item: ranked[0].it };
}

export function allMastered(goals, masteryById, banks = {}) {
  return goals.length > 0 && goals.every(g => {
    const m = masteryById[g.id];
    return m?.passedMax && m.level >= practiceMax(g, banks[g.id]);
  });
}

// ---- Lokal rättning ----

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[.,!?;:"'“”«»()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Redigeringsavstånd där en omkastning av två bokstäver räknas som ett fel ("grundämen").
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

// Jämför ett skrivet svar med facit. Versaler ignoreras. Fel accent eller ett stavfel i ett
// längre ord ger "nästan rätt" (0,5).
export function compareText(given, answers) {
  const g = normalize(given);
  if (!g) return { score: 0, verdict: 'wrong' };
  const list = answers.map(normalize).filter(Boolean);
  if (list.includes(g)) return { score: 1, verdict: 'right' };
  const gs = stripAccents(g);
  for (const a of list) {
    if (stripAccents(a) === gs) return { score: 0.5, verdict: 'almost', note: 'Kolla prickarna och accenterna.' };
  }
  // Dubbelbokstäver ("immam", "mosske") ger aldrig ett annat ord, så de räknas som stavfel
  // även i korta ord. Andra stavfel godtas bara i ord på minst fem bokstäver, där ett fel
  // inte lika lätt gör det till ett annat ord.
  const single = s => s.replace(/(.)\1+/g, '$1');
  for (const a of list) {
    const as = stripAccents(a);
    if (single(as) === single(gs) || (a.length >= 5 && levenshtein(as, gs) <= 1)) {
      return { score: 0.5, verdict: 'almost', note: 'Nästan, kolla stavningen.' };
    }
  }
  return { score: 0, verdict: 'wrong' };
}

// answer har olika form per frågetyp:
//   mcq: index i item.options     cloze/write: text     match: { vänster: höger }
export function gradeLocal(item, answer) {
  switch (item.kind) {
    case 'mcq': {
      const ok = answer === item.answer;
      return { score: ok ? 1 : 0, verdict: ok ? 'right' : 'wrong' };
    }
    case 'cloze':
    case 'write':
    case 'dictation':
      return compareText(answer, [item.answer, ...(item.accept || [])]);
    case 'match': {
      const pairs = item.pairs || [];
      const right = pairs.filter(([l, r]) => (answer || {})[l] === r).length;
      if (right === pairs.length) return { score: 1, verdict: 'right' };
      if (right >= Math.ceil(pairs.length / 2)) {
        return { score: 0.5, verdict: 'almost', note: `${right} av ${pairs.length} par rätt.` };
      }
      return { score: 0, verdict: 'wrong', note: `${right} av ${pairs.length} par rätt.` };
    }
    case 'sort': {
      // answer: { påstående: kategori }. Högst ett fel ger nästan rätt.
      const list = item.items || [];
      const right = list.filter(([t, c]) => (answer || {})[t] === c).length;
      if (right === list.length) return { score: 1, verdict: 'right' };
      if (right >= list.length - 1) return { score: 0.5, verdict: 'almost', note: `${right} av ${list.length} rätt sorterade.` };
      return { score: 0, verdict: 'wrong', note: `${right} av ${list.length} rätt sorterade.` };
    }
    case 'order': return gradeOrder(item.steps || [], answer);
    default:
      return { score: 0, verdict: 'wrong' };
  }
}

// Sätt i ordning (materialprofil fakta: tidslinjer, förlopp). answer: stegen i barnets
// ordning. Rätt ordning ger 1; ett steg på fel ställe (längsta rätt ordnade följd är
// n − 1) ger nästan rätt.
export function gradeOrder(steps, answer) {
  const a = Array.isArray(answer) ? answer : [];
  const n = steps.length;
  if (n && a.length === n && a.every((s, i) => s === steps[i])) return { score: 1, verdict: 'right' };
  const pos = a.map(s => steps.indexOf(s)).filter(i => i >= 0);
  // Längsta stigande delföljd = flest steg som redan står i rätt inbördes ordning.
  const tails = [];
  for (const x of pos) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;
  }
  const inPlace = a.filter((s, i) => s === steps[i]).length;
  const note = `${inPlace} av ${n} på rätt plats.`;
  if (n >= 3 && a.length === n && tails.length >= n - 1) return { score: 0.5, verdict: 'almost', note };
  return { score: 0, verdict: 'wrong', note };
}

export function correctAnswerText(item) {
  if (isFree(item)) return item.answer;
  switch (item.kind) {
    case 'mcq': return item.options[item.answer];
    case 'cloze':
    case 'write':
    case 'dictation': return item.answer;
    case 'match': return item.pairs.map(([l, r]) => `${l} – ${r}`).join('\n');
    case 'sort': return item.categories.map(c => `${c}: ${item.items.filter(i => i[1] === c).map(i => i[0]).join('; ')}`).join('\n');
    case 'order': return item.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    default: return '';
  }
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
