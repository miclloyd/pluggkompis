// AI-rättning av fritextsvar.
//
// Modellval: snabb modell (quick = Haiku på servern) som standard, noggrann modell
// (default = Sonnet) bara när det behövs. Reglerna nedan är hela policyn.
//
//   Lokalt, ingen AI:   tomt svar, "vet inte", ett enda tecken                → 0 poäng direkt
//   Noggrann direkt:    nivå 5 (provlika frågor, längre svar, flera delar)
//   Snabb först, och sedan noggrann om något av detta gäller:
//     - modellen själv anger låg säkerhet
//     - delpoäng (0,5), alltså svaret ligger på gränsen
//     - svaret är långt (mer än 60 ord)
//     - 0 poäng trots ett ordentligt svar (minst 6 ord): ett felaktigt underkänt
//       svar kostar mest för barnet, så det kontrolleras alltid
//   Invändning ("Jag tycker jag hade rätt"): rättas om med noggrann modell om den inte
//   redan användes. Blir det bättre ändras rättningen direkt, annars går den till föräldern.
//   Provläget: alltid noggrann modell (rättas på slutet, så tiden spelar mindre roll).
//
// Stabilitet (2026-11-16, samma svar fick olika poäng i två provlägen):
//   - temperatur 0 (stable) i varje rättningsanrop
//   - samma svar (normaliserat) på samma fråga återanvänder den tidigare rättningen, även
//     förälderns ändrade poäng, i stället för att rättas igen
//
// Modellen svarar bara vilka punkter i bedömningsmallen som uppfylls. Poängen räknas här.

import { gradePrompt, validateGrade } from './prompts.js';
import { normalize } from './engine.js';

export const TIERS = { fast: 'quick', careful: 'default' };
// Rättningsreglernas version. Bara rättningar med samma version (eller förälderns beslut)
// återanvänds av previousGrade; ändras prompten eller reglerna, höj versionen.
export const GRADE_VERSION = 'g2';
const LONG_ANSWER_WORDS = 60;
const SUBSTANTIAL_WORDS = 6;

export const wordCount = s => (String(s).trim().match(/\S+/g) || []).length;

// Resonemang: dragen (sist i mallen) ger inga poäng om fakta inte stämmer (plan 1.6:
// mallen "kräver att fakta stämmer med materialet"). Inga faktapunkter rätt = 0,
// några = högst delpoäng.
export function scoreFor(item, met) {
  const k = item?.moves?.length ? item.must.length - item.moves.length : met.length;
  const facts = met.slice(0, k);
  if (k > 0 && k < met.length) {
    if (!facts.some(Boolean)) return 0;
    if (!facts.every(Boolean)) return Math.min(0.5, scoreFromMet(met));
  }
  return scoreFromMet(met);
}

export function scoreFromMet(met) {
  const n = met.filter(Boolean).length;
  if (n === met.length) return 1;
  if (n * 2 >= met.length) return 0.5;
  return 0;
}

const verdictOf = score => (score >= 1 ? 'right' : score > 0 ? 'almost' : 'wrong');

