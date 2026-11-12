// Lär ut det: barnet förklarar ett mål för sin kompis med egna ord. Kompisen säger vad den
// förstod och ställer högst en följdfråga mot det som saknas. Påverkar inte nivåerna.
import { html, useState, useEffect, useRef } from './lib.js';
import { Kompis, KOMPIS_DEFAULT } from './buddy.js';
import { teachFacts, teachTurn } from './pipeline.js';
import { uid } from './repo.js';
import { coverVar, IconMic } from './ui.js';
import { goalTopic } from './booklet.js';

// Mål att lära ut: sådant barnet har övat på (inte glosor), svagast först, med lite slump.
export function teachCandidates({ goals, mastery, attempts }) {
  const practiced = new Set(attempts.map(a => a.goalId));
  const list = goals.filter(g => g.type !== 'glosa');
  const seen = list.filter(g => practiced.has(g.id));
  const pool = seen.length ? seen : list;
  return pool.slice().sort((a, b) => ((mastery[a.id]?.passedMax ? 10 : 0) + (mastery[a.id]?.level || 1)) - ((mastery[b.id]?.passedMax ? 10 : 0) + (mastery[b.id]?.level || 1)) || Math.random() - 0.5);
}

export function Teach({ env, go, testId, profileId }) {
  const { repo } = env;
  const [s, setS] = useState(null);
  const [idx, setIdx] = useState(0);
  const [turns, setTurns] = useState([]);   // { role: 'child'|'kompis', text, stars?, covered? }
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const k = useRef(null);
  const chatId = useRef(uid('t'));
  const input = useRef();

  useEffect(() => {
    (async () => {
      const [test, goals, banks, mastery, materials, profiles, attempts] = await Promise.all([
        repo.getTest(testId), repo.listGoals(testId), repo.listBanks(testId), repo.listMastery(testId), repo.listMaterials(testId),
        repo.listProfiles(), repo.listAttempts(testId).catch(() => []),
      ]);
      const cands = teachCandidates({ goals: goals.filter(g => !g.removed), mastery, attempts });
      setS({ test, banks, materials, profile: profiles.find(p => p.id === profileId), cands });
    })().catch(() => setErr('Det gick inte att ladda.'));
  }, [testId]);

  const look = { ...KOMPIS_DEFAULT, ...(s?.profile?.kompis || {}) };
  const goal = s?.cands[idx % Math.max(1, s.cands.length)];
  const opener = goal ? `Jag fattar inte riktigt det här: ”${goalTopic(goal.text)}”. Kan du förklara det för mig med egna ord?` : '';
  const finished = turns.length >= 4 || (turns.length >= 2 && !turns[turns.length - 1].question);

  useEffect(() => {
    if (!goal || turns.length) return;
    const t = setTimeout(() => { k.current?.mood('tanker'); k.current?.speak(opener).then(() => k.current?.mood('vilar')); }, 500);
    return () => clearTimeout(t);
  }, [goal?.id]);

  if (err && !s) return html`<p class="notice bad">${err}</p>`;
  if (!s) return html`<p class="muted">Laddar…</p>`;
  if (!env.ai) return html`<p class="notice warn">Lär ut det kräver Claude, som inte är tillgängligt här.</p>`;
  if (!goal) return html`<section class="sheet"><p class="lead">Det finns inget att lära ut än. Öva lite först!</p>
    <div class="actions"><button class="btn ghost" onClick=${() => go({ name: 'child', profileId })}>Tillbaka</button></div></section>`;

  function pageTextFor(g) {
    const src = g.sources?.[0];
    const mat = s.materials.find(m => m.ref === src?.m);
    return mat?.pages.find(p => p.p === src?.p)?.text || '';
  }

  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const childTurn = { role: 'child', text };
    const history = [{ role: 'kompis', text: opener }, ...turns, childTurn];
    setTurns(t => [...t, childTurn]);
    setDraft('');
    setBusy(true);
    setErr('');
    k.current?.mood('tanker');
    try {
      const r = await teachTurn({ ai: env.ai, test: s.test, goal, facts: teachFacts(s.banks[goal.id]), pageText: pageTextFor(goal), kompis: look.name, turns: history });
      const final = history.length >= 4;
      const reply = { role: 'kompis', text: r.reply, question: final ? null : r.question, stars: r.stars, covered: r.covered };
      const all = [...turns, childTurn, reply];
      setTurns(all);
      k.current?.mood('forklarar');
      k.current?.speak(r.question && !final ? `${r.reply} ${r.question}` : r.reply).then(() => k.current?.mood('vilar'));
      if (!reply.question) setTimeout(() => k.current?.react(r.stars >= 3 ? 'nivaupp' : 'ratt'), 300);
      repo.saveChat(testId, {
        id: chatId.current, kind: 'teach', profileId, goalId: goal.id, q: goal.text, ts: Date.now(), stars: r.stars,
        covered: r.covered, missing: r.missing, wrong: r.wrong,
        messages: [{ role: 'assistant', text: opener }, ...all.map(t => ({ role: t.role === 'child' ? 'user' : 'assistant', text: t.question ? `${t.text} ${t.question}` : t.text }))],
      }).catch(() => {});
    } catch (e2) {
      setTurns(turns);
      setDraft(text);
      k.current?.mood('vilar');
      setErr((e2 && e2.message) || 'Det gick inte att få svar. Försök igen.');
    }
    setBusy(false);
  }

  function another() {
    setTurns([]); setDraft(''); setErr(''); chatId.current = uid('t');
    setIdx(i => i + 1);
  }

  const lastKompis = [...turns].reverse().find(t => t.role === 'kompis');
  return html`<div class="teach" style=${coverVar(s.test.subject)}>
    <section class="teach-stage">
      <div class="teach-fig"><${Kompis} look=${look} onReady=${x => { k.current = x; }} /></div>
      <div class="teach-say" aria-live="polite">
        <p class="eyebrow">${s.test.subject} · Lär ut det</p>
        <p class="teach-line">${lastKompis ? lastKompis.text : opener}</p>
        ${lastKompis?.question && !finished && html`<p class="teach-line q">${lastKompis.question}</p>`}
        ${busy && html`<p class="small muted"><span class="spinner inline" aria-hidden="true"></span> ${look.name} tänker…</p>`}
      </div>
    </section>

    ${turns.filter(t => t.role === 'child').length > 0 && html`<ol class="teach-log">
      ${turns.filter(t => t !== lastKompis).map(t => t.role === 'child'
        ? html`<li class="bubble me">${t.text}</li>`
        : html`<li class="bubble ai">${t.text}${t.question ? html`<br /><strong>${t.question}</strong>` : ''}</li>`)}
    </ol>`}

    ${finished
      ? html`<section class="sheet teach-done">
          <p class="stars" aria-label=${`${lastKompis.stars} av 3 stjärnor`}>${[1, 2, 3].map(n => html`<span class=${n <= lastKompis.stars ? 'on' : ''}>★</span>`)}</p>
          <h2>${lastKompis.stars >= 3 ? `Nu fattar ${look.name}!` : lastKompis.stars === 2 ? `${look.name} förstår det mesta nu.` : `${look.name} är på väg att förstå.`}</h2>
          ${lastKompis.covered?.length > 0 && html`<p class="small muted">Det här fick du med:</p>
            <ul class="checks">${lastKompis.covered.map(c => html`<li class="ok"><span class="sr">Med:</span>${c}</li>`)}</ul>`}
          <div class="actions">
            <button class="btn ghost" onClick=${() => go({ name: 'child', profileId })}>Klar</button>
            ${s.cands.length > 1 && html`<button class="btn primary" onClick=${another}>Förklara något annat</button>`}
          </div>
        </section>`
      : html`<form class="teach-form sheet" onSubmit=${send}>
          <label for="teach-in" class="field-label">${turns.length ? 'Ditt svar' : `Förklara för ${look.name} med egna ord`}</label>
          <textarea id="teach-in" ref=${input} class="answer free" rows="5" value=${draft} disabled=${busy}
            onInput=${e => setDraft(e.target.value)} placeholder="Skriv som om du pratade med en kompis"></textarea>
          <p class="small muted mic-tip"><${IconMic} /> Du kan prata in med mikrofonen på tangentbordet.</p>
          ${err && html`<p class="notice bad">${err}</p>`}
          <div class="actions">
            ${!turns.length && s.cands.length > 1 && html`<button type="button" class="btn ghost small" onClick=${another}>Något annat</button>`}
            <button type="button" class="btn ghost" onClick=${() => go({ name: 'child', profileId })}>Avsluta</button>
            <button class="btn primary" disabled=${busy || !draft.trim()}>${turns.length ? 'Svara' : 'Förklara'}</button>
          </div>
        </form>`}
  </div>`;
}
