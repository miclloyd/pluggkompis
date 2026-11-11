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
//
// Modellen svarar bara vilka punkter i bedömningsmallen som uppfylls. Poängen räknas här.

import { gradePrompt, validateGrade } from './prompts.js';

export const TIERS = { fast: 'quick', careful: 'default' };
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
  let out = await ai.complete({ prompt, json: true, tier });
  let v = validateGrade(out.json, item);
  if (!v.ok) {
    out = await ai.complete({ prompt: `${prompt}\n\nSvara med exakt ${item.must.length} värden i "met".`, json: true, tier });
    v = validateGrade(out.json, item);
    if (!v.ok) throw Object.assign(new Error('Rättningen gav ett svar som inte gick att läsa.'), { code: 'invalid_json' });
  }
  const score = scoreFor(item, v.met);
  return { score, verdict: verdictOf(score), met: v.met, feedback: v.feedback, confidence: v.confidence, tier };
}

// Returnerar { score, verdict, met, feedback, confidence, tier, escalated, reason, calls }
export async function gradeFree({ ai, test, item, answer }) {
  if (isTrivial(answer)) {
    return { score: 0, verdict: 'wrong', met: item.must.map(() => false), feedback: 'Försök skriva det du kommer ihåg, även om du är osäker.', confidence: 'hög', tier: 'lokal', escalated: false, calls: 0 };
  }
  if (item.level >= 5) {
    const r = await gradeOnce(ai, test, item, answer, TIERS.careful);
    return { ...r, escalated: false, reason: 'nivå 5', calls: 1 };
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