// Frågans nyckel: frågetexten och mallen. Ändras frågan eller mallen återanvänds inget.
export function questionKey(item) {
  const t = `${item.q}|${(item.must || []).join('|')}`;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const PARENT = ['accepted', 'partial', 'rejected'];

// Punkter som stämmer med en poäng som föräldern satt: alla vid rätt, hälften vid delvis rätt.
function metFor(item, score) {
  const n = item.must.length;
  const k = score >= 1 ? n : score > 0 ? Math.floor(n / 2) : 0; // delvis rätt med en punkt: punkten saknas
  return item.must.map((_, i) => i < k);
}

// Tidigare rättning av samma svar på samma fråga, eller null. Det som återanvänds:
//   - förälderns beslut (Rätt, Delvis rätt, Rättningen stämmer), även på ett återanvänt svar
//   - AI-rättningar med dagens regler (GRADE_VERSION); med careful (provläget) bara den noggranna
//     modellens. Inte barnets egen bedömning, inte en rättning som barnet bestridit och som
//     ingen tagit ställning till, och inget när frågan eller mallen har ändrats.
export function previousGrade(item, answer, attempts = [], { careful = false } = {}) {
  const key = normalize(answer);
  if (!key) return null;
  const qk = questionKey(item);
  const hit = attempts
    .filter(a => {
      if (a.itemId !== item.id || !a.grading || typeof a.answer !== 'string' || normalize(a.answer) !== key) return false;
      if (a.grading.qk !== qk) return false; // äldre rättningar utan nyckel återanvänds inte
      if (PARENT.includes(a.resolved)) return true;
      if (a.disputed && !a.resolved) return false; // bestridd och inte avgjord (ai-accepted = omprövad)
      if (a.grading.v !== GRADE_VERSION || ['själv', 'tidigare'].includes(a.grading.tier)) return false;
      return !careful || a.grading.tier === TIERS.careful;
    })
    .sort((a, b) => b.ts - a.ts)[0];
  if (!hit) return null;
  const score = Number(hit.score) || 0;
  // Har föräldern ändrat poängen stämmer AI:ns punkter och kommentar inte längre.
  const changed = (hit.resolved === 'accepted' || hit.resolved === 'partial') && hit.originalScore !== score;
  return {
    score, verdict: verdictOf(score),
    met: !changed && hit.grading.met?.length === item.must.length ? hit.grading.met : metFor(item, score),
    feedback: changed ? 'En vuxen har bedömt det här svaret.' : hit.grading.feedback || '',
    confidence: 'hög', tier: 'tidigare', escalated: false, calls: 0, reused: hit.id, qk, v: GRADE_VERSION,
  };
}

export function isTrivial(answer) {
  const t = String(answer || '').trim().toLowerCase();
  return t.length < 2 || /^(vet inte|vet ej|ingen aning|\?+|-+|\.+)$/.test(t);
}

export function needsCareful({ level, words, result }) {
  if (result.confidence === 'låg') return 'låg säkerhet';
  if (result.score === 0.5) return 'delpoäng';
  if (words > LONG_ANSWER_WORDS) return 'långt svar';
  if (result.score === 0 && words >= SUBSTANTIAL_WORDS) return 'underkänt trots ordentligt svar';
  return null;
}

async function gradeOnce(ai, test, item, answer, tier) {
  const prompt = gradePrompt({ test, item, answer });
  let out = await ai.complete({ prompt, json: true, tier, stable: true });
  let v = validateGrade(out.json, item);
  if (!v.ok) {
    out = await ai.complete({ prompt: `${prompt}\n\nSvara med exakt ${item.must.length} värden i "met".`, json: true, tier, stable: true });
    v = validateGrade(out.json, item);
    if (!v.ok) throw Object.assign(new Error('Rättningen gav ett svar som inte gick att läsa.'), { code: 'invalid_json' });
  }
  const score = scoreFor(item, v.met);
  return { score, verdict: verdictOf(score), met: v.met, feedback: v.feedback, confidence: v.confidence, tier, v: GRADE_VERSION, qk: questionKey(item) };
}

// Returnerar { score, verdict, met, feedback, confidence, tier, escalated, reason, calls }
//   attempts: tidigare svar på provet (för previousGrade); careful: noggrann modell direkt (provläget)
export async function gradeFree({ ai, test, item, answer, attempts = [], careful = false }) {
  if (isTrivial(answer)) {
    return { score: 0, verdict: 'wrong', met: item.must.map(() => false), feedback: 'Försök skriva det du kommer ihåg, även om du är osäker.', confidence: 'hög', tier: 'lokal', escalated: false, calls: 0 };
  }
  const prev = previousGrade(item, answer, attempts, { careful });
  if (prev) return { ...prev, reason: 'samma svar som tidigare' };
  if (careful || item.level >= 5) {
    const r = await gradeOnce(ai, test, item, answer, TIERS.careful);
    return { ...r, escalated: false, reason: careful ? 'provläge' : 'nivå 5', calls: 1 };
  }
  const first = await gradeOnce(ai, test, item, answer, TIERS.fast);
  const reason = needsCareful({ level: item.level, words: wordCount(answer), result: first });
  if (!reason) return { ...first, escalated: false, calls: 1 };
  const second = await gradeOnce(ai, test, item, answer, TIERS.careful);
  return { ...second, escalated: true, reason, firstScore: first.score, calls: 2 };
}

// Omprövning vid invändning. Returnerar null om noggrann modell redan rättat svaret.
export async function regradeOnDispute({ ai, test, item, answer, previous }) {
  if (previous.tier === TIERS.careful || previous.tier === 'lokal') return null;
  const r = await gradeOnce(ai, test, item, answer, TIERS.careful);
  return { ...r, escalated: true, reason: 'invändning', calls: 1 };
}
