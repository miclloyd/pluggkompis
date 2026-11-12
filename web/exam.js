// Provläge: ett pass som liknar provet. Inga ledtrådar, inget material, inget facit och ingen
// kompis under tiden. Allt rättas på slutet. Resultatet sparas för föräldern, och svaren räknas
// in i dagens minuter, men provläget flyttar inte nivåerna (det är en mätning, inte övning).
import { withDictation } from './speech.js';
import { withChars } from './chars.js';
import { goalLabel } from './booklet.js';
import { html, useState, useEffect, useRef } from './lib.js';
import {
  practiceMax, hasSpellingLure, shuffle, gradeLocal, isFree, correctAnswerText, newMastery,
} from './engine.js';
import { gradeFree } from './grading.js';
import { secondsPerAnswer } from './plan.js';
import { uid } from './repo.js';
import { coverVar, Ring } from './ui.js';
import { Kompis, KOMPIS_DEFAULT } from './buddy.js';

export const EXAM_MAX = 12;

// Frågorna: en per mål på den nivå barnet nått (minst nivå 2, som på ett prov), tyngst vägda mål
// först om de är fler än EXAM_MAX. Få mål ger två frågor per mål.
export function pickExam({ goals, mastery, banks, rand = Math.random }) {
  const usable = goals.filter(g => (banks[g.id] || []).length);
  const ordered = usable.slice().sort((a, b) => (b.weight || 2) - (a.weight || 2) || rand() - 0.5).slice(0, EXAM_MAX);
  const perGoal = ordered.length <= EXAM_MAX / 2 ? 2 : 1;
  const out = [];
  for (const g of ordered) {
    const bank = (banks[g.id] || []).filter(it => !hasSpellingLure(it));
    const m = mastery[g.id] || newMastery(g.id);
    const max = practiceMax(g, banks[g.id]);
    const want = Math.min(max, Math.max(m.level, 2));
    const levels = [want, want - 1, want + 1, 1, 2, 3, 4, 5].filter((l, i, a) => l >= 1 && l <= max && a.indexOf(l) === i);
    const taken = new Set();
    for (let n = 0; n < perGoal; n++) {
      // Andra frågan tas helst från en annan nivå, så att provet inte blir upprepning.
      const order = n === 0 ? levels : [...levels.slice(1), levels[0]];
      for (const l of order) {
        const pool = shuffle(bank.filter(it => it.level === l && !taken.has(it.id)), rand)
          .sort((a, b) => ((m.seen || {})[a.id] || 0) - ((m.seen || {})[b.id] || 0));
        if (pool.length) { taken.add(pool[0].id); out.push({ goal: g, item: pool[0] }); break; }
      }
    }
  }
  return shuffle(out, rand).slice(0, EXAM_MAX);
}

