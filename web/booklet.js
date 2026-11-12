// Urvalet till instuderingshäftet: rubriker, punkter och frågor. Ren logik utan jsPDF och Preact,
// så att den går att testa.
import { hasSpellingLure, practiceMax } from './engine.js';

const words = s => String(s).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];

// Andelen ord i den kortare texten som också finns i den längre. 1 = samma ord.
export function overlap(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export const goalLabel = t => String(t).replace(/^kunna\s+/i, '').replace(/^./, c => c.toUpperCase());

// Rubrik över övningsfrågorna. Målet får inte avslöja svaret, så det som står inom parentes
// sist och det som följer efter ett kolon tas bort ("Säga vad perspektivet kallas … (grodperspektiv)").
export function goalTopic(t) {
  let s = goalLabel(t).trim();
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/\s*\([^()]*\)\s*[.!]?$/, '').trim(); }
  const colon = s.indexOf(': ');
  if (colon > 0 && words(s.slice(0, colon)).length >= 3) s = s.slice(0, colon);
  s = s.replace(/[.:;,]$/, '');
  return s || 'Det här målet';
}

// En punkt i "Det här ska du kunna" ska vara en hel mening: stor bokstav först, inget kolon
// eller frågetecken sist och minst minWords ord.
const isSentence = (s, minWords) => /^[\p{Lu}\p{N}]/u.test(s) && !/[:?]$/.test(s) && words(s).length >= minWords;

// Högst max punkter per mål, utan sådana som nästan säger samma sak som en redan vald.
export function summaryFacts(candidates, { max = 4, minWords = 4 } = {}) {
  const out = [];
  for (const raw of candidates) {
    const s = String(raw ?? '').trim();
    if (!isSentence(s, minWords) || out.some(o => overlap(o, s) >= 0.7)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// Väljer frågor till häftet: per mål några frågor från olika nivåer, aldrig felstavade
// alternativ och aldrig en fråga som nästan är samma som en redan vald (också från andra mål).
export function pickPrintItems({ goals, banks, mastery, perGoal = 3, onlyOpen = false }) {
  const out = [];
  const taken = [];
  // Bara för frågor med minst fem ord: korta mallfrågor ("Vad heter X på engelska?",
  // "Vad är 3 + 4?") skiljer sig i ett enda ord. Glosor och matematik filtreras aldrig.
  const long = q => words(q).length >= 5;
  const similar = it => long(it.q) && taken.some(q => overlap(q, it.q) >= 0.8);
  for (const g of goals) {
    const m = mastery[g.id];
    const dedupe = g.type !== 'glosa' && g.type !== 'matematik';
    if (onlyOpen && m?.passedMax && m.level >= practiceMax(g, banks[g.id])) continue;
    const bank = (banks[g.id] || []).filter(it => !hasSpellingLure(it));
    const byLevel = {};
    for (const it of bank) (byLevel[it.level] ||= []).push(it);
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    const items = [];
    const next = Object.fromEntries(levels.map(l => [l, 0]));
    // Turas om mellan nivåerna så att häftet går från lätt till svårare.
    for (let progress = true; items.length < perGoal && progress;) {
      progress = false;
      for (const l of levels) {
        if (items.length >= perGoal) break;
        while (next[l] < byLevel[l].length) {
          const it = byLevel[l][next[l]++];
          progress = true;
          if (dedupe && it.q && similar(it)) continue;
          items.push(it);
          if (dedupe && it.q && long(it.q)) taken.push(it.q);
          break;
        }
      }
    }
    out.push({ goal: g, items: items.sort((a, b) => a.level - b.level) });
  }
  return out;
}
