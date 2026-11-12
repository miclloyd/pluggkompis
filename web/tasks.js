// Feedback på egna skoluppgifter (plan 1.6): barnet lägger in uppgiften och sin text och
// får högst tre saker tillbaka: något bra och två–tre vägledande frågor. Spärrarna och
// valideringen ligger i tasklogic.js.
import { html, useState, useEffect } from './lib.js';
import { uid } from './repo.js';
import { readFile, fileKind, imageToJpeg } from './extract.js';
import { gradeOf } from './grade.js';
import { Sheet } from './sheet.js';
import { paragraphs, canAsk, askFeedback, feedbackVersions, transcribePrompt, cleanTranscript, MAX_ROUNDS, TASKS_PER_WEEK, MAX_TEXT, MAX_TASK } from './tasklogic.js';

const WEEK = 7 * 24 * 3600 * 1000;
const asked = feedbackVersions; // bara omgångar med feedback räknas
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
        setText(t.versions?.at(-1)?.text || t.draft || '');
        setEditing(!asked(t).length && !t.versions?.at(-1)?.blocked);
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

  // retry: ett stoppat försök görs om med samma text och kommentar.
  async function ask(retry) {
    setErr('');
    const text0 = retry ? retry.text : text, comment0 = retry ? retry.comment || '' : comment;
    const why = canAsk({ task, text: text0, comment: comment0, weekTasks: weekCount(all, profileId, task.id) });
    if (why) { setErr(why); return; }
    setBusy('Kompisen läser din text…');
    try {
      const { isNew, ...base } = task;
      // Spara först: servern sätter stödnivån (förälderns val) på en ny uppgift.
      await repo.saveTask({ ...base, title: base.title.trim() || 'Uppgift' });
      const saved = await repo.getTask(task.id);
      const r = await askFeedback(env.ai, {
        grade: gradeOf(profile), task: saved, text: text0, support: saved.support || 2,
        previous: rounds ? { round: rounds, comment: comment0 } : null,
      });
      const version = { n: (saved.versions || []).length + 1, text: text0, comment: rounds ? comment0.trim() : '', ts: Date.now(),
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
    ${last?.blocked && !editing && html`<div class="notice warn"><p>Kompisen kunde inte ge frågor som följer reglerna den här gången. Det räknas inte som en omgång.</p>
      <div class="actions">
        <button class="btn ghost" onClick=${() => { setText(last.text); setComment(last.comment || ''); setEditing(true); }}>Ändra i texten</button>
        <button class="btn primary" disabled=${!!busy} onClick=${() => ask({ text: last.text, comment: last.comment })}>Försök igen</button></div></div>`}

    ${!editing && !last?.blocked && paras.length > 0 && html`<section class="block">
      <h2>Din text</h2>
      <ol class="task-paras">${paras.map(p => html`<li>${p}</li>`)}</ol>
      ${rounds < MAX_ROUNDS
        ? html`<button class="btn primary" onClick=${() => { setText(last.text); setEditing(true); }}>Ändra i texten</button>`
        : html`<p class="notice">Du har fått frågor ${MAX_ROUNDS} gånger. Nu är det dags att lämna in!</p>`}
    </section>`}

    ${editing && html`<section class="sheet form">
      <label for="tk-text">${rounds ? 'Ändra i din text' : 'Din text'}</label>
      <textarea id="tk-text" rows="12" maxlength=${MAX_TEXT} value=${text} onInput=${e => setText(e.target.value)}></textarea>
      ${!rounds && task.draftFromPhoto && html`<p class="small muted">Texten är avläst från ditt foto och kontrollerad av en förälder. Stämmer något inte, rätta det innan du ber om frågor.</p>`}
      ${!rounds && !task.draftFromPhoto && html`<p class="small">Eller hämta från en fil: <input type="file" accept=".docx,.txt" onChange=${e => loadFile(e.target.files[0])} /></p>
        <p class="small muted">Har du skrivit för hand? Be en förälder fotografera texten i föräldraläget.</p>`}
      ${rounds > 0 && html`<label for="tk-comment">Vad ändrade du, och varför?</label>
        <input id="tk-comment" maxlength="300" value=${comment} onInput=${e => setComment(e.target.value)} />`}
      <p class="hint">${SUPPORT_TEXT[task.support || 2]} Högst ${MAX_ROUNDS} omgångar per uppgift och ${TASKS_PER_WEEK} uppgifter i veckan.</p>
      <div class="actions">
        ${rounds > 0 && html`<button class="btn ghost" onClick=${() => { setEditing(false); setErr(''); }}>Avbryt</button>`}
        <button class="btn primary" disabled=${!!busy} onClick=${() => ask()}>${rounds ? 'Be om nya frågor' : 'Be om frågor'}</button>
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
  const [creating, setCreating] = useState(null);
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
    ${env.ai && !creating && profiles.length > 0 && html`<button class="btn ghost" onClick=${() => setCreating({ profileId: profiles[0].id, title: '', assignment: '' })}>Ny uppgift med handskriven text</button>`}
    ${creating && html`<div class="sheet form inset">
      <label for="pt-child">Barn</label><select id="pt-child" value=${creating.profileId} onChange=${e => setCreating({ ...creating, profileId: e.target.value })}>
        ${profiles.map(p => html`<option value=${p.id}>${p.name}</option>`)}</select>
      <label for="pt-title">Uppgift</label><input id="pt-title" maxlength="80" value=${creating.title} onInput=${e => setCreating({ ...creating, title: e.target.value })} />
      <label for="pt-assign">Vad är uppgiften?</label><textarea id="pt-assign" rows="3" maxlength=${MAX_TASK} value=${creating.assignment} onInput=${e => setCreating({ ...creating, assignment: e.target.value })}></textarea>
      <div class="actions"><button class="btn ghost" onClick=${() => setCreating(null)}>Avbryt</button>
        <button class="btn primary" disabled=${!creating.title.trim() || !creating.assignment.trim()} onClick=${async () => {
          // Stödnivån från barnets profil, som när barnet själv skapar uppgiften.
          const support = profiles.find(p => p.id === creating.profileId)?.taskSupport || 2;
          const t = { id: uid('k'), ...creating, title: creating.title.trim(), rubric: '', versions: [], support };
          await env.repo.saveTask(t); setCreating(null); await load(); setOpen(await env.repo.getTask(t.id));
        }}>Skapa och lägg till foto</button></div></div>`}
    <p class="hint">Stödnivån väljs per barn under Barn. Den gäller nya uppgifter.</p>
    ${open && html`<${Sheet} title=${open.title || 'Uppgift'} wide onClose=${() => setOpen(null)}>
      <p class="small"><strong>Uppgiften:</strong> ${open.assignment}</p>
      ${open.rubric && html`<p class="small"><strong>Matris:</strong> ${open.rubric}</p>`}
      ${env.ai && !(open.versions || []).length && html`<${PhotoReader} env=${env} task=${open} onSaved=${async t => { setOpen(t); load(); }} />`}
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

// Föräldern fotograferar barnets handskrivna text. AI läser av den (utan att rätta),
// föräldern jämför med fotot och rättar avläsningsfel, och först då blir det barnets text.
function PhotoReader({ env, task, onSaved }) {
  const [text, setText] = useState(task.draft || '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [previews, setPreviews] = useState([]);
  async function read(files) {
    setErr('');
    const list = [...files].slice(0, 4);
    if (!list.length) return;
    setBusy('Läser av handskriften…');
    try {
      const images = await Promise.all(list.map(f => imageToJpeg(f)));
      setPreviews(images.map(b => URL.createObjectURL(b)));
      env.ai.setScope?.({ purpose: 'task', taskId: task.id });
      const r = await env.ai.complete({ prompt: transcribePrompt(), images, tier: 'default' });
      const t = cleanTranscript(r.text);
      if (!t) throw new Error('Ingen text hittades på bilden.');
      setText(t);
      if (String(r.text).trim().length > MAX_TEXT) setErr(`Texten var längre än ${MAX_TEXT} tecken och har kortats. Kontrollera slutet.`);
    } catch (e) { setErr(e.message || 'Avläsningen misslyckades.'); }
    finally { env.ai.setScope?.({}); setBusy(''); }
  }
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews]);
  async function save() {
    setErr('');
    try {
      await env.repo.saveTask({ ...task, draft: text.trim(), draftFromPhoto: true });
      onSaved(await env.repo.getTask(task.id));
    } catch (e) { setErr(e.message || 'Texten kunde inte sparas.'); }
  }
  return html`<section class="block">
    <h3>Barnets handskrivna text</h3>
    <p class="small">Fotografera texten (högst fyra bilder). Avläsningen behåller barnets stavning. Jämför med fotot och rätta det som lästs fel, inte barnets egna fel.</p>
    <input type="file" accept="image/*" multiple onChange=${e => read(e.target.files)} />
    ${previews.length > 0 && html`<div class="photo-previews">${previews.map(u => html`<img src=${u} alt="Fotot av texten" />`)}</div>`}
    ${busy && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>${busy}</p>`}
    ${err && html`<p class="notice bad">${err}</p>`}
    ${(text || task.draft) && html`<label for="pr-text">Avläst text (ord som inte gick att läsa står som [?])</label>
      <textarea id="pr-text" rows="10" maxlength=${MAX_TEXT} value=${text} onInput=${e => setText(e.target.value)}></textarea>
      <div class="actions"><button class="btn primary" disabled=${!text.trim() || /\[\?\]/.test(text)} onClick=${save}>${task.draft ? 'Spara ändringen' : 'Godkänn som barnets text'}</button></div>
      ${/\[\?\]/.test(text) && html`<p class="small muted">Byt ut [?] mot det som står på fotot innan du godkänner.</p>`}
      ${task.draftFromPhoto && html`<p class="small muted">Godkänd. Barnet ser texten när det öppnar uppgiften.</p>`}`}
  </section>`;
}