// Rättar alla svar. Fritext rättas av AI två åt gången; går AI inte att nå blir frågan "ej rättad".
async function gradeAll({ ai, test, rows, onProgress }) {
  const out = rows.map(() => null);
  let done = 0;
  const free = [];
  rows.forEach((r, i) => {
    if (r.answer == null) { out[i] = { score: 0, verdict: 'skipped' }; done++; }
    else if (!isFree(r.item)) { out[i] = gradeLocal(r.item, r.answer); done++; }
    else free.push(i);
  });
  onProgress(done);
  const worker = async () => {
    while (free.length) {
      const i = free.shift();
      try {
        const g = await gradeFree({ ai, test, item: rows[i].item, answer: rows[i].answer });
        out[i] = { score: g.score, verdict: g.verdict, met: g.met, feedback: g.feedback, grading: { tier: g.tier, calls: g.calls, escalated: g.escalated } };
      } catch { out[i] = { score: 0, verdict: 'ungraded' }; }
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

const VERDICT = { right: 'Rätt', almost: 'Delvis', wrong: 'Fel', skipped: 'Inget svar', ungraded: 'Ej rättad' };
const ICON = { right: '✓', almost: '½', wrong: '✗', skipped: '–', ungraded: '?' };

export function ExamMode({ env, go, testId, profileId, Question }) {
  const { repo } = env;
  const [s, setS] = useState(null);
  const [phase, setPhase] = useState('intro'); // intro | run | grading | result
  const [i, setI] = useState(0);
  const [rows, setRows] = useState([]);
  const [graded, setGraded] = useState(0);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const started = useRef(0);
  const k = useRef(null);

  useEffect(() => {
    (async () => {
      const [test, goals, banks, mastery, profiles, attempts] = await Promise.all([
        repo.getTest(testId), repo.listGoals(testId), repo.listBanks(testId), repo.listMastery(testId), repo.listProfiles(),
        repo.listAttempts(testId).catch(() => []),
      ]);
      const active = goals.filter(g => !g.removed);
      let picks = pickExam({ goals: active, mastery, banks: withChars(active, withDictation(active, banks)) });
      // Utan AI går fritext inte att rätta, så då används bara frågor som rättas direkt.
      if (!env.ai) picks = picks.filter(p => !isFree(p.item));
      const sec = secondsPerAnswer(attempts);
      const minutes = Math.max(3, Math.round(picks.reduce((a, p) => a + (sec[p.item.kind] || 40), 0) / 60));
      setS({ test, profile: profiles.find(p => p.id === profileId), picks, minutes });
    })().catch(() => setErr('Provet kunde inte laddas.'));
  }, [testId]);

  if (err) return html`<p class="notice bad">${err}</p>`;
  if (!s) return html`<p class="muted">Laddar…</p>`;
  const look = { ...KOMPIS_DEFAULT, ...(s.profile?.kompis || {}) };
  const back = () => go({ name: 'child', profileId });

  function answer(a) {
    const row = { ...s.picks[i], answer: a, ts: Date.now() };
    const next = [...rows, row];
    setRows(next);
    if (i + 1 < s.picks.length) setI(i + 1);
    else finish(next);
  }

  async function finish(all) {
    setPhase('grading');
    const grades = await gradeAll({ ai: env.ai, test: s.test, rows: all, onProgress: setGraded });
    const items = all.map((r, n) => ({
      goalId: r.goal.id, itemId: r.item.id, level: r.item.level, kind: r.item.kind,
      answer: r.answer, score: grades[n].score, verdict: grades[n].verdict, ...(grades[n].met ? { met: grades[n].met } : {}),
      ...(grades[n].feedback ? { feedback: grades[n].feedback } : {}),
    }));
    const points = items.reduce((a, x) => a + x.score, 0);
    const exam = { id: uid('x'), profileId, ts: started.current, endTs: Date.now(), points, max: items.length, items };
    setResult({ exam, grades });
    setPhase('result');
    const pct = points / Math.max(1, items.length);
    setTimeout(() => k.current?.react(pct >= 0.8 ? 'nivaupp' : pct >= 0.5 ? 'ratt' : 'peta'), 400);
    try {
      await repo.saveExam(testId, exam);
      // Svaren sparas också som vanliga svar (märkta), så att dagens minuter och statistiken stämmer.
      for (const [n, x] of items.entries()) {
        if (x.answer == null) continue;
        await repo.saveAttempt(testId, {
          id: uid('a'), profileId, goalId: x.goalId, itemId: x.itemId, level: x.level, kind: x.kind, answer: x.answer,
          score: x.score, verdict: x.verdict === 'ungraded' ? 'wrong' : x.verdict, ts: all[n].ts, disputed: false, exam: exam.id,
          ...(grades[n].grading ? { grading: grades[n].grading } : {}),
        });
      }
    } catch { setErr('Resultatet kunde inte sparas. Kontrollera anslutningen.'); }
  }

  if (phase === 'intro') return html`<div class="exam" style=${coverVar(s.test.subject)}>
    <section class="sheet exam-intro">
      <p class="eyebrow">${s.test.subject} · Provläge</p>
      <h1>Testa dig som på provet</h1>
      ${s.picks.length
        ? html`<ul class="exam-rules">
            <li><strong>${s.picks.length} frågor</strong>, ungefär ${s.minutes} minuter.</li>
            <li>Inga ledtrådar, inget material och inget facit förrän du är klar.</li>
            <li>${look.name} vilar under tiden. Du klarar dig själv!</li>
            <li>Vet du inte, hoppa över. Det är bättre än att gissa vilt.</li>
          </ul>
          <p class="muted small">Provläget visar vad som sitter. Det ändrar inte dina nivåer.</p>
          <div class="actions"><button class="btn ghost" onClick=${back}>Inte nu</button>
            <button class="btn primary big" onClick=${() => { started.current = Date.now(); setPhase('run'); }}>Starta provet</button></div>`
        : html`<p class="lead">Det finns inga frågor att ställa än.</p><div class="actions"><button class="btn ghost" onClick=${back}>Tillbaka</button></div>`}
    </section>
  </div>`;

  if (phase === 'run') {
    const { item } = s.picks[i];
    return html`<div class="exam practice" style=${coverVar(s.test.subject)}>
      <div class="practice-top">
        <span class="exam-count">Fråga ${i + 1} av ${s.picks.length}</span>
        <span class="exam-bar" aria-hidden="true"><span style=${`width:${(i / s.picks.length) * 100}%`}></span></span>
      </div>
      <article class="qcard enter" key=${item.id}>
        <p class="q-goal"><span class="q-subject">${s.test.subject}</span><span class="q-free">Provläge</span></p>
        <${Question} item=${item} disabled=${false} onAnswer=${answer} result=${null} />
        <div class="q-tools"><button class="link small" onClick=${() => answer(null)}>Hoppa över</button></div>
      </article>
    </div>`;
  }

  if (phase === 'grading') {
    const free = rows.filter(r => r.answer != null && isFree(r.item)).length;
    return html`<div class="exam"><section class="sheet exam-intro" role="status">
      <div class="exam-kompis"><${Kompis} look=${look} onReady=${x => { k.current = x; x?.mood('tanker'); }} /></div>
      <h1>Rättar…</h1>
      <p class="lead">${free ? `${look.name} läser dina svar. ${graded} av ${rows.length} klara.` : 'Snart klart.'}</p>
    </section></div>`;
  }

  const { exam, grades } = result;
  const pct = exam.points / Math.max(1, exam.max);
  const byGoal = new Map();
  rows.forEach((r, n) => { const e = byGoal.get(r.goal.id) || { goal: r.goal, list: [] }; e.list.push(grades[n]); byGoal.set(r.goal.id, e); });
  const weak = [...byGoal.values()].filter(e => e.list.some(g => g.score < 1));
  return html`<div class="exam" style=${coverVar(s.test.subject)}>
    <section class="sheet summary">
      <div class="summary-head">
        <${Ring} value=${pct} size=${112} stroke=${11} label=${`${Math.round(pct * 100)} %`} sub=${`${fmtPts(exam.points)} av ${exam.max} p`} />
        <div>
          <p class="eyebrow">${s.test.subject} · Provläge</p>
          <h1>${pct >= 0.85 ? 'Det sitter riktigt bra!' : pct >= 0.6 ? 'Bra jobbat!' : 'Bra att du testade!'}</h1>
          <p class="muted">${weak.length ? `Det här kan du öva lite mer på: ${weak.length} ${weak.length === 1 ? 'mål' : 'mål'}.` : 'Alla mål satt. Snyggt!'}</p>
        </div>
        <div class="exam-kompis small"><${Kompis} look=${look} onReady=${x => { k.current = x; }} /></div>
      </div>
      ${err && html`<p class="notice bad">${err}</p>`}
      <ul class="exam-goals">${[...byGoal.values()].map(e => html`<li>
        <span class="eg-icons">${e.list.map(g => html`<i class=${'v-' + g.verdict} title=${VERDICT[g.verdict]}>${ICON[g.verdict]}</i>`)}</span>
        <span>${goalLabel(e.goal.text)}</span></li>`)}</ul>
      <details class="exam-review">
        <summary>Se alla frågor och rätta svar</summary>
        <ol>${rows.map((r, n) => html`<li class=${'v-' + grades[n].verdict}>
          <p class="er-q"><span class="er-v">${ICON[grades[n].verdict]} ${VERDICT[grades[n].verdict]}</span> ${r.item.q.replace('___', '…')}</p>
          ${shownAnswer(r, grades[n]) && html`<p class="small">Ditt svar: ${shownAnswer(r, grades[n])}</p>`}
          ${grades[n].verdict !== 'right' && html`<p class="small">Rätt svar: <strong class="pre">${correctAnswerText(r.item)}</strong></p>`}
          ${grades[n].feedback && html`<p class="small muted">${grades[n].feedback}</p>`}
        </li>`)}</ol>
      </details>
      <div class="actions">
        <button class="btn ghost" onClick=${back}>Klar</button>
        ${weak.length > 0 && html`<button class="btn primary" onClick=${() => go({ name: 'practice', testId, profileId })}>Öva på det som var svårt</button>`}
      </div>
    </section>
  </div>`;
}

const fmtPts = p => String(Math.round(p * 2) / 2).replace('.', ',');
export { goalLabel };

// Barnets eget svar i genomgången. Felstavningar visas inte igen (de kan fastna).
function shownAnswer(r, g) {
  if (r.answer == null) return '';
  if (['cloze', 'write', 'dictation'].includes(r.item.kind) && g.verdict !== 'right') return '';
  if (r.item.kind === 'mcq') return r.item.options[r.answer];
  if (typeof r.answer === 'object') return '';
  return isFree(r.item) ? `”${String(r.answer).slice(0, 160)}${String(r.answer).length > 160 ? '…' : ''}”` : String(r.answer);
}
