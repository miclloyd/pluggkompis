// Feedback på egna skoluppgifter (plan 1.6): barnet lägger in uppgiften och sin text och
// får högst tre saker tillbaka: något bra och två–tre vägledande frågor. Spärrarna och
// valideringen ligger i tasklogic.js.
import { html, useState, useEffect } from './lib.js';
import { uid } from './repo.js';
import { readFile, fileKind } from './extract.js';
import { gradeOf } from './grade.js';
import { Sheet } from './sheet.js';
import { paragraphs, canAsk, askFeedback, MAX_ROUNDS, TASKS_PER_WEEK, MAX_TEXT, MAX_TASK } from './tasklogic.js';

const WEEK = 7 * 24 * 3600 * 1000;
const asked = t => (t.versions || []).filter(v => v.feedback || v.blocked);
const SUPPORT_TEXT = {
  1: 'Kompisen ställer bara frågor om innehåll och upplägg.',
  2: 'Kompisen ställer frågor och säger vilka stycken du kan läsa om.',
  3: 'Kompisen ställer frågor, säger vilka stycken och vilken sorts fel det finns där, men aldrig vilket ord.',
};
export const SUPPORT_LABEL = { 1: 'Frågor', 2: 'Var', 3: 'Vilken sorts fel' };

// Uppgifter med feedback de senaste sju dagarna (veckogränsen gäller per barn).
export function weekCount(tasks, profileId, exceptId) {
  const since = Date.now() - WEEK;
  return tasks.filter(t => t.profileId === profileId && t.id !== exceptId && asked(t).some(v => v.ts >= since)).length;
}

// På barnets startsida.
export function TaskList({ env, go, profileId }) {
  const [tasks, setTasks] = useState(null);
  useEffect(() => { env.repo.listTasks().then(ts => setTasks(ts.filter(t => t.profileId === profileId))).catch(() => setTasks([])); }, [profileId]);
  if (!env.ai || !tasks) return null;
  return html`<section class="block tasks">
    <h2 class="section-title">Skoluppgifter</h2>
    <p class="muted small">Har du skrivit en text till skolan? Din kompis kan ge dig frågor som hjälper dig att göra den bättre själv.</p>
    <ul class="list">${tasks.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(t => html`<li>
      <button class="list-row" onClick=${() => go({ name: 'task', profileId, taskId: t.id })}>
        <span class="lr-main"><strong>${t.title || 'Uppgift'}</strong></span>
        <span class="muted small">${asked(t).length} av ${MAX_ROUNDS} omgångar</span></button></li>`)}</ul>
    <button class="btn ghost" onClick=${() => go({ name: 'task', profileId, taskId: null })}>Ny uppgift</button>
  </section>`;
}

