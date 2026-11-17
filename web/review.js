// Automatisk granskning (0.24): när barnet ofta svarar fel på en fråga, eller ett mål har kört
// fast, får den noggranna modellen avgöra om felet sitter i frågan, i rättningen eller i
// förståelsen. Körs i bakgrunden efter ett fel svar; barnet märker inget.
//   fråga      → flagga (kind 'question', from 'granskning'): frågan pausas, föräldern får notis
//   rättning   → flagga (kind 'grading', from 'granskning') till föräldern
//   förståelse → sparas (kind 'review', status 'ok') så att samma fråga inte granskas i onödan
import { needsReview, itemStats, isStuck, goalTrend, correctAnswerText, REVIEW_AGAIN, STUCK_REVIEW_MIN, STUCK_REVIEW_RATE } from './engine.js';
import { missReviewPrompt, validateMissReview, correctionPrompt, givenAsText } from './prompts.js';
import { uid } from './repo.js';

const reviewsOf = flags => flags.filter(f => f.kind === 'review' || f.from === 'granskning');

// Frågor att granska efter ett svar: frågan själv om den ofta blir fel, och om målet kört fast
// också målets mest missade fråga (minst STUCK_REVIEW_MIN svar och STUCK_REVIEW_RATE fel).
export function reviewCandidates({ goal, item, bank, attempts, flags }) {
  const reviews = reviewsOf(flags);
  const out = [];
  if (needsReview({ item, attempts, reviews })) out.push(item);
  if (isStuck(goalTrend(goal.id, attempts))) {
    const top = bank
      .filter(i => !['math', 'dictation'].includes(i.kind) && !out.some(o => o.id === i.id))
      .map(i => ({ i, s: itemStats(i.id, attempts) }))
      .filter(({ i, s }) => s.n >= STUCK_REVIEW_MIN && s.misses / s.n >= STUCK_REVIEW_RATE
        && !reviews.some(r => r.itemId === i.id && s.misses < (r.misses || 0) + REVIEW_AGAIN))
      .sort((a, b) => b.s.misses - a.s.misses)[0];
    if (top) out.push(top.i);
  }
  return out;
}

export async function reviewItem({ ai, repo, testId, test, goal, item, attempts, materials, profileId }) {
  const s = itemStats(item.id, attempts);
  const mat = materials.find(m => m.ref === item.src?.m);
  const page = mat?.pages.find(p => p.p === item.src?.p);
  const prompt = missReviewPrompt({ test, goal, item, wrong: s.wrong.map(w => givenAsText(item, w)), n: s.n, misses: s.misses, pageText: page?.text || '', materialName: mat?.name || 'materialet' });
  let v = validateMissReview((await ai.complete({ prompt, json: true, tier: 'default', stable: true })).json);
  if (!v.ok) v = validateMissReview((await ai.complete({ prompt: correctionPrompt(prompt, v.errors), json: true, tier: 'default', stable: true })).json);
  if (!v.ok) return null;
  const flag = {
    id: uid('f'), profileId, itemId: item.id, goalId: goal.id, q: item.q, correct: String(correctAnswerText(item) ?? ''),
    n: s.n, misses: s.misses, comment: v.vad, ts: Date.now(), from: 'granskning',
    ...(v.orsak === 'förståelse' ? { kind: 'review', status: 'ok' } : { kind: v.orsak === 'fråga' ? 'question' : 'grading', status: 'open' }),
  };
  await repo.saveFlag(testId, flag);
  return flag;
}
