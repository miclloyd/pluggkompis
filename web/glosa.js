// Glosor: frågebanken för nivå 1–3 byggs här ur målen (term, translation, langs), inte av AI.
// Ett glosförhör är ord + översättning, så frågorna och facit är givna: samma frö ger samma
// frågor, inget kan bli fel i en AI-tolkning och bygget kan inte fallera på längden (2026-11-18:
// sex glosor per AI-anrop gav ~100 frågor i ett svar och föll). Nivå 4 (egna meningar) och
// diktamen skapas som förut (buildHighBank resp. withDictation).
//
// Felaktiga alternativ är andra ord ur samma förhör, aldrig felstavningar av rätt ord.
import { rng } from './math.js';
import { hasSpellingLure } from './engine.js';

export const GLOSA_MIN = 4; // så många glosor (samma språkpar) behövs för alternativ och para ihop

const NAMES = { sv: 'svenska', en: 'engelska', de: 'tyska', fr: 'franska', es: 'spanska', it: 'italienska', fi: 'finska', no: 'norska', da: 'danska' };
const langPair = g => {
  const [a, b] = String(g.langs || '').toLowerCase().split(/[-_/ ]+/);
  return [NAMES[a] || null, NAMES[b] || null];
};

// "sofa/couch" → svar "sofa", godtas också "couch".
const forms = w => String(w).split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean);
const main = w => forms(w)[0] || String(w).trim();

function shuffled(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Ett flervalsalternativ: rätt ord + n andra ord ur förhöret, blandat. Inget fel alternativ får
// vara en form av rätt ord (sofa/couch: "couch" är inte fel) eller en felstavning av det.
//   pool: [{ main, forms }] för de andra glosorna; right: { main, forms } för rätt ord
function mcq(r, q, right, pool, n, base) {
  const own = new Set(right.forms.map(f => f.toLowerCase()));
  const others = shuffled(r, pool.filter(w => !w.forms.some(f => own.has(f.toLowerCase()))));
  const picked = [];
  for (const w of others) {
    if (picked.length === n) break;
    const options = [right.main, ...picked, w.main];
    if (new Set(options.map(o => o.toLowerCase())).size !== options.length) continue;
    if (hasSpellingLure({ kind: 'mcq', options, answer: 0 })) continue;
    picked.push(w.main);
  }
  if (picked.length < n) return null;
  const options = shuffled(r, [right.main, ...picked]);
  return { ...base, kind: 'mcq', q, options, answer: options.indexOf(right.main) };
}

// Glosmål med samma språkpar i provet: underlaget för alternativ och para ihop.
export function glosaPeers(goal, goals) {
  const lp = x => String(x.langs || '').toLowerCase().trim().split(/[-_/ ]+/).join('-'); // sv-en = sv_en = SV EN
  return goals.filter(g => g.type === 'glosa' && !g.removed && lp(g) === lp(goal) && g.term && g.translation);
}

const word = w => ({ main: main(w), forms: forms(w).length ? forms(w) : [String(w).trim()] });

export function glosaBank(goal, goals) {
  const peers = glosaPeers(goal, goals);
  if (peers.length < GLOSA_MIN || !goal.term || !goal.translation) return [];
  const [A, B] = langPair(goal); // term på A, översättning på B
  const toB = B ? `på ${B}` : 'i översättning', toA = A ? `på ${A}` : 'i grundformen';
  const T = word(goal.term), U = word(goal.translation);
  const others = peers.filter(g => g.id !== goal.id);
  // Homonymer: en annan glosa med samma term (eller samma översättning) har ett svar som också
  // är rätt. Den blir aldrig ett fel alternativ, och dess form godtas i skrivfrågan.
  const overlaps = (a, b) => forms(a).some(x => forms(b).some(y => x.toLowerCase() === y.toLowerCase()));
  const sameTerm = others.filter(g => overlaps(g.term, goal.term));
  const sameTrans = others.filter(g => overlaps(g.translation, goal.translation));
  const trans = others.filter(g => !sameTerm.includes(g)).map(g => word(g.translation));
  const terms = others.filter(g => !sameTrans.includes(g)).map(g => word(g.term));
  const alsoU = sameTerm.flatMap(g => forms(g.translation)), alsoT = sameTrans.flatMap(g => forms(g.term));
  // Rätt svar = alla former som godtas (egna former och homonymernas). Inget av dem får bli ett
  // fel alternativ eller ett eget par, inte heller via en tredje glosa som delar en av formerna.
  const rightU = { main: U.main, forms: [...new Set([...U.forms, ...alsoU])] };
  const rightT = { main: T.main, forms: [...new Set([...T.forms, ...alsoT])] };
  const s = goal.sources?.[0];
  const src = s ? { m: String(s.m), p: Number(s.p) } : { m: 'note', p: 0 };
  const r = rng(`glosa:${goal.id}:${T.main}:${U.main}`);
  const base = level => ({ goalId: goal.id, level, src, explain: `${T.main} = ${U.main}.`, gen: 'glosa' });
  const items = [
    // Nivå 1: känna igen (3 alternativ), åt båda hållen.
    mcq(r, `Vad heter ${T.main} ${toB}?`, rightU, trans, 2, base(1)),
    mcq(r, `Vad betyder ${U.main} ${toA}?`, rightT, terms, 2, base(1)),
    // Nivå 2: minnas (4 alternativ, andra formuleringar) och para ihop med andra ord ur förhöret.
    mcq(r, `Välj rätt ord ${toB} för ${T.main}.`, rightU, trans, 3, base(2)),
    mcq(r, `Vilket ord ${toA} betyder ${U.main}?`, rightT, terms, 3, base(2)),
    match(r, goal, others, [...rightT.forms, ...rightU.forms], base(2)),
    // Nivå 3: skriva själv, åt båda hållen (alla former godtas, t.ex. sofa/couch).
    { ...base(3), kind: 'write', q: `Skriv ${toB}: ${T.main}`, answer: U.main, accept: rightU.forms.filter(f => f !== U.main) },
    { ...base(3), kind: 'write', q: `Skriv ${toA}: ${U.main}`, answer: T.main, accept: rightT.forms.filter(f => f !== T.main) },
  ].filter(Boolean);
  // Saknas en nivå (för lika ord att välja alternativ ur) tar AI över hela glosan.
  if (![1, 2, 3].every(l => items.some(i => i.level === l))) return [];
  return items.map((it, i) => ({ ...it, id: `gl-${goal.id}-${i}` }));
}

//   right: alla former som godtas för glosan (även homonymernas)
function match(r, goal, others, right, base) {
  const own = new Set(right.map(f => f.toLowerCase()));
  const picked = [];
  for (const g of shuffled(r, others)) {
    if (picked.length === 3) break;
    const f = [...forms(g.term), ...forms(g.translation)].map(x => x.toLowerCase());
    if (f.some(x => own.has(x))) continue; // en synonym får inte bli ett eget par
    f.forEach(x => own.add(x));
    picked.push(g);
  }
  if (picked.length < 3) return null;
  return { ...base, kind: 'match', q: 'Para ihop orden', pairs: shuffled(r, [goal, ...picked].map(g => [main(g.term), main(g.translation)])) };
}