export function TaskView({ env, go, profileId, taskId }) {
  const { repo } = env;
  const [task, setTask] = useState(null);
  const [profile, setProfile] = useState(null);
  const [all, setAll] = useState([]);
  const [text, setText] = useState('');
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [profiles, tasks] = await Promise.all([repo.listProfiles(), repo.listTasks()]);
      setProfile(profiles.find(p => p.id === profileId));
      setAll(tasks);
      const t = taskId && tasks.find(x => x.id === taskId);
      if (t) {
        setTask(t);
        setText(t.versions?.at(-1)?.text || '');
        setEditing(!asked(t).length);
      } else {
        setTask({ id: uid('k'), profileId, title: '', assignment: '', rubric: '', versions: [], isNew: true });
      }
    })().catch(e => setErr(e.message || 'Kunde inte läsa uppgiften.'));
  }, [taskId]);
  if (!task || !profile) return html`<p class="muted">${err || 'Laddar…'}</p>`;

  const rounds = asked(task).length;
  const last = task.versions?.at(-1);
  const set = patch => setTask({ ...task, ...patch });

  async function loadFile(file) {
    if (!file) return;
    const kind = fileKind(file);
    if (kind !== 'docx' && kind !== 'text') { setErr('Välj en Word-fil eller en textfil.'); return; }
    try {
      const r = await readFile(file, env.config.libs);
      setText(r.pages.map(p => p.raw).join('\n\n').slice(0, MAX_TEXT));
    } catch (e) { setErr(e.message || 'Filen kunde inte läsas.'); }
  }

  async function ask() {
    setErr('');
    const why = canAsk({ task, text, comment, weekTasks: weekCount(all, profileId, task.id) });
    if (why) { setErr(why); return; }
    setBusy('Kompisen läser din text…');
    try {
      const { isNew, ...base } = task;
      // Spara först: servern sätter stödnivån (förälderns val) på en ny uppgift.
      await repo.saveTask({ ...base, title: base.title.trim() || 'Uppgift' });
      const saved = await repo.getTask(task.id);
      const r = await askFeedback(env.ai, {
        grade: gradeOf(profile), task: saved, text, support: saved.support || 2,
        previous: rounds ? { round: rounds, comment } : null,
      });
      const version = { n: (saved.versions || []).length + 1, text, comment: rounds ? comment.trim() : '', ts: Date.now(),
        ...(r.blocked ? { blocked: true } : { feedback: r.feedback }) };
      const next = { ...saved, versions: [...(saved.versions || []), version] };
      await repo.saveTask(next);
      setTask(next); setComment(''); setEditing(false);
      setAll(a => [...a.filter(x => x.id !== next.id), next]);
    } catch (e) {
      setErr(e.message || 'Något gick fel. Försök igen.');
    } finally { setBusy(''); }
  }

  const paras = paragraphs(last?.text || '');
  return html`<div class="task-view">
    <p><button class="btn ghost small" onClick=${() => go({ name: 'child', profileId })}>← Tillbaka</button></p>
    <h1>${task.title || 'Ny uppgift'}</h1>

    ${!rounds && html`<section class="sheet form">
      <label for="tk-title">Vad heter uppgiften?</label>
      <input id="tk-title" maxlength="80" value=${task.title} onInput=${e => set({ title: e.target.value })} />
      <label for="tk-assign">Vad är uppgiften? Skriv av den eller klistra in den.</label>
      <textarea id="tk-assign" rows="4" maxlength=${MAX_TASK} value=${task.assignment} onInput=${e => set({ assignment: e.target.value })}></textarea>
      <label for="tk-rubric">Bedömningsmatris (om du har en)</label>
      <textarea id="tk-rubric" rows="3" maxlength=${MAX_TASK} value=${task.rubric} onInput=${e => set({ rubric: e.target.value })}></textarea>
      <p class="hint">Fråga din lärare om det är okej att få frågor från Pluggkompis på uppgiften.</p>
    </section>`}

    ${last?.feedback && !editing && html`<section class="sheet task-fb">
      <p class="eyebrow">Omgång ${rounds} av ${MAX_ROUNDS}</p>
      <p class="fb-strength">⭐ ${last.feedback.strength}</p>
      <ol class="fb-questions">${last.feedback.questions.map(q => html`<li>${q.paragraph ? html`<span class="ref">Stycke ${q.paragraph}</span> ` : ''}${q.text}</li>`)}</ol>
      ${last.feedback.errors?.length > 0 && html`<p class="small">Läs högt för dig själv: ${last.feedback.errors.map(e => html`<span class="fix">stycke ${e.paragraph} (${e.type}) </span>`)}</p>`}
    </section>`}
    ${last?.blocked && !editing && html`<p class="notice warn">Kompisen kunde inte ge frågor som följer reglerna den här gången. Försök igen lite senare, eller visa texten för en vuxen.</p>`}

    ${!editing && paras.length > 0 && html`<section class="block">
      <h2>Din text</h2>
      <ol class="task-paras">${paras.map(p => html`<li>${p}</li>`)}</ol>
      ${rounds < MAX_ROUNDS
        ? html`<button class="btn primary" onClick=${() => { setText(last.text); setEditing(true); }}>Ändra i texten</button>`
        : html`<p class="notice">Du har fått frågor ${MAX_ROUNDS} gånger. Nu är det dags att lämna in!</p>`}
    </section>`}

    ${editing && html`<section class="sheet form">
      <label for="tk-text">${rounds ? 'Ändra i din text' : 'Din text'}</label>
      <textarea id="tk-text" rows="12" maxlength=${MAX_TEXT} value=${text} onInput=${e => setText(e.target.value)}></textarea>
      ${!rounds && html`<p class="small">Eller hämta från en fil: <input type="file" accept=".docx,.txt" onChange=${e => loadFile(e.target.files[0])} /></p>`}
      ${rounds > 0 && html`<label for="tk-comment">Vad ändrade du, och varför?</label>
        <input id="tk-comment" maxlength="300" value=${comment} onInput=${e => setComment(e.target.value)} />`}
      <p class="hint">${SUPPORT_TEXT[task.support || 2]} Högst ${MAX_ROUNDS} omgångar per uppgift och ${TASKS_PER_WEEK} uppgifter i veckan.</p>
      <div class="actions">
        ${rounds > 0 && html`<button class="btn ghost" onClick=${() => { setEditing(false); setErr(''); }}>Avbryt</button>`}
        <button class="btn primary" disabled=${!!busy} onClick=${ask}>${rounds ? 'Be om nya frågor' : 'Be om frågor'}</button>
      </div>
    </section>`}
    ${busy && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>${busy}</p>`}
    ${err && html`<p class="notice bad">${err}</p>`}
  </div>`;
}

// Föräldradelen: alla versioner, all feedback och barnets kommentarer.
export function ParentTasks({ env, profiles }) {
  const [tasks, setTasks] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => env.repo.listTasks().then(setTasks).catch(() => setTasks([]));
  useEffect(() => { load(); }, []);
  if (!tasks || (!tasks.length && !env.ai)) return null;
  const name = id => profiles.find(p => p.id === id)?.name || 'Borttagen profil';
  return html`<section class="block">
    <h2>Skoluppgifter</h2>
    ${!tasks.length && html`<p class="empty">Inga skoluppgifter än. Barnen lägger in dem från sin startsida.</p>`}
    <ul class="list">${tasks.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(t => html`<li>
      <button class="list-row" onClick=${() => setOpen(t)}>
        <span class="lr-main"><strong>${t.title || 'Uppgift'}</strong><span class="muted small">${name(t.profileId)} · stödnivå ${t.support || 2} (${SUPPORT_LABEL[t.support || 2]})</span></span>
        <span class="muted small">${asked(t).length} av ${MAX_ROUNDS} omgångar</span></button></li>`)}</ul>
    <p class="hint">Stödnivån väljs per barn under Barn. Den gäller nya uppgifter.</p>
    ${open && html`<${Sheet} title=${open.title || 'Uppgift'} wide onClose=${() => setOpen(null)}>
      <p class="small"><strong>Uppgiften:</strong> ${open.assignment}</p>
      ${open.rubric && html`<p class="small"><strong>Matris:</strong> ${open.rubric}</p>`}
      ${(open.versions || []).map(v => html`<section class="block">
        <h3>Version ${v.n}${v.ts ? ` · ${new Date(v.ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</h3>
        ${v.comment && html`<p class="small"><strong>Barnets kommentar:</strong> ${v.comment}</p>`}
        <ol class="task-paras">${paragraphs(v.text).map(p => html`<li>${p}</li>`)}</ol>
        ${v.feedback && html`<div class="task-fb small"><p>⭐ ${v.feedback.strength}</p>
          <ol>${v.feedback.questions.map(q => html`<li>${q.paragraph ? `Stycke ${q.paragraph}: ` : ''}${q.text}</li>`)}</ol>
          ${v.feedback.errors?.length > 0 && html`<p>Feltyper: ${v.feedback.errors.map(e => `stycke ${e.paragraph} (${e.type})`).join(', ')}</p>`}</div>`}
        ${v.blocked && html`<p class="small muted">Feedbacken stoppades av spärrarna (formulerade text åt barnet) och visades inte.</p>`}
      </section>`)}
      <div class="actions"><button class="btn bad" onClick=${async () => { await env.repo.deleteTask(open.id); setOpen(null); load(); }}>Ta bort uppgiften</button></div>
    <//>`}
  </section>`;
}
