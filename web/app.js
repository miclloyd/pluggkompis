import { html, render, useState, useEffect, useRef, useMemo, useCallback } from './lib.js';
import { loadEnvironment } from './env.js';
import { createRepo, uid } from './repo.js';
import { createLocalAuth } from './auth.js';
import { gradeOf, birthYearFor } from './grade.js';
import { withDictation, speak, SpeakButton, readAloudText } from './speech.js';
import { REVIEW_PROBLEMS } from './prompts.js';
import { withChars, CharBar } from './chars.js';
import { readFile, fileKind } from './extract.js';
import { summarize, relDay, pct } from './stats.js';
import { coverVar, Ring, Stamp, AnswerTrail, IconBook, IconChat, IconMic } from './ui.js';
import { MatchQuestion, SortQuestion, OrderQuestion, MathQuestion, IntroCard } from './questions.js';
import { SKILLS } from './math.js';
import { SourceSheet } from './source.js';
import { ExplainSheet } from './explain.js';
import { Kompis, KompisDock, KOMPIS_DEFAULT } from './buddy.js';
import { CoverWrite, needsCoverWrite } from './coverwrite.js';
import { applyTheme, ThemeButton } from './theme.js';
import { KompisStudio } from './studio.js';
import { ExamMode } from './exam.js';
import { Teach } from './teach.js';
import { Sheet } from './sheet.js';
import { TaskList, TaskView, ParentTasks, SUPPORT_LABEL } from './tasks.js';
import { PrintSheet } from './print.js';
import { buildPlan, allowedGoals, minutesOnDay, DEFAULT_SCHEDULE, WEEKDAYS, PHASE_LABEL } from './plan.js';
import { interpretMaterial, proposeGoals, buildBank, buildHighBank, buildSortBank, reviewTest, reviewGoalItems, StepError } from './pipeline.js';
import { highLevelsFor } from './prompts.js';
import { gradeFree, regradeOnDispute, TIERS } from './grading.js';
import {
  GOAL_TYPES, TYPE_LABEL, practiceMax, childGoal, parsePages, newMastery, applyResult, gradeLocal, correctAnswerText,
  pickNext, testProgress, goalProgress, allMastered, shuffle, replayMastery, isFree,
  canJump, jumpUp, dayKey,
} from './engine.js';

const SESSION_LENGTH = 12;
const PAUSE_AFTER = 20 * 60 * 1000; // föreslå paus efter 20 minuter i ett sträck
const COLORS = ['#2148c0', '#1d7a50', '#b4302b', '#7a3fb0', '#b26a00', '#0f7c86'];
const SUBJECTS = ['Svenska', 'Engelska', 'Matematik', 'NO', 'Biologi', 'Fysik', 'Kemi', 'Teknik', 'SO', 'Religion', 'Historia', 'Geografi', 'Samhällskunskap', 'Moderna språk'];

const fmtDate = d => (d ? new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }) : 'Inget datum');
function daysUntil(d) {
  if (!d) return null;
  const t = new Date(d + 'T12:00:00'); const n = new Date(); n.setHours(12, 0, 0, 0);
  return Math.round((t - n) / 864e5);
}
function whenText(d) {
  const n = daysUntil(d);
  if (n === null) return 'Inget provdatum';
  if (n < 0) return `Provet var ${fmtDate(d)}`;
  if (n === 0) return 'Provet är i dag';
  if (n === 1) return 'Provet är i morgon';
  return `Provet är om ${n} dagar`;
}
const errText = e => (e && e.message) || 'Något gick fel.';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ok */ } };

// ------------------------------------------------------------ App

function App() {
  const [env, setEnv] = useState(null);
  const [bootErr, setBootErr] = useState(null);
  const [route, setRoute] = useState({ name: 'start' });
  const [parentOk, setParentOk] = useState(false);
  const [theme, setTheme] = useState(() => lsGet('pk.theme') || 'auto');

  useEffect(() => {
    loadEnvironment().then(async e => { const repo = createRepo(e.store); const auth = e.auth || createLocalAuth(repo); const st = await auth.status().catch(() => ({})); setEnv({ ...e, repo, auth, onLan: !!st.lan && !!st.loggedIn }); }).catch(e => setBootErr(errText(e)));
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  // Barnets eget val gäller när barnet är inne i appen.
  useEffect(() => {
    if (!env || !route.profileId) return;
    env.repo.listProfiles().then(ps => { const t = ps.find(p => p.id === route.profileId)?.theme; if (t) { setTheme(t); lsSet('pk.theme', t); } }).catch(() => {});
  }, [env, route.profileId]);
  async function changeTheme(t) {
    setTheme(t);
    lsSet('pk.theme', t);
    if (!route.profileId) return;
    try {
      const p = (await env.repo.listProfiles()).find(x => x.id === route.profileId);
      if (p) await env.repo.saveProfile({ ...p, theme: t });
    } catch { /* valet gäller ändå på den här enheten */ }
  }

  if (bootErr) return html`<main class="wrap"><p class="notice bad">${bootErr}</p></main>`;
  if (!env) return html`<main class="wrap"><p class="muted boot">Laddar Pluggkompis…</p></main>`;

  const go = r => { setRoute(r); window.scrollTo(0, 0); };
  const ctx = { env, go, parentOk, setParentOk };
  env.ai?.setScope?.(aiScope(route));

  let view;
  switch (route.name) {
    case 'parent': view = parentOk ? html`<${ParentHome} ...${ctx} />` : html`<${PinGate} ...${ctx} next=${route} />`; break;
    case 'test': view = parentOk ? html`<${TestSetup} ...${ctx} testId=${route.testId} />` : html`<${PinGate} ...${ctx} next=${route} />`; break;
    case 'child': view = html`<${ChildHome} ...${ctx} profileId=${route.profileId} />`; break;
    case 'practice': view = html`<${Practice} ...${ctx} testId=${route.testId} profileId=${route.profileId} />`; break;
    case 'exam': view = html`<${ExamMode} ...${ctx} testId=${route.testId} profileId=${route.profileId} Question=${Question} />`; break;
    case 'teach': view = html`<${Teach} ...${ctx} testId=${route.testId} profileId=${route.profileId} />`; break;
    case 'task': view = html`<${TaskView} ...${ctx} profileId=${route.profileId} taskId=${route.taskId} />`; break;
    case 'kompis': view = html`<${KompisStudio} ...${ctx} profileId=${route.profileId} onTheme=${t => { setTheme(t); lsSet('pk.theme', t); }} />`; break;
    default: view = html`<${Start} ...${ctx} />`;
  }
  return html`
    <header class="top">
      <div class="top-inner">
        <button class="wordmark" onClick=${() => go({ name: 'start' })} aria-label="Till startsidan">Pluggkompis</button>
        <span class="top-actions">
          ${env.onLan && html`<button class="btn ghost small" onClick=${() => env.lan.logout().catch(() => {}).then(() => location.reload())}>Logga ut</button>`}
          ${parentOk && html`<button class="btn ghost small" onClick=${() => env.auth.lock().then(() => { setParentOk(false); go({ name: 'start' }); }).catch(x => alert('Föräldraläget kunde inte låsas: ' + errText(x)))} aria-label="Lås föräldraläget"><span class="lock-long">Lås föräldraläget</span><span class="lock-short">Lås</span></button>`}
          <${ThemeButton} mode=${theme} onChange=${changeTheme} />
        </span>
      </div>
    </header>
    <${EnvNotice} config=${env.config} />
    <main class="wrap" key=${JSON.stringify(route)}>${view}</main>`;
}

// Vilket tak AI-anropen räknas mot på servern: barnets dag eller provets bygge.
function aiScope(route) {
  if (route.name === 'test') return { purpose: 'build', testId: route.testId };
  if (route.profileId) return { purpose: 'child', profileId: route.profileId, testId: route.testId };
  return {};
}

function EnvNotice({ config }) {
  const f = config.features;
  if (f.persistent && f.ai) return null;
  return html`<div class="wrap"><p class="notice warn">
    ${!f.persistent ? 'Ingen lagring hittades, så inget sparas när sidan stängs. ' : ''}
    ${!f.ai ? 'Claude är inte tillgängligt här, så nytt material kan inte läsas in. Övning på färdiga prov fungerar.' : ''}
  </p></div>`;
}

// ------------------------------------------------------------ Start

function Start({ env, go }) {
  const [profiles, setProfiles] = useState(null);
  const [auth, setAuth] = useState(undefined);
  useEffect(() => {
    env.repo.listProfiles().then(setProfiles).catch(() => setProfiles([]));
    env.auth.status().then(setAuth).catch(() => setAuth(null));
  }, []);
  // En känd barnenhet går direkt till sin profil (plan 1.6, fas 3).
  useEffect(() => {
    if (auth?.role === 'child' && !auth.canUnlock && auth.hasPin && profiles?.length === 1) go({ name: 'child', profileId: profiles[0].id });
  }, [auth, profiles]);
  if (!profiles || auth === undefined) return html`<p class="muted">Laddar…</p>`;
  if (auth?.lan && !auth.loggedIn) return html`<${LanLogin} env=${env} />`;
  const isChild = auth?.role === 'child' && !auth.canUnlock; // canUnlock: förälder på arbetsdatorn (PIN krävs)
  if (!auth?.hasPin) {
    return isChild
      ? html`<section class="hero"><h1>Pluggkompis är inte igång än</h1><p class="lead">Be en förälder starta Pluggkompis först.</p></section>`
      : html`<${Onboarding} env=${env} go=${go} />`;
  }
  if (isChild && profiles.length === 1) return html`<p class="muted">Laddar…</p>`;
  if (auth?.canUnlock && !profiles.length) {
    return html`<section class="hero"><h1>Pluggkompis</h1><p class="lead">Här ser du bara testprofiler. Lås upp föräldraläget för att arbeta med barnens prov.</p></section>
      <p class="center parent-link"><button class="btn primary" onClick=${() => go({ name: 'parent' })}>Förälder</button></p>`;
  }
  if (isChild && !profiles.length) {
    return html`<section class="hero"><h1>Hej!</h1><p class="lead">Ditt konto är inte kopplat till någon profil än. Be en förälder koppla det under Föräldraläge → Barn.</p></section>`;
  }

  return html`
    <section class="hero">
      <h1>Vem ska plugga?</h1>
      <p class="lead">Välj ditt namn för att se dina prov.</p>
    </section>
    <div class="profiles">
      ${profiles.map(p => html`
        <button class="profile" style=${`--c:${p.color || 'var(--pen)'}`} onClick=${() => { lsSet('pk.profile', p.id); go({ name: 'child', profileId: p.id }); }}>
          <span class="avatar">${p.name.slice(0, 1).toUpperCase()}</span>
          <span class="profile-name">${p.name}</span>
          <span class="profile-grade">Årskurs ${gradeOf(p)}</span>
        </button>`)}
    </div>
    ${!isChild && html`<p class="center parent-link"><button class="btn ghost small" onClick=${() => go({ name: 'parent' })}>Förälder</button></p>`}`;
}

// Skoldatorn på hemnätet: barnet loggar in med sitt användarnamn och lösenord.
function LanLogin({ env }) {
  const [u, setU] = useState('');
  const [p, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await env.lan.login(u.trim(), p);
      if (r.ok) { location.reload(); return; }
      setErr(r.waitSeconds ? `Fel för många gånger. Vänta ${Math.ceil(r.waitSeconds / 60)} min och försök igen.` : 'Fel användarnamn eller lösenord.');
      setPw('');
    } catch (x) { setErr(errText(x)); }
    setBusy(false);
  }
  return html`<section class="hero"><h1>Logga in</h1><p class="lead">Skriv ditt användarnamn och lösenord för Pluggkompis.</p></section>
    <form class="sheet form narrow" onSubmit=${submit}>
      <label for="lan-u">Användarnamn</label>
      <input id="lan-u" autocomplete="username" autocapitalize="off" spellcheck="false" value=${u} onInput=${e => setU(e.target.value)} />
      <label for="lan-p">Lösenord</label>
      <input id="lan-p" type="password" autocomplete="current-password" value=${p} onInput=${e => setPw(e.target.value)} />
      ${err && html`<p class="notice bad">${err}</p>`}
      <div class="actions"><button class="btn primary" disabled=${busy || !u.trim() || !p}>Logga in</button></div>
    </form>`;
}

function Onboarding({ env, go }) {
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState(String(birthYearFor(5)));
  const [birthMonth, setBirthMonth] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return setErr('PIN-koden ska vara 4–6 siffror.');
    if (!name.trim()) return setErr('Skriv barnets namn.');
    setBusy(true);
    try {
      await env.auth.setPin(pin);
      await env.repo.saveProfile({ id: uid('p'), name: name.trim(), birthYear: Number(birthYear), birthMonth: birthMonth ? Number(birthMonth) : null, gradeOffset: 0, color: COLORS[0] });
      go({ name: 'start', t: Date.now() });
    } catch (x) { setErr(errText(x)); setBusy(false); }
  }

  return html`
    <section class="hero">
      <h1>Välkommen till Pluggkompis</h1>
      <p class="lead">Ladda upp material från skolan, så skapar Pluggkompis övningar som blir svårare i takt med att barnet lär sig.</p>
    </section>
    <form class="sheet form" onSubmit=${submit}>
      <h2>Kom igång</h2>
      <label for="ob-pin">Föräldra-PIN</label>
      <input id="ob-pin" inputmode="numeric" autocomplete="new-password" maxlength="6" value=${pin} onInput=${e => setPin(e.target.value.replace(/\D/g, ''))} />
      <p class="hint">Skyddar uppladdning och inställningar. 4–6 siffror.</p>
      <label for="ob-name">Barnets namn</label><input id="ob-name" value=${name} onInput=${e => setName(e.target.value)} />
      <${BirthFields} year=${birthYear} month=${birthMonth} offset=${0} onYear=${setBirthYear} onMonth=${setBirthMonth} prefix="ob" />
      ${err && html`<p class="notice bad">${err}</p>`}
      <button class="btn primary" disabled=${busy}>Spara och fortsätt</button>
    </form>`;
}

function PinGate({ env, go, setParentOk, next }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    let r;
    try { r = await env.auth.unlock(pin); } catch (x) { setErr(errText(x)); setPin(''); return; }
    if (r.ok) { setParentOk(true); go(next); return; }
    setErr(r.waitSeconds ? `Fel PIN-kod för många gånger. Vänta ${Math.ceil(r.waitSeconds / 60)} min och försök igen.` : 'Fel PIN-kod.');
    setPin('');
  }
  return html`
    <form class="sheet form narrow" onSubmit=${submit}>
      <h2>Föräldraläge</h2>
      <label for="pin">PIN-kod</label>
      <input id="pin" inputmode="numeric" autocomplete="current-password" type="password" maxlength="6" autofocus value=${pin} onInput=${e => setPin(e.target.value.replace(/\D/g, ''))} />
      ${err && html`<p class="notice bad">${err}</p>`}
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${() => go({ name: 'start' })}>Tillbaka</button>
        <button class="btn primary">Lås upp</button>
      </div>
    </form>`;
}

// ------------------------------------------------------------ Förälder

const STATUS_LABEL = {
  draft: 'Material saknas', interpreted: 'Material inläst', goals: 'Granska mål', building: 'Skapar frågor', ready: 'Klart att öva',
};

function ParentHome({ env, go }) {
  const [profiles, setProfiles] = useState(null);
  const [tests, setTests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState(null);
  const load = async () => {
    env.auth.status().then(s => setAccounts(s.accounts || null)).catch(() => {});
    const [p, t] = await Promise.all([env.repo.listProfiles(), env.repo.listTests()]);
    const withStats = await Promise.all(t.map(async x => (x.status === 'ready'
      ? { ...x, stats: summarize(await env.repo.listAttempts(x.id).catch(() => [])) }
      : x)));
    setProfiles(p); setTests(withStats);
  };
  useEffect(() => { load(); }, []);
  if (!profiles) return html`<p class="muted">Laddar…</p>`;

  return html`
    <section class="hero tight">
      <h1>Föräldraläge</h1>
      <p class="lead">Skapa prov, granska lärandemål och följ hur det går.</p>
    </section>

    <section class="block">
      <div class="block-head"><h2>Prov</h2><button class="btn primary" onClick=${() => setCreating(true)}>Nytt prov</button></div>
      ${creating && html`<${NewTestForm} env=${env} profiles=${profiles} onCancel=${() => setCreating(false)} onCreated=${id => go({ name: 'test', testId: id })} />`}
      ${!tests.length && !creating && html`<p class="empty">Inga prov än. Börja med <strong>Nytt prov</strong> och ladda upp material från skolan.</p>`}
      <ul class="list">
        ${tests.map(t => {
          const p = profiles.find(x => x.id === t.profileId);
          return html`<li><button class="list-row test-row" style=${coverVar(t.subject)} onClick=${() => go({ name: 'test', testId: t.id })}>
            <span class="lr-main"><strong>${t.subject}</strong><span class="muted small">${p ? p.name : 'Okänd profil'} · ${fmtDate(t.testDate)}</span>
              ${t.stats && html`<span class="small lr-stats">${t.stats.total
                ? `${t.stats.total} svar · ${pct(t.stats.accuracy)} rätt · senast ${relDay(t.stats.last)}${t.stats.disputed.length ? ` · ${t.stats.disputed.length} att granska` : ''}`
                : 'Inte övat än'}</span>`}</span>
            ${t.status === 'ready' && t.reviewed === false
              ? html`<span class="chip warn">Granska</span>`
              : html`<span class=${'chip ' + (t.status === 'ready' ? 'good' : t.status === 'goals' ? 'warn' : '')}>${STATUS_LABEL[t.status] || t.status}</span>`}
          </button></li>`;
        })}
      </ul>
    </section>

    <section class="block">
      <div class="block-head"><h2>Barn</h2><button class="btn ghost" onClick=${() => setEditing({ id: uid('p'), name: '', birthYear: birthYearFor(5), gradeOffset: 0, color: COLORS[profiles.length % COLORS.length], isNew: true })}>Lägg till barn</button></div>
      <ul class="list">
        ${profiles.map(p => html`<li><button class="list-row" onClick=${() => setEditing(p)}>
          <span class="lr-main"><span class="avatar sm" style=${`--c:${p.color || 'var(--pen)'}`}>${p.name.slice(0, 1)}</span><strong>${p.name}</strong></span>
          <span class="muted small">Årskurs ${gradeOf(p)}${!p.birthYear ? ' · bekräfta födelseår' : ''}${accounts && !p.account ? ' · inget konto' : ''}</span></button></li>`)}
      </ul>
      ${editing && html`<${ProfileForm} env=${env} profile=${editing} accounts=${accounts} profiles=${profiles} onDone=${() => { setEditing(null); load(); }} />`}
    </section>
    <${ParentTasks} env=${env} profiles=${profiles} />
    ${env.usage && html`<${AiUsage} env=${env} profiles=${profiles} tests=${tests} />`}`;
}

const AI_ERROR_TEXT = {
  auth: 'API-nyckeln godtas inte', permission: 'nyckeln saknar behörighet', model_not_found: 'modellen finns inte',
  no_credits: 'kontot saknar krediter', spend_limit: 'utgiftstaket är nått', rate_limited: 'Claude var överbelastat',
  prompt_too_large: 'för stort anrop', image_rejected: 'en sidbild avvisades', invalid_request: 'Anthropic avvisade anropet',
  upstream_error: 'okänt fel hos Anthropic', invalid_json: 'svaret gick inte att läsa', cancelled: 'avbrutet',
};

// AI-förbrukningen (servern): barnens anrop per dag mot dygnstaket, och provbyggena mot taket per prov.
function AiUsage({ env, profiles, tests }) {
  const [u, setU] = useState(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { env.usage().then(setU).catch(e => setErr(errText(e))); }, []);
  if (err) return html`<section class="block"><h2>AI-användning</h2><p class="notice bad">${err}</p></section>`;
  if (!u) return null;
  if (!u.enabled) return html`<section class="block"><h2>AI-användning</h2><p class="muted">AI är inte påslaget på servern.</p></section>`;
  const days = [...Array(7)].map((_, i) => { const d = new Date(u.today + 'T12:00:00'); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10); });
  const child = u.rows.filter(r => r.kind === 'child');
  const build = u.rows.filter(r => r.kind === 'build');
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const name = id => profiles.find(p => p.id === id)?.name || 'Borttagen profil';
  const subject = id => tests.find(t => t.id === id)?.subject || 'Borttaget prov';
  const tok = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n);
  const pr = u.pricing || { sek: 0, prices: {} };
  // Dollar till kronor med ECB-kursen. Under en krona visas öre.
  const kr = usd => {
    const v = usd * pr.sek;
    if (v > 0 && v < 0.01) return '< 0,01 kr';
    return v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
  };
  const usd = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const cost = rows => sum(rows, 'costIn') + sum(rows, 'costOut');
  const date = ms => ms > 0 ? new Date(ms).toLocaleDateString('sv-SE') : 'aldrig';
  const per = p => (u.totals || []).filter(t => t.period === p);
  const modelName = m => m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, c => c.toUpperCase());
  const unpriced = sum(per('30d'), 'unpriced');
  const ids = [...new Set(child.map(r => r.profileId))];
  async function refresh() {
    setRefreshing(true);
    try { const info = await env.refreshPrices(); setU(x => ({ ...x, pricing: info })); } catch (e) { setErr(errText(e)); }
    setRefreshing(false);
  }
  return html`<section class="block">
    <h2>AI-användning</h2>
    <p class="hint">Barnet: högst ${u.limits.childPerDay} anrop per dag. Ett prov: högst ${u.limits.perTest} när det byggs. Kostnaden är räknad på Anthropics priser och dagens växelkurs; den exakta summan finns i Anthropic Console.</p>
    <div class="cost-sum">
      ${[['today', 'I dag'], ['month', 'Denna månad'], ['30d', '30 dagar']].map(([p, l]) => { const rs = per(p); return html`<div>
        <span class="small muted">${l}</span><strong>${kr(cost(rs))}</strong>
        <span class="small muted">in ${kr(sum(rs, 'costIn'))}</span><span class="small muted">ut ${kr(sum(rs, 'costOut'))}</span></div>`; })}
    </div>
    ${per('month').length > 0 && html`<div class="table-scroll"><table class="usage">
      <thead><tr><th>Denna månad</th><th>Input</th><th>Output</th><th>Kostnad</th></tr></thead>
      <tbody>${per('month').map(t => html`<tr><td>${modelName(t.model)}</td>
        <td>${kr(t.costIn)}<br /><span class="muted small">${tok(t.inputTokens)} tokens</span></td><td>${kr(t.costOut)}<br /><span class="muted small">${tok(t.outputTokens)} tokens</span></td><td>${kr(t.costIn + t.costOut)}</td></tr>`)}</tbody>
    </table></div>`}
    ${unpriced > 0 && html`<p class="notice warn small">${unpriced} anrop gick till en modell utan känt pris och är inte medräknade.</p>`}
    ${!u.rows.length && html`<p class="empty">Inga AI-anrop de senaste 30 dagarna.</p>`}
    ${ids.length > 0 && html`<div class="table-scroll"><table class="usage">
      <thead><tr><th>Barn</th>${days.map(d => html`<th>${d === u.today ? 'I dag' : d.slice(5)}</th>`)}<th>30 dagar</th></tr></thead>
      <tbody>${ids.map(id => { const rs = child.filter(r => r.profileId === id); return html`<tr>
        <td>${name(id)}</td>
        ${days.map(d => { const r = rs.find(x => x.date === d); return html`<td class=${r?.limited ? 'warn' : ''}>${r ? r.calls : '–'}</td>`; })}
        <td>${sum(rs, 'calls')} anrop · ${kr(cost(rs))}</td></tr>`; })}</tbody>
    </table></div>`}
    ${build.length > 0 && html`<div class="table-scroll"><table class="usage">
      <thead><tr><th>Prov</th><th>Anrop</th><th>Tokens</th><th>Kostnad</th></tr></thead>
      <tbody>${build.map(r => html`<tr><td>${subject(r.testId)}</td><td>${r.calls} av ${u.limits.perTest}</td><td>${tok(r.inputTokens + r.outputTokens)}</td><td>${kr(r.costIn + r.costOut)}</td></tr>`)}</tbody>
    </table></div>`}
    ${sum(u.rows, 'limited') > 0 && html`<p class="small">Taket nåddes ${sum(u.rows, 'limited')} gånger (markerat).</p>`}
    ${sum(u.rows, 'failed') > 0 && html`<p class="small">${sum(u.rows, 'failed')} anrop gav fel.</p>`}
    ${pr.error && html`<p class="notice warn small">Priserna kunde inte uppdateras senast (${pr.error}). De förra gäller tills vidare.</p>`}
    <details class="small"><summary>Priser och växelkurs</summary>
      <div class="table-scroll"><table class="usage">
        <thead><tr><th>Modell</th><th>Input</th><th>Output</th></tr></thead>
        <tbody>${Object.entries(pr.prices || {}).map(([m, p]) => html`<tr><td>${modelName(m)}</td>
          <td>${usd(p.in)}${p.longOver ? html`<br /><span class="muted">${usd(p.longIn)} över ${tok(p.longOver)}</span>` : ''}</td>
          <td>${usd(p.out)}${p.longOver ? html`<br /><span class="muted">${usd(p.longOut)} över ${tok(p.longOver)}</span>` : ''}</td></tr>`)}</tbody>
      </table></div>
      <p>Dollar per miljon tokens, hämtade ${date(pr.pricesAt)}. 1 dollar = ${pr.sek.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr (ECB ${date(pr.sekAt)}). Kontrolleras en gång i veckan, senast ${date(pr.checked)}.</p>
      ${pr.changes?.length > 0 && html`<p><strong>Prisändringar:</strong></p><ul>${pr.changes.map(c => html`<li>${date(c.ts)}: ${modelName(c.model)} ${c.what}</li>`)}</ul>`}
      ${env.refreshPrices && html`<button class="btn ghost small" disabled=${refreshing} onClick=${refresh}>${refreshing ? 'Hämtar…' : 'Uppdatera nu'}</button>`}
    </details>
    ${u.errors?.length > 0 && html`<details class="small"><summary>Senaste felen</summary><ul>${u.errors.map(e => html`<li>${new Date(e.ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}: ${AI_ERROR_TEXT[e.status] || e.status}${e.model ? ` (${e.model})` : ''}${e.detail ? html`<br /><code class="small">${e.detail}</code>` : ''}</li>`)}</ul></details>`}
  </section>`;
}

// Födelseår och -månad (månaden är valfri) i stället för årskurs. Visas bara för föräldern.
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
function BirthFields({ year, month, offset, onYear, onMonth, onOffset, prefix }) {
  const now = new Date().getFullYear();
  const years = [...Array(15)].map((_, i) => now - 4 - i);
  const grade = gradeOf({ birthYear: Number(year), gradeOffset: Number(offset) || 0 });
  return html`<div class="row2">
      <div><label for=${prefix + '-by'}>Födelseår</label><select id=${prefix + '-by'} value=${String(year)} onChange=${e => onYear(e.target.value)}>
        ${years.map(y => html`<option value=${y}>${y}</option>`)}</select></div>
      <div><label for=${prefix + '-bm'}>Födelsemånad</label><select id=${prefix + '-bm'} value=${month ? String(month) : ''} onChange=${e => onMonth(e.target.value)}>
        <option value="">Vill inte ange</option>${MONTHS.map((m, i) => html`<option value=${i + 1}>${m}</option>`)}</select></div>
    </div>
    ${onOffset && html`<div><label for=${prefix + '-go'}>Årskurs</label><select id=${prefix + '-go'} value=${String(offset || 0)} onChange=${e => onOffset(Number(e.target.value))}>
      <option value="-1">Ett år efter (gått om)</option><option value="0">Som födelseåret</option><option value="1">Ett år före (börjat tidigare)</option></select></div>`}
    <p class="hint">Går i årskurs ${grade} i år. Årskursen räknas fram och byts 1 juli. Födelseåret visas aldrig för barnet.</p>`;
}

function ProfileForm({ env, profile, accounts, profiles = [], onDone }) {
  const [p, setP] = useState({
    ...profile,
    birthYear: profile.birthYear || birthYearFor(profile.grade || 5),
    gradeOffset: profile.gradeOffset || 0,
    schedule: { ...DEFAULT_SCHEDULE, ...(profile.schedule || {}) },
  });
  const sch = p.schedule;
  const setSch = patch => setP({ ...p, schedule: { ...sch, ...patch } });
  const toggleDay = i => setSch({ trainingDays: sch.trainingDays.includes(i) ? sch.trainingDays.filter(x => x !== i) : [...sch.trainingDays, i] });
  const range = (key, idx, v) => { const r = [...sch[key]]; r[idx] = Math.max(5, Math.min(120, Number(v) || 0)); setSch({ [key]: r }); };
  async function save(e) {
    e.preventDefault();
    if (!p.name.trim()) return;
    const { isNew, grade, ...rest } = p; // grade sparas inte längre, den räknas fram
    const fix = r => (r[0] > r[1] ? [r[1], r[0]] : r);
    await env.repo.saveProfile({ ...rest, name: p.name.trim(), birthYear: Number(p.birthYear), birthMonth: p.birthMonth ? Number(p.birthMonth) : null, gradeOffset: Number(p.gradeOffset) || 0, schedule: { ...sch, training: fix(sch.training), free: fix(sch.free) } });
    onDone();
  }
  return html`<form class="sheet form inset" onSubmit=${save}>
    <label for="pf-name">Namn</label><input id="pf-name" value=${p.name} onInput=${e => setP({ ...p, name: e.target.value })} />
    <${BirthFields} year=${p.birthYear} month=${p.birthMonth} offset=${p.gradeOffset} prefix="pf"
      onYear=${v => setP({ ...p, birthYear: Number(v) })} onMonth=${v => setP({ ...p, birthMonth: v ? Number(v) : null })} onOffset=${v => setP({ ...p, gradeOffset: v })} />
    <div><label for="pf-ts">Stöd på skoluppgifter</label>
      <select id="pf-ts" value=${String(p.taskSupport || 2)} onChange=${e => setP({ ...p, taskSupport: Number(e.target.value) })}>
        ${[1, 2, 3].map(n => html`<option value=${n}>${n} ${SUPPORT_LABEL[n]}</option>`)}</select>
      <p class="hint">1: bara frågor. 2: frågor och vilka stycken. 3: även vilken sorts fel, aldrig vilket ord.</p></div>
    ${accounts && html`<div><label for="pf-account">Barnets konto</label>
      <select id="pf-account" value=${p.account || ''} onChange=${e => setP({ ...p, account: e.target.value || undefined })}>
        <option value="">Inget (övar på en förälders enhet)</option>
        ${accounts.map(a => html`<option value=${a.id} disabled=${profiles.some(x => x.id !== p.id && x.account === a.id)}>${a.name}</option>`)}
      </select>
      <p class="hint">Med ett konto ser barnet bara sina egna prov på sin egen enhet.</p></div>`}
    ${accounts && env.lan && profile.account && !profile.isNew && html`<${LanCredentials} env=${env} account=${profile.account} />`}
    <div class="swatches" role="radiogroup" aria-label="Färg">
      ${COLORS.map(c => html`<button type="button" role="radio" aria-checked=${p.color === c} class=${'swatch' + (p.color === c ? ' on' : '')} style=${`--c:${c}`} onClick=${() => setP({ ...p, color: c })} aria-label="Färg"></button>`)}
    </div>
    <fieldset class="schedule">
      <legend>Pluggtid per dag</legend>
      <p class="hint">Dagsplanen håller sig inom de här spannen. Hur mycket det blir beror på hur mycket som är kvar till provet.</p>
      <p class="small"><strong>Träningsdagar</strong></p>
      <div class="weekdays">${WEEKDAYS.map((d, i) => html`<label class=${'wd' + (sch.trainingDays.includes(i) ? ' on' : '')}>
        <input type="checkbox" checked=${sch.trainingDays.includes(i)} onChange=${() => toggleDay(i)} />${d}</label>`)}</div>
      <div class="row2">
        <div><span class="small"><strong>Dagar med träning</strong></span><span class="range-in">
          <input aria-label="Minst minuter träningsdag" type="number" inputmode="numeric" min="5" max="120" value=${sch.training[0]} onInput=${e => range('training', 0, e.target.value)} /> –
          <input aria-label="Högst minuter träningsdag" type="number" inputmode="numeric" min="5" max="120" value=${sch.training[1]} onInput=${e => range('training', 1, e.target.value)} /> min</span></div>
        <div><span class="small"><strong>Övriga dagar</strong></span><span class="range-in">
          <input aria-label="Minst minuter övriga dagar" type="number" inputmode="numeric" min="5" max="120" value=${sch.free[0]} onInput=${e => range('free', 0, e.target.value)} /> –
          <input aria-label="Högst minuter övriga dagar" type="number" inputmode="numeric" min="5" max="120" value=${sch.free[1]} onInput=${e => range('free', 1, e.target.value)} /> min</span></div>
      </div>
    </fieldset>
    <div class="actions"><button type="button" class="btn ghost" onClick=${onDone}>Avbryt</button><button class="btn primary">Spara</button></div>
  </form>`;
}

// Inloggning på skoldator (hemnätet) för barnets konto. Sätts bara här, i upplåst föräldraläge.
function LanCredentials({ env, account }) {
  const [cur, setCur] = useState(undefined);
  const [u, setU] = useState('');
  const [p, setPw] = useState('');
  const [msg, setMsg] = useState(null);
  const load = () => env.lan.list().then(l => { const c = l.find(x => x.account === account) || null; setCur(c); setU(c?.username || ''); }).catch(() => setCur(null));
  useEffect(() => { load(); }, [account]);
  if (cur === undefined) return null;
  const save = async () => {
    setMsg(null);
    try { await env.lan.set(account, u.trim(), p); setPw(''); setMsg({ ok: true, text: 'Sparat. Skoldatorer som var inloggade har loggats ut.' }); load(); }
    catch (x) { setMsg({ ok: false, text: errText(x) }); }
  };
  const remove = async () => { await env.lan.remove(account).catch(() => {}); setPw(''); setMsg({ ok: true, text: 'Inloggningen är borttagen.' }); load(); };
  return html`<fieldset class="schedule">
    <legend>Inloggning på skoldator</legend>
    <p class="hint">För skoldatorn när den är på hemmets wifi. ${cur ? `Användarnamn i dag: ${cur.username}.` : 'Ingen inloggning än.'}</p>
    <div class="row2">
      <div><label for="lc-u">Användarnamn</label><input id="lc-u" autocapitalize="off" spellcheck="false" value=${u} onInput=${e => setU(e.target.value)} /></div>
      <div><label for="lc-p">${cur ? 'Nytt lösenord' : 'Lösenord'}</label><input id="lc-p" type="password" autocomplete="new-password" value=${p} onInput=${e => setPw(e.target.value)} /></div>
    </div>
    <p class="hint">Minst 8 tecken, eller en PIN på 6 siffror. Ett nytt lösenord loggar ut skoldatorn.</p>
    <div class="actions">
      ${cur && html`<button type="button" class="btn ghost" onClick=${remove}>Ta bort inloggningen</button>`}
      <button type="button" class="btn primary" disabled=${!u.trim() || !p} onClick=${save}>${cur ? 'Byt lösenord' : 'Skapa inloggning'}</button>
    </div>
    ${msg && html`<p class=${'notice ' + (msg.ok ? '' : 'bad')}>${msg.text}</p>`}
  </fieldset>`;
}

function NewTestForm({ env, profiles, onCancel, onCreated }) {
  const [t, setT] = useState({ profileId: profiles[0]?.id || '', subject: '', testDate: '', description: '' });
  const [err, setErr] = useState('');
  const prof = profiles.find(p => p.id === t.profileId);
  async function submit(e) {
    e.preventDefault();
    if (!t.profileId) return setErr('Lägg till ett barn först.');
    if (!t.subject.trim()) return setErr('Skriv vilket ämne provet gäller.');
    const id = uid('t');
    await env.repo.saveTest({ id, ...t, subject: t.subject.trim(), grade: gradeOf(prof), status: 'draft' });
    onCreated(id);
  }
  return html`<form class="sheet form inset" onSubmit=${submit}>
    <div class="row2">
      <div><label for="nt-prof">Barn</label><select id="nt-prof" value=${t.profileId} onChange=${e => setT({ ...t, profileId: e.target.value })}>
        ${profiles.map(p => html`<option value=${p.id}>${p.name} (åk ${gradeOf(p)})</option>`)}</select></div>
      <div><label for="nt-date">Provdatum</label><input id="nt-date" type="date" value=${t.testDate} onInput=${e => setT({ ...t, testDate: e.target.value })} /></div>
    </div>
    <label for="nt-subj">Ämne</label>
    <input id="nt-subj" list="subjects" placeholder="Till exempel Religion eller Kemi" value=${t.subject} onInput=${e => setT({ ...t, subject: e.target.value })} />
    <datalist id="subjects">${SUBJECTS.map(s => html`<option value=${s} />`)}</datalist>
    <label for="nt-desc">Lärarens provbeskrivning</label>
    <textarea id="nt-desc" rows="4" placeholder="Klistra in vad läraren skrivit om provet. Du kan också ladda upp ett foto av beskrivningen i nästa steg." value=${t.description} onInput=${e => setT({ ...t, description: e.target.value })}></textarea>
    ${err && html`<p class="notice bad">${err}</p>`}
    <div class="actions"><button type="button" class="btn ghost" onClick=${onCancel}>Avbryt</button><button class="btn primary">Skapa prov</button></div>
  </form>`;
}

// ------------------------------------------------------------ Provets uppsättning

function TestSetup({ env, go, testId }) {
  const { repo } = env;
  const [test, setTest] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [goals, setGoals] = useState([]);
  const [banks, setBanks] = useState({});
  const [mastery, setMastery] = useState({});
  const [attempts, setAttempts] = useState([]);
  const [events, setEvents] = useState([]);
  const [chats, setChats] = useState([]);
  const [exams, setExams] = useState([]);
  const [profile, setProfile] = useState(null);
  const [pending, setPending] = useState([]); // filer som valts men inte lästs in: { file, role }
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [bankProg, setBankProg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState('oversikt');
  const [printing, setPrinting] = useState(false);

  const reload = useCallback(async () => {
    const [t, m, g, b, ma, at, ev, profiles, ch, ex] = await Promise.all([repo.getTest(testId), repo.listMaterials(testId), repo.listGoals(testId), repo.listBanks(testId), repo.listMastery(testId), repo.listAttempts(testId).catch(() => []), repo.listEvents(testId).catch(() => []), repo.listProfiles(), repo.listChats(testId).catch(() => []), repo.listExams(testId).catch(() => [])]);
    setTest(t); setMaterials(m); setGoals(g); setBanks(b); setMastery(ma); setAttempts(at); setEvents(ev); setChats(ch); setExams(ex);
    setProfile(profiles.find(p => p.id === t?.profileId) || null);
  }, [testId]);
  useEffect(() => { reload(); }, [reload]);

  if (!test) return html`<p class="muted">Laddar…</p>`;
  const activeGoals = goals.filter(g => !g.removed);
  const step = test.status;

  async function run(label, fn) {
    setErr(''); setInfo(''); setBusy(label);
    try { await fn(); } catch (e) { setErr(errText(e)); }
    setBusy(''); await reload();
  }

  const addFiles = (files, role) => setPending(p => [...p, ...Array.from(files).filter(f => fileKind(f)).map(file => ({ file, role, key: uid() }))]);

  const readAll = () => run('Läser in material', async () => {
    let order = materials.length;
    let nextRef = Math.max(0, ...materials.map(m => Number(String(m.ref).slice(1)) || 0)) + 1;
    for (const { file, role } of pending) {
      setBusy(`Läser ${file.name}`);
      const read = await readFile(file, env.config.libs, msg => setBusy(msg));
      const ref = 'm' + nextRef++;
      const mat = { id: uid('m'), ref, name: file.name.replace(/\.[^.]+$/, ''), role, kind: read.kind, order: order++, needsAi: read.needsAi, pages: read.pages };
      let fileAssetId = null;
      if (env.files && file.size < 20 * 1024 * 1024) {
        try { fileAssetId = (await env.files.put(file)).id; } catch { /* originalet är valfritt */ }
      }
      const pages = await interpretMaterial({ ai: env.ai, config: env.config, test, mat, onProgress: setBusy });
      // Spara sidbilderna så att barnet kan se originalsidan i "Läs i materialet".
      if (env.files) {
        for (const pg of pages) {
          const img = read.pages.find(x => x.p === pg.p)?.image;
          if (!img) continue;
          setBusy(`Sparar sida ${pg.p} av ${file.name}`);
          try { pg.img = (await env.files.put(img)).url; } catch { /* sidbilden är valfri */ }
        }
      }
      await repo.saveMaterial(testId, { id: mat.id, ref: mat.ref, name: mat.name, role, kind: mat.kind, order: mat.order, fileAssetId, status: 'interpreted', pages });
      setPending(p => p.filter(x => x.file !== file));
    }
    if (test.status === 'draft') await repo.updateTest(testId, { status: 'interpreted' });
  });

  const suggestGoals = () => run('Föreslår lärandemål', async () => {
    const desc = materials.filter(m => m.role === 'beskrivning').flatMap(m => m.pages.map(p => p.text)).join('\n');
    const t = { ...test, description: [test.description, desc].filter(Boolean).join('\n\n') };
    const r = await proposeGoals({ ai: env.ai, test: t, materials });
    for (const g of goals) { await repo.deleteGoal(testId, g.id); await repo.deleteBank(testId, g.id).catch(() => {}); }
    for (const g of r.goals) await repo.saveGoal(testId, g);
    await repo.updateTest(testId, { status: 'goals', outOfScope: r.outOfScope, comment: r.comment });
    if (r.warnings.length) setInfo(`${r.warnings.length} föreslagna mål saknade källa och togs bort.`);
  });

  const makeBank = () => run('Skapar frågor', async () => {
    const missing = activeGoals.filter(g => !g.enoughMaterial && !g.parentNote?.trim());
    if (missing.length) throw new StepError(`${missing.length} mål saknar underlag. Skriv en anteckning eller ta bort dem först.`);
    await repo.updateTest(testId, { status: 'building' });
    for (const g of activeGoals) if (!g.approved) await repo.saveGoal(testId, { ...g, approved: true });
    setBusy('Skapar frågor för nivå 1–2');
    const r = await buildBank({ ai: env.ai, repo, test, goals: activeGoals, materials, existing: banks, onProgress: setBankProg });
    setBusy('Skapar fritextfrågor för nivå 3–5');
    const fresh = await repo.listBanks(testId);
    const r2 = await buildHighBank({ ai: env.ai, repo, test, goals: activeGoals, materials, existing: fresh, onProgress: setBankProg });
    setBankProg(null);
    // Barnet ser provet först när föräldern har gått igenom granskningen (reviewed).
    await repo.updateTest(testId, { status: 'ready', reviewed: false });
    const short = [...new Set([...r.short, ...r2.short])];
    if (short.length) setInfo(`Färre frågor än vanligt för: ${short.join('; ')}.`);
    setBusy('Granskar provet');
    try { await reviewNow(); } catch (e) { setErr(`Frågorna är klara, men granskningen gick inte: ${errText(e)} Tryck Granska provet under Mål.`); }
  });

  // Ett mål som läggs till när frågorna redan finns: frågorna skapas direkt, bara för det målet.
  // Blir det inga frågor tas målet bort igen, så att barnet aldrig får ett mål utan frågor.
  // pending: barnet ser inte målet (childGoal) förrän frågorna finns; avbryts det syns det för
  // föräldern som "frågorna saknas" med Skapa igen / Ta bort.
  const fillGoalNow = async (goal, isNew) => {
    try {
      const r = await buildBank({ ai: env.ai, repo, test, goals: [goal], materials, existing: banks, onProgress: setBankProg });
      const fresh = await repo.listBanks(testId);
      const r2 = await buildHighBank({ ai: env.ai, repo, test, goals: [goal], materials, existing: fresh, onProgress: setBankProg });
      const after = await repo.listBanks(testId);
      if (!(after[goal.id] || []).length) throw new StepError('Inga frågor kunde skapas för målet. Kontrollera sidorna eller skriv underlaget själv.');
      await repo.saveGoal(testId, { ...goal, pending: false });
      if ([...r.short, ...r2.short].length) setInfo(`Färre frågor än vanligt för: ${goal.text}.`);
      // Granskat prov: det nya målets frågor granskas också (annars når de barnet ogranskade).
      const cur = await repo.getTest(testId).catch(() => test); // ett läsfel får inte hoppa över granskningen
      if (cur?.review) {
        // Ett fel här tar inte bort målet: frågorna finns, och målet blir "kunde inte granskas".
        setBusy('Granskar frågorna för målet');
        try {
          const review = await reviewGoalItems({ ai: env.ai, test: cur, goal, banks: after, materials, review: cur.review });
          await repo.updateTest(testId, { review });
        } catch (e) {
          await repo.updateTest(testId, { review: { ...cur.review, unreviewed: [...new Set([...(cur.review.unreviewed || []), goal.id])] } }).catch(() => {});
          setInfo(`Målet är tillagt, men frågorna kunde inte granskas: ${errText(e)}`);
        }
      }
    } catch (e) {
      if (isNew) await repo.saveGoal(testId, { ...goal, removed: true }).catch(() => {});
      throw e;
    } finally { setBankProg(null); }
  };
  const fillGoal = goal => run('Skapar frågor för målet', () => fillGoalNow(goal, false));
  const addLateGoal = g => run('Lägger till målet och skapar frågor', async () => {
    const goal = { ...g, approved: true, pending: true, order: goals.length };
    await repo.saveGoal(testId, goal);
    await fillGoalNow(goal, true);
  });
  const pendingGoals = activeGoals.filter(g => g.pending);

  // ---- Granskningen ----
  const reviewNow = async () => {
    const fresh = await repo.listBanks(testId);
    // Beskrivningssidorna finns redan i materialet som granskaren läser; description är förälderns text.
    const review = await reviewTest({ ai: env.ai, test, goals: activeGoals.filter(g => !g.pending), banks: fresh, materials,
      onProgress: p => setBankProg({ ...p, unit: 'delar' }) });
    setBankProg(null);
    await repo.updateTest(testId, { review });
  };
  const startReview = () => run('Granskar provet', async () => { try { await reviewNow(); } finally { setBankProg(null); } });
  const decide = (keys, value) => run('Sparar', () => repo.updateTest(testId, { review: { ...test.review,
    decisions: { ...(test.review?.decisions || {}), ...Object.fromEntries([].concat(keys).map(k => [k, value])) } } }));
  const removeItem = (gid, iid) => run('Tar bort frågan', async () => {
    await repo.saveBank(testId, gid, (banks[gid] || []).filter(i => i.id !== iid));
    await repo.updateTest(testId, { review: { ...test.review, decisions: { ...(test.review?.decisions || {}), ['f:' + iid]: 'borttagen' } } });
  });
  const addSuggested = (k, i) => run('Lägger till målet och skapar frågor', async () => {
    const f = k.forslag;
    const goal = { id: 'g' + uid(), text: f.text, type: f.type, weight: 2, sources: f.sources, enoughMaterial: true, parentNote: '', note: '',
      approved: true, pending: true, removed: false, order: goals.length };
    await repo.saveGoal(testId, goal);
    await fillGoalNow(goal, true);
    // Läs om provet: fillGoalNow har just lagt till granskningen av målets frågor.
    const cur = await repo.getTest(testId);
    await repo.updateTest(testId, { review: { ...cur.review, decisions: { ...(cur.review?.decisions || {}), ['k:' + i]: 'tillagt' } } });
  });
  const approveTest = () => run('Godkänner provet', () => repo.updateTest(testId, { reviewed: true }));

  const missingSort = activeGoals.filter(g => g.type === 'samband' && !(banks[g.id] || []).some(i => i.kind === 'sort'));
  const makeSort = () => run('Skapar sorteringsövningar', async () => {
    const r = await buildSortBank({ ai: env.ai, repo, test, goals: activeGoals, materials, existing: banks, onProgress: setBankProg });
    setBankProg(null);
    if (r.short.length) setInfo(`Inga sorteringsövningar kunde skapas för: ${r.short.join('; ')}.`);
  });
  const missingHigh = activeGoals.filter(g => highLevelsFor(g).length && !(banks[g.id] || []).some(i => i.must));
  const makeHighBank = () => run('Skapar fritextfrågor för nivå 3–5', async () => {
    const r = await buildHighBank({ ai: env.ai, repo, test, goals: activeGoals, materials, existing: banks, onProgress: setBankProg });
    setBankProg(null);
    if (r.short.length) setInfo(`Färre fritextfrågor än vanligt för: ${r.short.join('; ')}.`);
  });

  const ready = step === 'ready';
  const nQuestions = Object.values(banks).reduce((a, b) => a + b.length, 0);
  const plan = ready ? buildPlan({ test, goals: activeGoals, mastery, banks, attempts, schedule: profile?.schedule || DEFAULT_SCHEDULE, offDates: test.offDates || [] }) : null;
  const toggleOff = key => run('Sparar', async () => {
    const off = test.offDates || [];
    await repo.updateTest(testId, { offDates: off.includes(key) ? off.filter(k => k !== key) : [...off, key] });
  });

  const progressView = html`<${ParentProgress} goals=${activeGoals} banks=${banks} mastery=${mastery} attempts=${attempts} events=${events} chats=${chats} exams=${exams}
        onResolve=${(a, accept) => run('Sparar', async () => {
          if (!accept) { await repo.updateAttempt(testId, a.id, { resolved: 'rejected' }); return; }
          await repo.updateAttempt(testId, a.id, { resolved: 'accepted', score: 1, verdict: 'right', originalScore: a.score });
          const goal = goals.find(g => g.id === a.goalId);
          if (goal) {
            const all = attempts.map(x => (x.id === a.id ? { ...x, score: 1 } : x));
            await repo.saveMastery(testId, replayMastery(goal, all, test.testDate, banks[goal.id], events));
          }
        })} />`;
  const disputes = attempts.filter(a => a.disputed && !a.resolved).length;
  const TABS = [['oversikt', 'Översikt', disputes], ['plan', 'Plan', 0], ['mal', 'Mål och frågor', 0], ['material', 'Material', 0]];

  const header = html`
    <button class="btn ghost small back" onClick=${() => go({ name: 'parent' })}>← Alla prov</button>
    <section class="test-head" style=${coverVar(test.subject)}>
      <div class="th-cover" aria-hidden="true"></div>
      <div class="th-body">
        <p class="eyebrow">${test.subject} · åk ${test.grade}${profile ? ` · ${profile.name}` : ''}</p>
        <h1>${whenText(test.testDate)}</h1>
        ${test.comment && html`<p class="muted">${test.comment}</p>`}
        <div class="date-edit">
          <label for="td">Provdatum</label>
          <input id="td" type="date" value=${test.testDate || ''} onChange=${e => run('Sparar', () => repo.updateTest(testId, { testDate: e.target.value }))} />
        </div>
      </div>
    </section>
    ${busy && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>${busy}${bankProg ? ` (${bankProg.done} av ${bankProg.total} ${bankProg.unit || 'mål'} klara)` : ''}</p>`}
    ${err && html`<p class="notice bad" role="alert">${err}</p>`}
    ${info && html`<p class="notice warn">${info}</p>`}`;

  if (ready) {
    return html`${header}
      <div class="tabs" role="tablist" aria-label="Provets delar">
        ${TABS.map(([id, label, badge]) => html`<button role="tab" id=${'tab-' + id} aria-selected=${tab === id} aria-controls="tabpanel"
          class=${'tab' + (tab === id ? ' on' : '')} onClick=${() => setTab(id)}>${label}${badge > 0 && html`<span class="badge">${badge}</span>`}</button>`)}
      </div>
      <div id="tabpanel" role="tabpanel" aria-labelledby=${'tab-' + tab} class="tabpanel">
        ${tab === 'oversikt' && html`<div class="tab-tools"><button class="btn ghost small" onClick=${() => setPrinting(true)}>Skriv ut och exportera</button></div>`}
        ${tab === 'oversikt' && progressView}
        ${printing && html`<${PrintSheet} env=${env} test=${test} goals=${activeGoals} banks=${banks} mastery=${mastery} materials=${materials}
          attempts=${attempts} events=${events} chats=${chats} exams=${exams} profile=${profile} onClose=${() => setPrinting(false)} />`}
        ${tab === 'plan' && html`<${PlanView} plan=${plan} test=${test} profile=${profile} onToggleOff=${toggleOff} busy=${!!busy} />`}
        ${tab === 'mal' && html`
          <section class="block flat">
            <p>${nQuestions} frågor fördelade på ${activeGoals.length} mål.</p>
            <${ReviewPanel} test=${test} goals=${activeGoals} banks=${banks} busy=${!!busy} onReview=${startReview} onDecide=${decide}
              onRemoveItem=${removeItem} onAddGoal=${addSuggested} onApprove=${approveTest} />
            ${missingHigh.length > 0 && html`<div class="notice">
              <p><strong>Fritextfrågor saknas för ${missingHigh.length} mål.</strong> Nivå 3–5, där barnet svarar med egna ord och AI rättar, skapas en gång per prov. Barnets framsteg följer med.</p>
              <div class="actions"><button class="btn primary" disabled=${!!busy} onClick=${makeHighBank}>Skapa fritextfrågor</button></div></div>`}
            ${missingSort.length > 0 && html`<div class="notice">
              <p><strong>Sorteringsövningar saknas för ${missingSort.length} mål som jämför saker.</strong> Barnet sorterar påståenden till rätt grupp, som i ett Venn-diagram. Rättas utan AI.</p>
              <div class="actions"><button class="btn primary" disabled=${!!busy} onClick=${makeSort}>Skapa sorteringsövningar</button></div></div>`}
            ${test.outOfScope?.length > 0 && html`<div class="oos"><strong>Ingår inte i provet:</strong> ${test.outOfScope.join(' · ')}</div>`}
            <ul class="goals">${activeGoals.map(g => html`<${GoalEditor} key=${g.id} goal=${g} materials=${materials} locked=${true} mastery=${mastery[g.id]} bank=${banks[g.id]} onSave=${() => {}}
              onSaveText=${!busy && (async ng => { await repo.saveGoal(testId, ng); reload(); })} />`)}</ul>
            ${pendingGoals.map(g => html`<div class="notice warn"><p><strong>Frågorna saknas för ett mål:</strong> ${g.text}. Barnet ser det inte förrän frågorna finns.</p>
              <div class="actions"><button class="btn ghost small" disabled=${!!busy} onClick=${() => run('Tar bort målet', () => repo.saveGoal(testId, { ...g, removed: true }))}>Ta bort</button>
                <button class="btn primary small" disabled=${!!busy} onClick=${() => fillGoal(g)}>Skapa frågor igen</button></div></div>`)}
            ${!busy && html`<${AddGoal} materials=${materials} late onAdd=${addLateGoal} />`}
            <${BankPreview} goals=${activeGoals} banks=${banks} materials=${materials} onDelete=${async (gid, iid) => { await repo.saveBank(testId, gid, banks[gid].filter(i => i.id !== iid)); reload(); }} />
          </section>`}
        ${tab === 'material' && html`
          <section class="block flat"><${MaterialList} materials=${materials} /></section>
          <section class="block danger-zone">
            ${confirmDelete
              ? html`<p>Ta bort provet med allt material, alla frågor och all historik?</p>
                  <div class="actions"><button class="btn ghost" onClick=${() => setConfirmDelete(false)}>Avbryt</button>
                  <button class="btn bad" onClick=${async () => { await repo.deleteTest(testId); go({ name: 'parent' }); }}>Ta bort provet</button></div>`
              : html`<button class="btn ghost small" onClick=${() => setConfirmDelete(true)}>Ta bort provet</button>`}
          </section>`}
      </div>`;
  }

  return html`${header}
    <ol class="steps">
      ${[['Material', ['interpreted', 'goals', 'building', 'ready']], ['Lärandemål', ['building', 'ready']], ['Frågor', ['ready']]].map(([label, doneIn], i) => html`
        <li class=${doneIn.includes(step) ? 'done' : ''}><span class="step-n">${i + 1}</span>${label}</li>`)}
    </ol>

    <section class="block">
      <div class="block-head"><h2>1. Material</h2></div>
      <${MaterialList} materials=${materials} />
      ${!ready && html`
        <${DropZone} disabled=${!!busy} onFiles=${f => addFiles(f, 'material')} label="Lägg till material" hint="PDF, Word, PowerPoint eller foton av boksidor" />
        <${DropZone} disabled=${!!busy} small onFiles=${f => addFiles(f, 'beskrivning')} label="Foto av provbeskrivningen (valfritt)" hint="Om läraren delat ut en lapp" accept="image/*,application/pdf" />
        ${pending.length > 0 && html`
          <ul class="pending">${pending.map(p => html`<li><span>${p.file.name}</span><span class="muted small">${p.role === 'beskrivning' ? 'Provbeskrivning' : 'Material'}</span>
            <button class="link" disabled=${!!busy} onClick=${() => setPending(x => x.filter(y => y.key !== p.key))}>Ta bort</button></li>`)}</ul>
          <button class="btn primary" disabled=${!!busy} onClick=${readAll}>Läs in ${pending.length} ${pending.length === 1 ? 'fil' : 'filer'}</button>`}`}
    </section>

    <section class="block">
      <div class="block-head"><h2>2. Lärandemål</h2>
        ${materials.length > 0 && !ready && html`<button class="btn ${activeGoals.length ? 'ghost' : 'primary'}" disabled=${!!busy} onClick=${suggestGoals}>${activeGoals.length ? 'Föreslå igen' : 'Föreslå lärandemål'}</button>`}</div>
      ${!activeGoals.length && html`<p class="empty">${materials.length ? 'Låt Claude föreslå lärandemål utifrån materialet och provbeskrivningen.' : 'Läs in material först.'}</p>`}
      ${test.outOfScope?.length > 0 && html`<div class="oos"><strong>Ingår inte i provet:</strong> ${test.outOfScope.join(' · ')}</div>`}
      <ul class="goals">
        ${activeGoals.map(g => html`<${GoalEditor} key=${g.id} goal=${g} materials=${materials} locked=${ready || !!busy}
            mastery=${mastery[g.id]} bank=${banks[g.id]} onSave=${async ng => { await repo.saveGoal(testId, ng); reload(); }}
            onSaveText=${ready && !busy && (async ng => { await repo.saveGoal(testId, ng); reload(); })} />`)}
      </ul>
      ${activeGoals.length > 0 && !ready && html`<${AddGoal} materials=${materials} onAdd=${async g => { await repo.saveGoal(testId, { ...g, order: goals.length }); reload(); }} />`}
    </section>

    <section class="block">
      <div class="block-head"><h2>3. Frågor</h2></div>
      ${ready
        ? html`<p>${nQuestions} frågor fördelade på ${activeGoals.length} mål. Barnet kan börja öva.</p>
            ${missingHigh.length > 0 && html`<div class="notice">
              <p><strong>Fritextfrågor saknas för ${missingHigh.length} mål.</strong> Nivå 3–5, där barnet svarar med egna ord och AI rättar, skapas en gång per prov. Barnets framsteg följer med.</p>
              <div class="actions"><button class="btn primary" disabled=${!!busy} onClick=${makeHighBank}>Skapa fritextfrågor</button></div></div>`}
            <${BankPreview} goals=${activeGoals} banks=${banks} materials=${materials} onDelete=${async (gid, iid) => { await repo.saveBank(testId, gid, banks[gid].filter(i => i.id !== iid)); reload(); }} />`
        : activeGoals.length > 0
          ? html`<p class="muted">När du har granskat målen skapas frågor för alla nivåer: klickfrågor för nivå 1–2 och fritextfrågor med bedömningsmall för nivå 3–5. Det tar några minuter.</p>
              <button class="btn primary" disabled=${!!busy} onClick=${makeBank}>Godkänn mål och skapa frågor</button>`
          : html`<p class="empty">Frågorna skapas när lärandemålen är godkända.</p>`}
    </section>

    <section class="block danger-zone">
      ${confirmDelete
        ? html`<p>Ta bort provet med allt material, alla frågor och all historik?</p>
            <div class="actions"><button class="btn ghost" onClick=${() => setConfirmDelete(false)}>Avbryt</button>
            <button class="btn bad" onClick=${async () => { await repo.deleteTest(testId); go({ name: 'parent' }); }}>Ta bort provet</button></div>`
        : html`<button class="btn ghost small" onClick=${() => setConfirmDelete(true)}>Ta bort provet</button>`}
    </section>`;
}

function PlanView({ plan, test, profile, onToggleOff, busy }) {
  if (!test.testDate) return html`<section class="block"><div class="block-head"><h2>Dagsplan</h2></div>
    <p class="empty">Sätt ett provdatum ovan, så räknas en dagsplan fram.</p></section>`;
  if (!plan || plan.tooLate) return html`<section class="block"><div class="block-head"><h2>Dagsplan</h2></div>
    <p class="muted">Provdatumet har passerat.</p></section>`;
  const today = dayKey(Date.now());
  const maxMin = Math.max(30, ...plan.allDays.map(d => Math.max(d.minutes || 0, d.done || 0)));
  const fmt = k => new Date(k + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
  const left = plan.days.filter(d => !d.off).reduce((a, d) => a + (d.minutes || 0), 0) - (plan.today?.done || 0);
  return html`<section class="block plan">
    <div class="block-head"><h2>Dagsplan</h2><span class="muted small">${profile?.schedule?.trainingDays?.length ? '' : 'Ange träningsdagar under Barn'}</span></div>
    <p>Ungefär <strong>${Math.max(0, left)} minuter</strong> kvar fram till provet. Planen räknas om efter varje pass, så den anpassar sig om ${profile?.name || 'barnet'} ligger före eller efter.</p>
    ${plan.shortfall > 0 && html`<p class="notice warn">Allt ryms inte inom tiderna: ungefär ${plan.shortfall} minuter saknas. Höj tiden för ${profile?.name || 'barnet'} under Barn, ta bort mål som är mindre viktiga, eller räkna med att de högsta nivåerna inte hinns med.</p>`}
    <ol class="plan-days">${plan.allDays.map(d => {
      const isToday = d.key === today;
      const planned = d.off ? 0 : (d.minutes || 0);
      return html`<li class=${'pd' + (isToday ? ' today' : '') + (d.past ? ' past' : '') + (d.off ? ' off' : '')}>
        <span class="pd-date">${isToday ? 'I dag' : fmt(d.key)}${d.training ? html`<span class="pd-tr" title="Träningsdag">träning</span>` : ''}</span>
        <span class=${'pd-phase ph-' + (d.off ? 'off' : d.phase)}>${d.off ? 'Ledig' : PHASE_LABEL[d.phase]}</span>
        <span class="pd-bar" aria-hidden="true">
          ${!d.past && planned > 0 && html`<span class="pd-plan" style=${`width:${(planned / maxMin) * 100}%`}></span>`}
          ${d.done > 0 && html`<span class="pd-done" style=${`width:${(Math.min(d.done, maxMin) / maxMin) * 100}%`}></span>`}
        </span>
        <span class="pd-min">${d.past ? `${d.done} min` : d.off ? '–' : `${d.done ? `${d.done} / ` : ''}${planned} min`}</span>
        ${!d.past && html`<button class="link small pd-toggle" disabled=${busy} onClick=${() => onToggleOff(d.key)}>${d.off ? 'Plugga' : 'Ledig'}</button>`}
      </li>`;
    })}</ol>
    <p class="small muted">Bekanta: korta pass och några nya mål i taget. Bygga: huvuddelen av arbetet. Befästa: svaga mål och repetition. Lugnt: kort repetition dagen före provet.</p>
  </section>`;
}

function givenText(item, given) {
  if (!item) return String(given ?? '');
  if (item.kind === 'mcq') return item.options[given] ?? '';
  if (item.kind === 'match') return item.pairs.map(([l]) => `${l} – ${(given || {})[l] || '?'}`).join('\n');
  if (item.kind === 'order' && Array.isArray(given)) return given.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return String(given ?? '');
}

function ParentProgress({ goals, banks, mastery, attempts, events = [], chats: allChats = [], exams = [], onResolve }) {
  const chats = allChats.filter(c => c.kind !== 'teach');
  const teaches = allChats.filter(c => c.kind === 'teach');
  const goalText = id => goals.find(g => g.id === id)?.text || 'Borttaget mål';
  const jumps = Object.values(mastery).flatMap(m => m.jumps || []);
  const jumpText = jumps.length
    ? `Hoppade upp en nivå själv ${jumps.length} ${jumps.length === 1 ? 'gång' : 'gånger'}: ${jumps.filter(j => j.held === true).length} höll, ${jumps.filter(j => j.held === false).length} gick tillbaka${jumps.some(j => j.held == null) ? `, ${jumps.filter(j => j.held == null).length} pågår` : ''}.`
    : '';
  const s = useMemo(() => summarize(attempts), [attempts]);
  const itemById = useMemo(() => Object.fromEntries(Object.values(banks).flat().map(i => [i.id, i])), [banks]);
  const overall = testProgress(goals, mastery, banks);
  const graded = attempts.filter(a => a.grading && a.grading.tier !== 'lokal');
  const ai = {
    total: graded.length,
    fastOnly: graded.filter(a => !a.grading.escalated && a.grading.tier === TIERS.fast).length,
    careful: graded.filter(a => a.grading.tier === TIERS.careful).length,
    escalated: graded.filter(a => a.grading.escalated).length,
    calls: graded.reduce((n, a) => n + (a.grading.calls || 1), 0),
    selfGraded: attempts.filter(a => a.grading?.tier === 'själv').length,
  };
  const maxDay = Math.max(1, ...s.byDay.map(d => d.right + d.almost + d.wrong));
  const rows = goals.map(g => {
    const st = s.byGoal[g.id];
    const recent = st ? st.recent.reduce((a, x) => a + x, 0) / st.recent.length : null;
    return { g, st, recent, m: mastery[g.id] };
  }).sort((a, b) => {
    if (!a.st !== !b.st) return a.st ? -1 : 1;
    if (!a.st) return 0;
    return (a.recent - b.recent) || (b.st.n - a.st.n);
  });
  const weak = rows.filter(r => r.st && r.st.n >= 3 && r.recent < 0.6);

  return html`<section class="block progress">
    <div class="block-head"><h2>Så går det</h2><span class="muted small">${s.total ? `Senast övat ${relDay(s.last)}` : 'Inte övat än'}</span></div>

    <dl class="stats">
      <div><dt>Mål klara</dt><dd>${pct(overall)}</dd></div>
      <div><dt>Svar</dt><dd>${s.total}</dd></div>
      <div><dt>Rätt</dt><dd>${pct(s.accuracy)}</dd></div>
      <div><dt>Övningspass</dt><dd>${s.sessions}<span class="unit"> på ${s.practiceDays} ${s.practiceDays === 1 ? 'dag' : 'dagar'}</span></dd></div>
    </dl>
    ${s.total > 0 && html`<p class="small muted">${s.right} rätt, ${s.almost} nästan rätt och ${s.wrong} fel. Ungefär ${s.minutes} minuters övning totalt.${s.helped ? ` ${s.helped} svar gavs efter att ha tittat i materialet och räknas som övning.` : ''}${jumpText ? ' ' + jumpText : ''}</p>`}

    ${s.total > 0 && html`<figure class="days">
      <figcaption class="small muted">Svar per dag, senaste 14 dagarna</figcaption>
      <div class="day-bars">${s.byDay.map((d, i) => {
        const n = d.right + d.almost + d.wrong;
        const h = v => `height:${(v / maxDay) * 100}%`;
        const label = new Date(d.key + 'T12:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
        return html`<div class="day" title=${`${label}: ${n} svar, ${d.right} rätt, ${d.almost} nästan, ${d.wrong} fel`}>
          <div class="day-stack">${n > 0 && html`<span class="seg wrong" style=${h(d.wrong)}></span><span class="seg almost" style=${h(d.almost)}></span><span class="seg right" style=${h(d.right)}></span>`}</div>
          <span class="day-n">${n || ''}</span>
          <span class="day-label">${i % 2 === 1 || i === s.byDay.length - 1 ? label.replace('.', '') : ''}</span>
        </div>`;
      })}</div>
      <div class="legend small"><span><i class="sw right"></i>Rätt</span><span><i class="sw almost"></i>Nästan</span><span><i class="sw wrong"></i>Fel</span></div>
    </figure>`}

    ${ai.total > 0 && html`<p class="small muted ai-line">AI-rättade fritextsvar: ${ai.total}. ${ai.fastOnly} rättades av den snabba modellen, ${ai.careful} av den noggranna (${ai.escalated} efter kontroll). Totalt ${ai.calls} AI-anrop för rättning.${ai.selfGraded ? ` ${ai.selfGraded} svar bedömde barnet själv när AI inte fanns.` : ''}</p>`}

    ${weak.length > 0 && html`<div class="notice warn"><strong>Behöver mer övning:</strong> ${weak.map(r => r.g.text.replace(/^kunna\s+/i, '')).join(' · ')}</div>`}

    ${s.disputed.length > 0 && html`<div class="disputes">
      <h3>Att granska (${s.disputed.length})</h3>
      <p class="small muted">Svar där barnet tycker att rättningen blev fel. "Räkna som rätt" ändrar både statistiken och nivån, som om svaret hade rättats som rätt från början.</p>
      <ul class="list">${s.disputed.map(a => {
        const it = itemById[a.itemId];
        return html`<li class="dispute">
          <p><strong>${it ? it.q : 'Frågan finns inte längre'}</strong></p>
          <p class="small">Svarade: <span class="pre">${givenText(it, a.answer)}</span></p>
          ${it && html`<p class="small muted">${isFree(it) ? 'Exempel på bra svar' : 'Facit'}: <span class="pre">${correctAnswerText(it)}</span></p>`}
          ${it?.must && a.grading?.met && html`<ul class="checks small">${it.must.map((m, i) => html`<li class=${a.grading.met[i] ? 'ok' : 'no'}>${m}</li>`)}</ul>`}
          ${a.grading?.feedback && html`<p class="small muted">AI:s kommentar: ${a.grading.feedback}${a.grading.tier === TIERS.careful ? ' (noggrann modell)' : ''}</p>`}
          <div class="actions"><button class="btn ghost small" onClick=${() => onResolve(a, false)}>Rättningen stämmer</button>
            <button class="btn primary small" onClick=${() => onResolve(a, true)}>Räkna som rätt</button></div>
        </li>`;
      })}</ul>
    </div>`}

    ${exams.length > 0 && html`<div class="exams">
      <h3>Provläge</h3>
      <ul class="list">${exams.slice().sort((a, b) => b.ts - a.ts).slice(0, 6).map(x => {
        const weak = [...new Set(x.items.filter(i => i.score < 1).map(i => i.goalId))];
        return html`<li class="exam-row">
          <span class="er-score">${Math.round((x.points / Math.max(1, x.max)) * 100)} %</span>
          <span><strong>${relDay(x.ts)}</strong> · ${String(Math.round(x.points * 2) / 2).replace('.', ',')} av ${x.max} poäng · ${Math.max(1, Math.round(((x.endTs || x.ts) - x.ts) / 60000))} min
            ${weak.length > 0 && html`<br /><span class="small muted">Inte helt rätt: ${weak.map(goalText).map(t => t.replace(/^kunna\s+/i, '')).join('; ')}</span>`}</span>
        </li>`;
      })}</ul>
    </div>`}

    ${teaches.length > 0 && html`<details class="chats">
      <summary><h3>Lär ut det (${teaches.length})</h3></summary>
      <p class="small muted">Barnet har förklarat för sin kompis med egna ord. Senaste först.</p>
      <ul class="list">${teaches.slice().sort((a, b) => b.ts - a.ts).slice(0, 10).map(c => html`<li class="chat-log">
        <p class="small muted">${relDay(c.ts)} · ${c.q} · ${'★'.repeat(c.stars || 0)}${'☆'.repeat(3 - (c.stars || 0))}</p>
        ${c.messages.filter(m => m.role === 'user').map(m => html`<p class="chat-ask">${m.text}</p>`)}
        ${c.missing?.length > 0 && html`<p class="small">Saknades: ${c.missing.join('; ')}</p>`}
        ${c.wrong && html`<p class="small">Missförstånd: ${c.wrong}</p>`}
      </li>`)}</ul>
    </details>`}

    ${chats.length > 0 && html`<details class="chats">
      <summary><h3>Frågor till AI (${chats.length})</h3></summary>
      <p class="small muted">Det här har barnet velat förstå bättre via "Förklara mer". Senaste först.</p>
      <ul class="list">${chats.slice().sort((a, b) => b.ts - a.ts).slice(0, 15).map(c => html`<li class="chat-log">
        <p class="small muted">${relDay(c.ts)} · ${c.q}</p>
        ${c.messages.filter(m => m.role === 'user' && m.text).map(m => html`<p class="chat-ask">${m.text}</p>`)}
        ${!c.messages.some(m => m.role === 'user' && m.text) && html`<p class="small muted">Läste förklaringen, inga egna följdfrågor.</p>`}
      </li>`)}</ul>
    </details>`}

    <div class="table-wrap"><table class="goal-table">
      <thead><tr><th scope="col">Mål</th><th scope="col">Nivå</th><th scope="col" class="num">Svar</th><th scope="col" class="num">Rätt senaste 5</th><th scope="col">Senast</th></tr></thead>
      <tbody>${rows.map(({ g, st, recent, m }) => html`<tr>
        <td>${g.text}</td>
        <td><${LevelPips} goal=${g} mastery=${m} bank=${banks[g.id]} /></td>
        <td class="num">${st ? st.n : 0}</td>
        <td class=${'num' + (recent != null && recent < 0.6 ? ' low' : '')}>${pct(recent)}</td>
        <td class="small">${st ? relDay(st.last) : '–'}</td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

function DropZone({ onFiles, label, hint, disabled, small, accept }) {
  const [over, setOver] = useState(false);
  const id = useMemo(() => uid('f'), []);
  return html`<label for=${id} class=${'drop' + (over ? ' over' : '') + (small ? ' small' : '') + (disabled ? ' disabled' : '')}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); if (!disabled) onFiles(e.dataTransfer.files); }}>
    <input id=${id} type="file" multiple disabled=${disabled} accept=${accept || '.pdf,.docx,.pptx,.txt,.md,image/*'} onChange=${e => { onFiles(e.target.files); e.target.value = ''; }} />
    <span class="drop-label">${label}</span><span class="muted small">${hint}</span>
  </label>`;
}

function MaterialList({ materials }) {
  if (!materials.length) return null;
  const KIND = { fakta: 'Fakta', fragor: 'Frågor', arbetsblad: 'Arbetsblad', glosor: 'Glosor', ovrigt: 'Övrigt' };
  return html`<ul class="materials">${materials.map(m => html`<li>
    <details>
      <summary><span class="ref">${m.ref}</span><strong>${m.name}</strong>
        <span class="muted small">${m.role === 'beskrivning' ? 'Provbeskrivning · ' : ''}${m.pages.length} ${m.pages.length === 1 ? 'sida' : 'sidor'} · ${[...new Set(m.pages.map(p => KIND[p.kind] || p.kind))].join(', ')}</span></summary>
      ${m.pages.map(p => html`<div class="page-text"><p class="eyebrow">Sida ${p.p} · ${KIND[p.kind] || p.kind}</p><pre>${p.text}</pre></div>`)}
    </details></li>`)}</ul>`;
}

function SourceChips({ sources, materials }) {
  return html`<span class="sources">${sources.map(s => {
    const m = materials.find(x => x.ref === s.m);
    return html`<span class="src" title=${m ? m.name : s.m}>${m ? m.name : s.m}, s. ${s.p}</span>`;
  })}</span>`;
}

// Fem rutor: fylld = klarad nivå, halvfylld = nivån barnet övar på, streckad = finns för
// måltypen men saknar frågor än, nästan osynlig = nivån hör inte till måltypen.
function LevelPips({ goal, mastery, bank }) {
  const typeMax = practiceMax(goal);
  const max = practiceMax(goal, bank);
  const lvl = mastery?.level || 0;
  return html`<span class="pips" aria-label=${mastery ? `Nivå ${lvl} av ${typeMax}${mastery.passedMax && lvl >= max ? ', klar' : ''}` : 'Inte övat'}>
    ${[1, 2, 3, 4, 5].map(l => html`<span class=${'pip'
      + (l > typeMax ? ' na' : l > max ? ' later' : '')
      + (l < lvl || (l === lvl && mastery?.passedMax) ? ' full' : l === lvl ? ' now' : '')}></span>`)}
  </span>`;
}

function GoalEditor({ goal, materials, locked, onSave, onSaveText, mastery, bank }) {
  const [g, setG] = useState(goal);
  const [dirty, setDirty] = useState(false);
  const [editText, setEditText] = useState(null); // texten under ändring när målet är låst
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  useEffect(() => { setG(goal); setDirty(false); setEditText(null); }, [goal]);
  const upd = patch => { setG({ ...g, ...patch }); setDirty(true); };
  const needsNote = !g.enoughMaterial;

  if (locked) {
    // Låst när frågorna finns: bara texten går att ändra, eftersom typ och källor styr frågorna.
    const text = editText?.trim();
    const saveText = async () => {
      setSaving(true); setSaveErr('');
      try { await onSaveText({ ...goal, text }); } catch { setSaveErr('Det gick inte att spara. Försök igen.'); }
      setSaving(false);
    };
    return html`<li class="goal locked">
      <div class="goal-top"><span class=${'type t-' + g.type}>${TYPE_LABEL[g.type]}</span><${LevelPips} goal=${g} mastery=${mastery} bank=${bank} /></div>
      ${editText == null
        ? html`<p class="goal-text">${g.text}</p>`
        : html`<textarea aria-label="Lärandemål" rows="2" value=${editText} onInput=${e => setEditText(e.target.value)}></textarea>
          <p class="small muted">Barnet ser målet, så skriv inte svaret i det. Frågorna ändras inte.</p>`}
      <div class="goal-meta"><${SourceChips} sources=${g.sources} materials=${materials} />${bank && html`<span class="muted small">${bank.length} frågor</span>`}
        ${onSaveText && html`<span class="goal-actions">${editText == null
          ? html`<button class="link" onClick=${() => setEditText(g.text)}>Ändra texten</button>`
          : html`<button class="link" onClick=${() => { setEditText(null); setSaveErr(''); }}>Avbryt</button>
            <button class="btn primary small" disabled=${!text || text === g.text || saving} onClick=${saveText}>Spara</button>`}</span>`}</div>
      ${saveErr && html`<p class="notice bad">${saveErr}</p>`}
    </li>`;
  }
  return html`<li class=${'goal' + (needsNote && !g.parentNote ? ' attention' : '')}>
    <div class="goal-top">
      <select aria-label="Typ" value=${g.type} onChange=${e => upd({ type: e.target.value })}>${GOAL_TYPES.map(t => html`<option value=${t}>${TYPE_LABEL[t]}</option>`)}</select>
      <select aria-label="Vikt" value=${g.weight} onChange=${e => upd({ weight: Number(e.target.value) })}>
        <option value="1">Mindre viktigt</option><option value="2">Viktigt</option><option value="3">Mycket viktigt</option></select>
    </div>
    <textarea aria-label="Lärandemål" rows="2" value=${g.text} onInput=${e => upd({ text: e.target.value })}></textarea>
    ${g.type === 'matematik' && html`<select aria-label="Färdighet" value=${g.skill || ''} onChange=${e => upd({ skill: e.target.value })}>
      <option value="">Välj färdighet</option>${Object.entries(SKILLS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}
    ${g.type === 'glosa' && html`<div class="row2">
      <input aria-label="Ord" value=${g.term || ''} onInput=${e => upd({ term: e.target.value })} placeholder="Ord" />
      <input aria-label="Översättning" value=${g.translation || ''} onInput=${e => upd({ translation: e.target.value })} placeholder="Översättning" /></div>`}
    ${g.note && html`<p class="small muted">${g.note}</p>`}
    ${needsNote && html`<div class="needs"><p><strong>Underlag saknas i materialet.</strong> Skriv vad barnet ska kunna svara, eller ta bort målet.</p>
      <textarea aria-label="Förälderns anteckning" rows="2" placeholder="Till exempel vad som hände i laborationen och varför" value=${g.parentNote || ''} onInput=${e => upd({ parentNote: e.target.value })}></textarea></div>`}
    <div class="goal-meta">
      <${SourceChips} sources=${g.sources} materials=${materials} />
      <span class="goal-actions">
        <button class="link" onClick=${() => onSave({ ...g, removed: true })}>Ta bort</button>
        ${dirty && html`<button class="btn primary small" onClick=${() => onSave(g)}>Spara</button>`}
      </span>
    </div>
  </li>`;
}

// Granskningen av ett färdigt prov: lärarens krav mot målen och frågorna mot materialet.
// Granskaren ändrar ingenting; föräldern beslutar om varje fynd och godkänner provet.
function ReviewPanel({ test, goals, banks, busy, onReview, onDecide, onRemoveItem, onAddGoal, onApprove }) {
  const r = test.review;
  const dec = r?.decisions || {};
  const item = f => (banks[f.goalId] || []).find(i => i.id === f.id);
  const gaps = (r?.krav || []).map((k, i) => ({ ...k, i })).filter(k => k.status !== 'täckt');
  const openGaps = gaps.filter(k => !dec['k:' + k.i]);
  const flags = (r?.fynd || []).filter(f => item(f));
  const openFlags = flags.filter(f => !dec['f:' + f.id]);
  const unrev = (r?.unreviewed || []).filter(id => goals.some(g => g.id === id) && !dec['u:' + id]);
  const open = openGaps.length + openFlags.length + unrev.length;
  const covered = (r?.krav || []).filter(k => k.status === 'täckt');
  const goalText = id => goals.find(g => g.id === id)?.text || '';
  return html`<section class="review">
    <div class="block-head"><h3>Granskning</h3>
      ${r && html`<button class="btn ghost small" disabled=${busy} onClick=${onReview}>Granska igen</button>`}</div>
    ${!r && html`<p>En AI-granskare jämför lärarens krav med målen och varje fråga med materialet. Den ändrar inget; du beslutar om varje fynd. Tar några minuter och kostar runt en krona.</p>
      <div class="actions left"><button class="btn primary" disabled=${busy} onClick=${onReview}>Granska provet</button></div>`}
    ${r && html`
      <p class="small muted">Granskat ${new Date(r.at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}. ${r.summary}</p>
      ${r.errors?.length > 0 && html`<p class="notice warn small">Delar av granskningen gick inte att läsa (${r.errors.length}). Granska igen om något verkar saknas.</p>`}
      <h4>Lärarens krav</h4>
      <p class="small">${covered.length} av ${(r.krav || []).length} krav täcks av målen.${gaps.length ? ` ${gaps.length} saknas helt eller delvis:` : ''}</p>
      ${gaps.length > 0 && html`<ul class="review-list">${gaps.map(k => html`<li class=${dec['k:' + k.i] ? 'done' : ''}>
        <p><span class=${'chip ' + (k.status === 'saknas' ? 'bad' : 'warn')}>${k.status === 'saknas' ? 'Saknas' : 'Delvis'}</span> ${k.krav}</p>
        ${k.forslag && html`<p class="small muted">Förslag: ${k.forslag.text} (${TYPE_LABEL[k.forslag.type]})</p>`}
        ${dec['k:' + k.i]
          ? html`<p class="small muted">${dec['k:' + k.i] === 'tillagt' ? 'Målet är tillagt.' : 'Behövs inte.'}</p>`
          : html`<div class="actions left">
              ${k.forslag && html`<button class="btn primary small" disabled=${busy} onClick=${() => onAddGoal(k, k.i)}>Lägg till målet</button>`}
              <button class="btn ghost small" disabled=${busy} onClick=${() => onDecide('k:' + k.i, 'behövs-inte')}>Behövs inte</button></div>`}
      </li>`)}</ul>`}
      ${covered.length > 0 && html`<details class="small"><summary>Täckta krav</summary><ul>${covered.map(k => html`<li>${k.krav}</li>`)}</ul></details>`}
      <h4>Frågorna</h4>
      ${unrev.length > 0 && html`<div class="notice warn small"><p>Frågorna för ${unrev.length} mål kunde inte granskas: ${unrev.map(goalText).join('; ')}. Granska igen, eller titta själv.</p>
        <div class="actions left"><button class="btn ghost small" disabled=${busy} onClick=${() => onDecide(unrev.map(id => 'u:' + id), 'tittat')}>Jag har tittat själv</button></div></div>`}
      <p class="small">${flags.length ? `${flags.length} ${flags.length === 1 ? 'fråga har' : 'frågor har'} anmärkningar:` : 'Inga anmärkningar på frågorna.'}</p>
      ${flags.length > 0 && html`<ul class="review-list">${flags.map(f => { const it = item(f); return html`<li class=${dec['f:' + f.id] ? 'done' : ''}>
        <p class="small muted">${goalText(f.goalId)} · nivå ${it.level}</p>
        <p><strong>${it.q}</strong></p>
        <p class="small">Rätt svar enligt frågan: ${correctAnswerText(it)}</p>
        <p class="small"><span class="chip warn">${REVIEW_PROBLEMS[f.problem] || f.problem}</span> ${f.vad}</p>
        ${dec['f:' + f.id]
          ? html`<p class="small muted">${dec['f:' + f.id] === 'borttagen' ? 'Frågan är borttagen.' : 'Behålls.'}</p>`
          : html`<div class="actions left">
              <button class="btn primary small" disabled=${busy} onClick=${() => onRemoveItem(f.goalId, f.id)}>Ta bort frågan</button>
              <button class="btn ghost small" disabled=${busy} onClick=${() => onDecide('f:' + f.id, 'behåll')}>Behåll</button></div>`}
      </li>`; })}</ul>`}`}
    ${test.reviewed === false && html`<div class="notice">
      <p>${open ? `${open} fynd är inte hanterade.` : r ? 'Allt i granskningen är hanterat.' : 'Provet är inte granskat.'} Barnet ser provet när du godkänner det.</p>
      <div class="actions left"><button class="btn primary" disabled=${busy} onClick=${onApprove}>${open || !r ? 'Godkänn ändå' : 'Godkänn provet'}</button></div></div>`}
  </section>`;
}

function AddGoal({ materials, onAdd, late }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [type, setType] = useState('fakta');
  const [skill, setSkill] = useState('');
  const [note, setNote] = useState('');
  const [mref, setMref] = useState(materials[0]?.ref || '');
  const [pages, setPages] = useState('');
  if (!open) return html`<button class="btn ghost" onClick=${() => setOpen(true)}>Lägg till eget mål</button>`;
  const mat = materials.find(m => m.ref === mref) || materials[0];
  const chosen = mat ? parsePages(pages, mat.pages || []) : [];
  const sources = chosen.map(p => ({ m: mat.ref, p }));
  const ok = text.trim() && (type !== 'matematik' || skill) && (sources.length || note.trim());
  const add = () => {
    onAdd({ id: 'g' + uid(), text: text.trim(), type, ...(type === 'matematik' ? { skill } : {}), weight: 2, sources,
      enoughMaterial: !!note.trim() || sources.length > 0, parentNote: note.trim(), note: '', approved: false, removed: false });
    setOpen(false); setText(''); setNote(''); setPages('');
  };
  return html`<div class="sheet form inset">
    <label for="ag-text">Lärandemål</label><input id="ag-text" placeholder="Kunna ..." value=${text} onInput=${e => setText(e.target.value)} />
    <p class="hint">Barnet ser målet, så skriv inte svaret i det.</p>
    <label for="ag-type">Typ</label><select id="ag-type" value=${type} onChange=${e => setType(e.target.value)}>${GOAL_TYPES.filter(t => t !== 'glosa').map(t => html`<option value=${t}>${TYPE_LABEL[t]}</option>`)}</select>
    ${type === 'matematik' && html`<label for="ag-skill">Färdighet</label><select id="ag-skill" value=${skill} onChange=${e => setSkill(e.target.value)}>
      <option value="">Välj färdighet</option>${Object.entries(SKILLS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <p class="hint">Uppgifterna och facit räknas fram av programmet, inte av AI.</p>`}
    ${materials.length > 0 && html`<div class="row2">
      <div><label for="ag-mat">Var står det?</label><select id="ag-mat" value=${mref} onChange=${e => setMref(e.target.value)}>
        ${materials.map(m => html`<option value=${m.ref}>${m.name}</option>`)}</select></div>
      <div><label for="ag-pages">Sidor</label><input id="ag-pages" inputmode="numeric" placeholder="t.ex. 2–3 (tomt = alla)" value=${pages} onInput=${e => setPages(e.target.value)} /></div>
    </div>
    <p class="hint">${chosen.length ? `Frågorna skapas ur ${chosen.length === (mat?.pages || []).length ? 'hela filen' : `sida ${chosen.join(', ')}`}.` : 'Inga sådana sidor i filen.'}</p>`}
    <label for="ag-note">Underlag (valfritt)</label><textarea id="ag-note" rows="2" placeholder="Om svaret inte står i materialet, skriv det här" value=${note} onInput=${e => setNote(e.target.value)}></textarea>
    ${late && html`<p class="hint">Frågorna skapas direkt när du lägger till målet. Befintliga frågor och barnets framsteg påverkas inte.</p>`}
    <div class="actions"><button class="btn ghost" onClick=${() => setOpen(false)}>Avbryt</button>
      <button class="btn primary" disabled=${!ok} onClick=${add}>${late ? 'Lägg till och skapa frågor' : 'Lägg till'}</button></div>
  </div>`;
}

function BankPreview({ goals, banks, materials, onDelete }) {
  return html`<details class="bank"><summary>Visa alla frågor</summary>
    ${goals.map(g => html`<div class="bank-goal"><h3>${g.text}</h3>
      ${[1, 2, 3, 4, 5].map(l => {
        const items = (banks[g.id] || []).filter(i => i.level === l);
        if (!items.length) return null;
        return html`<p class="eyebrow">Nivå ${l}${isFree(items[0]) ? ' · fritext, rättas av AI' : ''}</p><ul class="bank-items">${items.map(it => html`<li>
          <div><strong>${it.q}</strong>
            <div class="small muted">${isFree(it) ? 'Exempel på svar' : 'Svar'}: ${correctAnswerText(it).replace(/\n/g, '; ')}</div>
            ${it.must && html`<div class="small muted">Bedöms på: ${it.must.join(' · ')}</div>`}
            <div class="small muted">Källa: ${!it.src ? 'glosförhöret' : `${(materials.find(m => m.ref === it.src.m) || {}).name || 'Förälderns anteckning'}${it.src.m !== 'note' ? `, sida ${it.src.p}` : ''}`}</div></div>
          <button class="link" onClick=${() => onDelete(g.id, it.id)}>Ta bort</button></li>`)}</ul>`;
      })}</div>`)}
  </details>`;
}

// ------------------------------------------------------------ Barn

function ChildHome({ env, go, profileId }) {
  const [data, setData] = useState(null);
  const [menu, setMenu] = useState(null); // provet vars val visas
  useEffect(() => {
    (async () => {
      const profiles = await env.repo.listProfiles();
      const profile = profiles.find(p => p.id === profileId);
      const tests = (await env.repo.listTests()).filter(t => t.profileId === profileId && t.status === 'ready' && t.reviewed !== false); // reviewed: false = väntar på förälderns granskning
      const withProg = await Promise.all(tests.map(async t => {
        const [goals, mastery, banks, attempts] = await Promise.all([env.repo.listGoals(t.id), env.repo.listMastery(t.id), env.repo.listBanks(t.id), env.repo.listAttempts(t.id).catch(() => [])]);
        const active = goals.filter(childGoal);
        const plan = buildPlan({ test: t, goals: active, mastery, banks, attempts, schedule: profile?.schedule || DEFAULT_SCHEDULE, offDates: t.offDates || [] });
        const mastered = active.filter(g => mastery[g.id]?.passedMax && mastery[g.id].level >= practiceMax(g, banks[g.id])).length;
        return { ...t, progress: testProgress(active, mastery, banks), done: allMastered(active, mastery, banks), today: plan?.today || null, mastered, goalCount: active.length, teachable: active.some(g => g.type !== 'glosa') };
      }));
      setData({ profile, tests: withProg });
    })().catch(() => setData({ profile: null, tests: [] }));
  }, [profileId]);
  if (!data) return html`<p class="muted">Laddar…</p>`;
  if (!data.profile) return html`<p class="notice bad">Profilen finns inte.</p>`;
  const young = gradeOf(data.profile) <= 4;
  const look = { ...KOMPIS_DEFAULT, ...(data.profile.kompis || {}) };
  // Dagens pass: provet med närmast datum som har minuter kvar i dag.
  const todays = data.tests.filter(t => t.today && t.today.minutes > 0)
    .sort((a, b) => String(a.testDate).localeCompare(String(b.testDate)));
  const focus = todays.find(t => t.today.done < t.today.minutes) || todays[0] || null;
  const start = t => go({ name: 'practice', testId: t.id, profileId });

  return html`<div class=${'child ' + (young ? 'young' : '')}>
    <section class="hero child-hero">
      <button class="hero-kompis" onClick=${() => go({ name: 'kompis', profileId })} aria-label=${`${look.name}, din pluggkompis. Tryck för att ändra.`}>
        <${Kompis} look=${look} />
      </button>
      <div>
        <h1>Hej ${data.profile.name}!</h1>
        ${!data.tests.length ? html`<p class="lead">Du har inga prov att öva på just nu.</p>`
          : html`<p class="muted small">Tryck på ${look.name} för att ändra hur den ser ut.</p>`}
      </div>
    </section>

    ${focus && html`<section class="today-card" style=${coverVar(focus.subject)}>
      <${Ring} value=${focus.today.done / focus.today.minutes} size=${112} stroke=${11}
        label=${focus.today.done >= focus.today.minutes ? 'Klart!' : `${Math.max(0, focus.today.minutes - focus.today.done)}`}
        sub=${focus.today.done >= focus.today.minutes ? `${focus.today.done} min` : 'min kvar'} />
      <div class="today-text">
        <p class="eyebrow">Dagens pass</p>
        <h2>${focus.today.done >= focus.today.minutes ? 'Bra jobbat i dag!' : `${focus.subject}, cirka ${focus.today.minutes} minuter`}</h2>
        <p class="muted">${focus.today.done >= focus.today.minutes ? 'Du har gjort det du behöver. Vill du öva lite till går det bra.' : focus.today.done ? `Du har redan gjort ${focus.today.done} minuter.` : whenText(focus.testDate) + '.'}</p>
        <button class="btn primary big" onClick=${() => start(focus)}>${focus.today.done ? 'Fortsätt' : 'Börja'}</button>
      </div>
    </section>`}

    ${data.tests.length > 0 && html`<h2 class="section-title">Dina prov</h2>`}
    <div class="covers">
      ${data.tests.map(t => html`<button class="cover" style=${coverVar(t.subject)} onClick=${() => setMenu(t)} aria-haspopup="dialog">
        <span class="cover-front">
          <span class="cover-label">
            <span class="cl-subject">${t.subject}</span>
            <span class="cl-when">${whenText(t.testDate)}</span>
          </span>
          <span class="cover-stamps" aria-label=${`${t.mastered} av ${t.goalCount} mål klara`}>
            ${Array.from({ length: t.goalCount }, (_, i) => html`<i class=${i < t.mastered ? 'on' : ''}></i>`)}
          </span>
        </span>
        <span class="cover-foot">
          <span class="bar" role="progressbar" aria-label=${`${t.subject}: hur mycket som är klart`} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(t.progress * 100)}><span style=${`width:${Math.round(t.progress * 100)}%`}></span></span>
          <span class="cf-row"><span>${t.done ? 'Allt klart' : `${Math.round(t.progress * 100)} % klart`}</span>
            ${t.today && t.today.minutes > 0 && html`<span class="muted">${t.today.done >= t.today.minutes ? 'Klart i dag' : `I dag ${t.today.done}/${t.today.minutes} min`}</span>`}</span>
        </span>
      </button>`)}
    </div>
    <${TaskList} env=${env} go=${go} profileId=${profileId} />
    <p class="center"><button class="btn ghost small" onClick=${() => go({ name: 'start' })}>Byt person</button></p>
    ${menu && html`<${Sheet} title=${menu.subject} onClose=${() => setMenu(null)}>
      <div class="test-menu" style=${coverVar(menu.subject)}>
        <button class="tm-opt main" onClick=${() => start(menu)}>
          <span class="tm-title">Öva</span><span class="tm-sub">${menu.today && menu.today.minutes > menu.today.done ? `Dagens pass, cirka ${menu.today.minutes - menu.today.done} minuter kvar.` : 'Frågor som blir svårare i takt med att du kan mer.'}</span></button>
        <button class="tm-opt" onClick=${() => go({ name: 'exam', testId: menu.id, profileId })}>
          <span class="tm-title">Provläge</span><span class="tm-sub">Testa dig som på ett riktigt prov. Svaren rättas på slutet.</span></button>
        ${env.ai && menu.teachable && html`<button class="tm-opt" onClick=${() => go({ name: 'teach', testId: menu.id, profileId })}>
          <span class="tm-title">Lär ut det</span><span class="tm-sub">Förklara något för ${look.name} med egna ord.</span></button>`}
      </div>
    <//>`}
  </div>`;
}

function Practice({ env, go, testId, profileId }) {
  const { repo } = env;
  const [state, setState] = useState(null);
  const [current, setCurrent] = useState(null);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [saveErr, setSaveErr] = useState('');
  const [sheet, setSheet] = useState(null); // 'source' | 'explain'
  const [helped, setHelped] = useState(false); // tittade i materialet innan svaret
  const [introduced, setIntroduced] = useState({}); // mål vars begreppskort visats i det här passet
  const chatId = useRef(null);
  const kRef = useRef(null);            // Plumpen
  const [say, setSay] = useState(null); // något Plumpen själv tar upp
  const since = useRef(Date.now());     // start för pausräkningen

  // Nästa fråga: bara bland de mål som är introducerade i dag enligt planen.
  const choose = (s, recent) => {
    const now = Date.now();
    const plan = planFor(s);
    const { allowed } = allowedGoals({ goals: s.goals, mastery: s.mastery, attempts: s.attempts, plan, now });
    return pickNext({ goals: allowed, masteryById: s.mastery, banks: s.banks, recent, now })
      || pickNext({ goals: s.goals, masteryById: s.mastery, banks: s.banks, recent, now });
  };
  const planFor = s => buildPlan({ test: s.test, goals: s.goals, mastery: s.mastery, banks: s.banks, attempts: s.attempts, schedule: s.profile?.schedule || DEFAULT_SCHEDULE, offDates: s.test.offDates || [] });

  useEffect(() => {
    (async () => {
      const [test, goals, banks, mastery, materials, profiles, attempts, events] = await Promise.all([
        repo.getTest(testId), repo.listGoals(testId), repo.listBanks(testId), repo.listMastery(testId), repo.listMaterials(testId), repo.listProfiles(),
        repo.listAttempts(testId).catch(() => []), repo.listEvents(testId).catch(() => []),
      ]);
      const s = { test, goals: goals.filter(childGoal), banks: withChars(goals, withDictation(goals, banks)), mastery, materials, attempts, events, profile: profiles.find(p => p.id === profileId) };
      setState(s);
      setCurrent(choose(s, []));
    })();
  }, [testId]);

  // Plumpen reagerar på rättningen.
  useEffect(() => {
    const k = kRef.current;
    if (!k) return;
    if (say?.pause) return;
    if (!result) { k.mood('vilar'); const h = document.querySelector('.qcard .q'); if (h) k.lookAt(h, 1400); return; }
    if (result.pending || result.rechecking) { k.mood('tanker'); return; }
    if (result.needsSelf) { k.mood('vilar'); return; }
    if (result.recheck === 'up') { k.mood('vilar'); k.react('ratt'); return; }
    if (result.event === 'up' || result.event === 'fast' || result.event === 'mastered') k.react('nivaupp');
    else if (result.verdict === 'right') k.react('ratt');
    else if (result.verdict === 'wrong') k.react('fel');
    k.mood(result.verdict === 'almost' ? 'peppar' : 'vilar');
  }, [result?.attemptId, result?.pending, result?.rechecking, result?.recheck, !!result, current?.item?.id]);

  // Efter ett fel eller delvis rätt erbjuder Plumpen själv en förklaring.
  useEffect(() => {
    if (!result || result.pending || result.needsSelf || result.verdict === 'right' || !env.ai || say?.pause) return;
    if (current && needsCoverWrite(current.item, current.goal, result)) return; // stavningsövningen först
    const t = setTimeout(() => setSay({ text: result.verdict === 'wrong' ? 'Ska jag förklara hur det hänger ihop?' : 'Nästan! Vill du att jag förklarar resten?',
      actions: [{ label: 'Ja, förklara', primary: true, onClick: () => { setSay(null); setSheet('explain'); } }, { label: 'Nej tack', onClick: () => setSay(null) }] }), 900);
    return () => clearTimeout(t);
  }, [result?.attemptId, result?.verdict]);

  if (!state) return html`<p class="muted">Laddar…</p>`;
  const young = gradeOf(state.profile) <= 4;
  const finished = !current || log.length >= SESSION_LENGTH;
  const today = dayKey(Date.now());
  const plan = planFor(state);
  const doneToday = minutesOnDay(state.attempts, today);
  const target = plan?.today?.minutes || null;
  const firstDay = state.attempts.reduce((k, a) => { const d = dayKey(a.ts); return !k || d < k ? d : k; }, null);

  // Sparar ett rättat svar och uppdaterar nivån. grading finns bara för fritext.
  async function finalize(given, g, grading) {
    const { item, goal } = current;
    const before = current.mastery || state.mastery[goal.id] || newMastery(goal.id);
    const max = practiceMax(goal, state.banks[goal.id]);
    const now = Date.now();
    // Har barnet tittat i materialet före svaret räknas det som övning: nivån står still.
    const { mastery, event } = helped
      ? { mastery: { ...before, seen: { ...(before.seen || {}), [item.id]: now }, lastPracticed: now }, event: null }
      : applyResult(before, goal, { score: g.score, itemId: item.id, now, testDate: state.test.testDate, max });
    const attempt = {
      id: uid('a'), profileId, goalId: goal.id, itemId: item.id, level: item.level, kind: item.kind,
      answer: given, score: g.score, verdict: g.verdict, ts: now, disputed: false,
      ...(helped ? { helped: true } : {}),
      ...(grading ? { grading } : {}),
    };
    setResult({ ...g, event, attemptId: attempt.id, given, grading, mastery, fromLevel: before.level, helped });
    setState(s => ({ ...s, mastery: { ...s.mastery, [goal.id]: mastery }, attempts: [...s.attempts, attempt] }));
    setLog(l => [...l, { goalId: goal.id, itemId: item.id, score: g.score, event, goalText: goal.text, level: mastery.level }]);
    try {
      await repo.saveAttempt(testId, attempt);
      await repo.saveMastery(testId, mastery);
      setSaveErr('');
    } catch (e) { setSaveErr('Svaret kunde inte sparas. Kontrollera anslutningen.'); }
  }

  async function answer(given) {
    const { item } = current;
    if (!isFree(item)) return finalize(given, gradeLocal(item, given), null);
    if (!env.ai) return setResult({ needsSelf: true, given, error: 'AI-rättning finns inte här.' });
    setResult({ pending: true, given });
    try {
      const g = await gradeFree({ ai: env.ai, test: state.test, item, answer: given });
      await finalize(given, g, {
        tier: g.tier, escalated: g.escalated, reason: g.reason || null, met: g.met,
        feedback: g.feedback, confidence: g.confidence, calls: g.calls, ...(g.firstScore != null ? { firstScore: g.firstScore } : {}),
      });
    } catch (e) {
      setResult({ needsSelf: true, given, error: errText(e) });
    }
  }

  // Reserv när AI inte går att nå: barnet jämför med exempelsvaret och bedömer själv.
  function selfGrade(score) {
    const verdict = score >= 1 ? 'right' : score > 0 ? 'almost' : 'wrong';
    finalize(result.given, { score, verdict }, { tier: 'själv', escalated: false, calls: 0 });
  }

  function resetQuestion() { setHelped(false); setSheet(null); chatId.current = null; }

  function next() {
    resetQuestion();
    setResult(null);
    setSay(null);
    if (Date.now() - since.current >= PAUSE_AFTER) offerPause();
    const recent = log.map(l => ({ goalId: l.goalId, itemId: l.itemId }));
    setCurrent(choose(state, recent));
  }

  function offerPause() {
    const mins = Math.round((Date.now() - since.current) / 60000);
    setSay({ pause: true, text: `Du har pluggat i ${mins} minuter. Hjärnan lär sig bättre med en liten paus. Res dig, sträck på dig och drick lite vatten!`,
      actions: [
        { label: 'Ta en paus', primary: true, onClick: () => go({ name: 'child', profileId }) },
        { label: 'Fortsätt en stund till', onClick: () => { since.current = Date.now() - PAUSE_AFTER + 4 * 60000; setSay(null); kRef.current?.mood('vilar'); } },
      ] });
    kRef.current?.mood('peppar');
    kRef.current?.speak('Dags för en liten paus!');
  }

  // Eget hopp: sparas som händelse så att nivån kan räknas om korrekt senare.
  async function jump() {
    const { goal } = current;
    const m0 = result.mastery;
    const now = Date.now();
    const ev = { id: uid('e'), type: 'jump', goalId: goal.id, ts: now, from: m0.level, to: m0.level + 1, profileId };
    const m = jumpUp(m0, now);
    const s2 = { ...state, mastery: { ...state.mastery, [goal.id]: m }, events: [...state.events, ev] };
    setState(s2);
    try { await repo.saveEvent(testId, ev); await repo.saveMastery(testId, m); } catch { setSaveErr('Hoppet kunde inte sparas. Kontrollera anslutningen.'); }
    setResult(null);
    resetQuestion();
    const recent = log.map(l => ({ goalId: l.goalId, itemId: l.itemId }));
    setCurrent(pickNext({ goals: [goal], masteryById: s2.mastery, banks: s2.banks, recent, now }) || choose(s2, recent));
  }

  async function dispute() {
    const { item, goal } = current;
    const r0 = result;
    try { await repo.updateAttempt(testId, r0.attemptId, { disputed: true }); } catch { /* visas inte för barnet */ }
    if (!isFree(item) || !env.ai || !r0.grading) return setResult(r => ({ ...r, disputed: true }));

    setResult(r => ({ ...r, disputed: true, rechecking: true }));
    try {
      const g = await regradeOnDispute({ ai: env.ai, test: state.test, item, answer: r0.given, previous: r0.grading });
      if (!g || g.score <= r0.score) return setResult(r => ({ ...r, rechecking: false, recheck: g ? 'same' : 'parent' }));
      const grading = { tier: g.tier, escalated: true, reason: 'invändning', met: g.met, feedback: g.feedback, confidence: g.confidence, calls: (r0.grading.calls || 1) + 1 };
      await repo.updateAttempt(testId, r0.attemptId, { score: g.score, verdict: g.verdict, grading, resolved: 'ai-accepted', originalScore: r0.score });
      const all = (await repo.listAttempts(testId)).map(a => (a.id === r0.attemptId ? { ...a, score: g.score } : a));
      const m = replayMastery(goal, all, state.test.testDate, state.banks[goal.id], state.events);
      await repo.saveMastery(testId, m);
      setState(s => ({ ...s, mastery: { ...s.mastery, [goal.id]: m }, attempts: s.attempts.map(a => (a.id === r0.attemptId ? { ...a, score: g.score } : a)) }));
      setLog(l => l.map(x => (x.itemId === item.id && x === l[l.length - 1] ? { ...x, score: g.score } : x)));
      setResult(r => ({ ...r, ...g, grading, rechecking: false, recheck: 'up' }));
    } catch {
      setResult(r => ({ ...r, rechecking: false, recheck: 'parent' }));
    }
  }

  if (finished && !result) {
    const right = log.filter(l => l.score >= 1).length;
    const ups = log.filter(l => l.event === 'up' || l.event === 'fast' || l.event === 'mastered');
    const done = allMastered(state.goals, state.mastery, state.banks);
    const todayDone = target && doneToday >= target;
    return html`<div class=${'practice ' + (young ? 'young' : '')} style=${coverVar(state.test.subject)}>
      <section class="sheet summary">
        <div class="summary-head">
          ${target
            ? html`<${Ring} value=${doneToday / target} size=${104} label=${todayDone ? 'Klart!' : `${doneToday}`} sub=${todayDone ? `${doneToday} min` : `av ${target} min`} />`
            : log.length > 0 && html`<${Ring} value=${right / log.length} size=${104} label=${`${right}`} sub=${`av ${log.length}`} />`}
          <div>
            <p class="eyebrow">${state.test.subject}</p>
            <h1>${todayDone ? 'Dagens pass är klart!' : log.length ? `${right} rätt av ${log.length}` : 'Inget att öva just nu'}</h1>
            ${todayDone && log.length > 0 && html`<p class="muted">${right} rätt av ${log.length} i den här omgången.</p>`}
          </div>
        </div>
        ${log.length > 0 && html`<${AnswerTrail} log=${log} total=${log.length} />`}
        ${ups.length > 0 && html`<ul class="ups">${ups.map(u => html`<li><span class="up-tag">${u.event === 'mastered' ? 'Klart' : `Nivå ${u.level}`}</span>${u.goalText.replace(/^kunna\s+/i, '').replace(/^./, c => c.toUpperCase())}</li>`)}</ul>`}
        <p class="lead">${done ? 'Alla mål är klara. Fortsätt öva då och då så sitter det kvar till provet.'
          : !log.length ? 'Allt är repeterat för i dag. Kom tillbaka i morgon.'
          : todayDone ? 'Du har gjort det du behöver i dag. Vill du köra lite till går det bra.'
          : target ? `Ungefär ${Math.max(5, target - doneToday)} minuter kvar för i dag.` : 'Bra jobbat. Varje pass gör det lite lättare.'}</p>
        <div class="actions">
          <button class="btn ghost" onClick=${() => go({ name: 'child', profileId })}>Klar för nu</button>
          ${current && html`<button class="btn primary" onClick=${() => { setLog([]); next(); }}>Öva ${SESSION_LENGTH} till</button>`}
        </div>
      </section>
    </div>`;
  }

  const { item, goal } = current;
  const mat = state.materials.find(m => m.ref === item.src?.m);
  // Begreppskort första gången ett mål dyker upp: ett annat nivå 1-kort än frågan som följer.
  const neverSeen = !state.attempts.some(a => a.goalId === goal.id);
  const introItem = neverSeen && !introduced[goal.id] && item.level === 1
    ? (state.banks[goal.id] || []).find(i => i.level === 1 && i.kind === 'mcq' && i.id !== item.id) : null;
  const given = result?.given;
  const answerText = given == null ? '' : typeof given === 'object'
    ? Object.entries(given).map(([a, b]) => `${a} – ${b}`).join('; ')
    : item.kind === 'mcq' ? item.options[given] : String(given);

  return html`<div class=${'practice ' + (young ? 'young' : '')} style=${coverVar(state.test.subject)}>
    <div class="practice-top">
      <button class="btn ghost small" onClick=${() => go({ name: 'child', profileId })} aria-label="Avsluta passet">Avsluta</button>
      <${AnswerTrail} log=${log} total=${SESSION_LENGTH} current=${!result} />
      ${target && html`<span class="today-chip" title="Minuter i dag">${doneToday}/${target} min</span>`}
    </div>
    ${introItem
      ? html`<article class="qcard enter" key=${'intro-' + goal.id}>
          <${IntroCard} goal=${goal} item=${introItem} onDone=${() => setIntroduced(x => ({ ...x, [goal.id]: true }))} />
        </article>`
      : html`<article class="qcard enter" key=${item.id}>
      <p class="q-goal"><span class="q-subject">${state.test.subject}</span>
        <span class="q-level">Nivå ${item.level}<${LevelPips} goal=${goal} mastery=${current.mastery || { level: 1 }} bank=${state.banks[goal.id]} /></span>
        ${isFree(item) && html`<span class="q-free">Svara med egna ord</span>`}
        ${helped && !result && html`<span class="q-helped">${item.kind === 'math' ? 'Med ledtråd' : 'Med hjälp av materialet'}</span>`}</p>
      <${Question} item=${item} disabled=${!!result} onAnswer=${answer} result=${result} hideGiven=${needsCoverWrite(item, goal, result)} onHelp=${() => setHelped(true)} />
      ${!result && item.src && html`<div class="q-tools">
        <button class="tool" onClick=${() => { setHelped(true); setSheet('source'); }}>
          <${IconBook} /> Läs i materialet</button>
        ${isFree(item) && html`<span class="small muted mic-tip"><${IconMic} /> Du kan prata in svaret med mikrofonen på tangentbordet.</span>`}
      </div>`}
    </article>`}
    ${result?.pending && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>Rättar ditt svar…</p>`}
    ${result?.needsSelf && html`<${SelfGrade} item=${item} error=${result.error} onGrade=${selfGrade} />`}
    ${result && !result.pending && !result.needsSelf && html`<${Feedback} result=${result} item=${item} goal=${goal} goalText=${goal.text}
      onCopyDone=${r => {
        if (r.ok) kRef.current?.react('ratt');
        setResult(x => ({ ...x, copied: r }));
        repo.updateAttempt(testId, result.attemptId, { coverWrite: r }).catch(() => {});
      }} source=${mat ? `${mat.name}, sida ${item.src.p}` : null} onNext=${next} onDispute=${dispute}
      onSource=${() => setSheet('source')}
      jumpTo=${!result.helped && result.score >= 1 && result.mastery ? (canJump(goal, result.mastery, state.banks[goal.id], { now: Date.now(), firstDay }).to || null) : null} onJump=${jump} />`}
    ${saveErr && html`<p class="notice bad">${saveErr}</p>`}
    ${sheet === 'source' && html`<${SourceSheet} files=${env.files} libs=${env.config?.libs} item=${item} materials=${state.materials} before=${!result} onClose=${() => setSheet(null)} />`}
    ${sheet === 'explain' && html`<${ExplainSheet} look=${{ ...KOMPIS_DEFAULT, ...(state.profile?.kompis || {}) }} ai=${env.ai} test=${state.test} item=${item} answerText=${answerText} verdict=${result?.verdict} material=${mat}
      onClose=${() => setSheet(null)}
      onSave=${messages => {
        chatId.current ||= uid('c');
        repo.saveChat(testId, { id: chatId.current, profileId, goalId: goal.id, itemId: item.id, q: item.q, ts: Date.now(), messages }).catch(() => {});
      }} />`}
    ${!introItem && html`<${KompisDock} kRef=${kRef} look=${{ ...KOMPIS_DEFAULT, ...(state.profile?.kompis || {}) }} say=${say}
      onDismiss=${() => { if (say?.pause) { since.current = Date.now() - PAUSE_AFTER + 4 * 60000; } setSay(null); }}
      menu=${result && !result.pending && !result.needsSelf
        ? [...(env.ai ? [{ label: 'Förklara mer', onClick: () => setSheet('explain') }] : []), { label: 'Läs i materialet', onClick: () => setSheet('source') }]
        : result ? [] : [{ label: 'Läs i materialet', onClick: () => { setHelped(true); setSheet('source'); } }]} />`}
  </div>`;
}

function Question(props) {
  const { item } = props;
  // Uppläsning av frågan (inte vid diktamen, där ordet är själva uppgiften).
  return html`${item.kind !== 'dictation' && html`<div class="read-aloud"><${SpeakButton} text=${readAloudText(item)} label="Läs upp frågan" /></div>`}<${QuestionBody} ...${props} />`;
}

function QuestionBody({ item, disabled, onAnswer, result, hideGiven, onHelp }) {
  if (item.kind === 'math') return html`<${MathQuestion} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} onHelp=${onHelp} />`;
  if (item.kind === 'mcq') return html`<${Mcq} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} />`;
  if (item.kind === 'match') return html`<${MatchQuestion} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} />`;
  if (item.kind === 'sort') return html`<${SortQuestion} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} />`;
  if (item.kind === 'order') return html`<${OrderQuestion} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} />`;
  if (isFree(item)) return html`<${FreeAnswer} item=${item} disabled=${disabled} onAnswer=${onAnswer} />`;
  return html`<${TextAnswer} item=${item} disabled=${disabled} onAnswer=${onAnswer} result=${result} hideGiven=${hideGiven} />`;
}

function Mcq({ item, disabled, onAnswer, result }) {
  const order = useMemo(() => shuffle(item.options.map((_, i) => i)), [item.id]);
  return html`<h2 class="q">${item.q}</h2>
    <div class="options">${order.map(i => {
      let cls = 'option';
      if (result) { if (i === item.answer) cls += ' is-right'; else if (i === result.given) cls += ' is-wrong'; }
      return html`<button key=${(item.id || item.q) + ':' + i} class=${cls} disabled=${disabled} onClick=${() => onAnswer(i)}>${item.options[i]}</button>`;
    })}</div>`;
}

// hideGiven: en felstavning visas inte kvar, så att den inte fastnar som ordbild.
function TextAnswer({ item, disabled, onAnswer, result, hideGiven }) {
  const [v, setV] = useState('');
  const ref = useRef();
  useEffect(() => { setV(''); ref.current?.focus(); if (item.kind === 'dictation') speak(item.answer, item.lang, 0.8); }, [item.id]);
  const parts = item.kind === 'cloze' ? item.q.split('___') : null;
  return html`<form class="text-answer" onSubmit=${e => { e.preventDefault(); if (v.trim()) onAnswer(v); }}>
    <h2 class="q">${parts ? html`${parts[0]}<span class="gap">${result && !hideGiven ? result.given : ' '.repeat(8)}</span>${parts[1]}` : item.q}</h2>
    ${item.kind === 'dictation' && html`<p class="dictation"><${SpeakButton} text=${item.answer} lang=${item.lang} label="Lyssna igen" /></p>`}
    <label class="sr" for="ans">Ditt svar</label>
    <input id="ans" ref=${ref} class="answer" autocomplete="off" autocapitalize="off" spellcheck="false" disabled=${disabled} value=${hideGiven ? '' : v} onInput=${e => setV(e.target.value)} placeholder=${hideGiven ? 'Öva på stavningen nedanför' : 'Skriv ditt svar'} />
    ${!disabled && html`<${CharBar} chars=${item.chars} inputRef=${ref} value=${v} onChange=${setV} />`}
    ${!disabled && html`<button class="btn primary" disabled=${!v.trim()}>Svara</button>`}
  </form>`;
}

function FreeAnswer({ item, disabled, onAnswer }) {
  const [v, setV] = useState('');
  const ref = useRef();
  useEffect(() => { setV(''); ref.current?.focus(); }, [item.id]);
  const words = (v.trim().match(/\S+/g) || []).length;
  return html`<form class="text-answer" onSubmit=${e => { e.preventDefault(); if (v.trim()) onAnswer(v.trim()); }}>
    <h2 class="q">${item.q}</h2>
    <label class="sr" for="free">Ditt svar</label>
    <textarea id="free" ref=${ref} class="answer free" rows=${item.level >= 4 ? 5 : 3} disabled=${disabled} value=${v}
      onInput=${e => setV(e.target.value)} placeholder=${item.kind === 'sentence' ? 'Skriv en mening' : item.level >= 4 ? 'Förklara med egna ord' : 'Svara med en eller två meningar'}></textarea>
    ${!disabled && html`<${CharBar} chars=${item.chars} inputRef=${ref} value=${v} onChange=${setV} />`}
    ${!disabled && html`<div class="actions"><span class="small muted">${words ? `${words} ord` : ''}</span><button class="btn primary" disabled=${!v.trim()}>Svara</button></div>`}
  </form>`;
}

function Checks({ must, met }) {
  return html`<ul class="checks">${must.map((m, i) => html`<li class=${met?.[i] ? 'ok' : 'no'}>
    <span class="sr">${met?.[i] ? 'Med:' : 'Saknas:'}</span>${m}</li>`)}</ul>`;
}

function SelfGrade({ item, error, onGrade }) {
  return html`<section class="feedback almost" aria-live="polite">
    <h2>Rätta själv den här gången</h2>
    <p class="small">${error} Jämför ditt svar med exemplet och var ärlig.</p>
    <p class="answer-line">Exempel på bra svar: <strong>${item.answer}</strong></p>
    <p class="small">Ett bra svar har med:</p>
    <ul class="checks plain">${item.must.map(m => html`<li>${m}</li>`)}</ul>
    <div class="actions">
      <button class="btn ghost small" onClick=${() => onGrade(0)}>Inte riktigt</button>
      <button class="btn ghost small" onClick=${() => onGrade(0.5)}>Delvis</button>
      <button class="btn primary" onClick=${() => onGrade(1)}>Jag hade med allt</button>
    </div>
  </section>`;
}

function TodayBar({ done, target }) {
  const p = Math.min(1, done / target);
  return html`<div class="today-bar">
    <span class="bar" role="progressbar" aria-label="Dagens pluggtid" aria-valuemin="0" aria-valuemax=${target} aria-valuenow=${done}><span style=${`width:${p * 100}%`}></span></span>
    <span class="small muted">${done} av ${target} minuter i dag</span>
  </div>`;
}

function Feedback({ result, item, goal, goalText, source, onNext, onDispute, jumpTo, onJump, onSource, onExplain, onCopyDone }) {
  const ref = useRef();
  const cw = goal && needsCoverWrite(item, goal, result);
  const [skipped, setSkipped] = useState(false);
  const free = isFree(item);
  const title = { right: 'Rätt!', almost: free ? 'Delvis rätt' : 'Nästan rätt', wrong: 'Inte riktigt' }[result.verdict];
  // Det barnet ska läsa (och kan få uppläst): rubriken, kommentaren, rätt svar och förklaringen.
  const readText = [title, result.note, free && result.feedback,
    result.verdict !== 'right' && (free ? (!item.moves && `Exempel på bra svar: ${item.answer}`) : `Rätt svar: ${correctAnswerText(item)}`),
    item.explain].filter(Boolean).join(' ');
  // Nästa kommer först efter en stund, så att kommentaren hinns läsa (cirka tre ord i sekunden, 2–8 s).
  const [ready, setReady] = useState(false);
  const readMs = Math.min(8000, Math.max(2000, readText.split(/\s+/).length * 330));
  useEffect(() => { const t = setTimeout(() => setReady(true), readMs); return () => clearTimeout(t); }, []);
  const blocked = cw && !result.copied && !skipped;
  useEffect(() => { if (!cw) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);
  useEffect(() => { if (ready && (!cw || result.copied || skipped)) ref.current?.focus(); }, [ready, !!result.copied, skipped]);
  const icon = { right: '✓', almost: '½', wrong: '→' }[result.verdict];
  const stamp = result.event === 'up' || result.event === 'fast' ? `Nivå ${result.mastery?.level}!` : result.event === 'mastered' ? 'Klart!' : null;
  return html`<section class=${'feedback ' + result.verdict} aria-live="polite">
    ${stamp && html`<${Stamp}>${stamp}<//>`}
    <div class="fb-head"><h2><span class="fb-icon" aria-hidden="true">${icon}</span>${title}</h2><${SpeakButton} text=${readText} label="Läs upp" /></div>
    ${result.recheck === 'up' && html`<p class="levelup">Svaret kontrollerades en gång till, och du hade mer rätt än först.</p>`}
    ${result.note && html`<p>${result.note}</p>`}
    ${free && result.feedback && html`<p>${result.feedback}</p>`}
    ${free && html`<${Checks} must=${item.must} met=${result.met} />`}
    ${free
      ? result.verdict !== 'right' && (item.moves
        // Resonemang: kompisens följdfråga först, exemplet bara om barnet vill se det.
        ? html`<details class="answer-line"><summary>Visa ett exempel på svar</summary><strong>${item.answer}</strong></details>`
        : html`<p class="answer-line">Exempel på bra svar: <strong>${item.answer}</strong></p>`)
      : result.verdict !== 'right' && html`<p class="answer-line">Rätt svar: <strong>${correctAnswerText(item)}</strong></p>`}
    ${cw && html`<${CoverWrite} word=${correctAnswerText(item)} chars=${item.chars} onDone=${onCopyDone} />`}
    ${item.explain && html`<p>${item.explain}</p>`}
    <p class="small muted">${/^kunna\s/i.test(goalText) ? `Du övar på att ${goalText.replace(/^kunna\s+/i, '')}` : `Mål: ${goalText}`}${/[.!?]$/.test(goalText) ? '' : '.'}</p>
    ${result.helped && html`<p class="small muted">Du tittade i materialet först, så det här räknas som övning och flyttar inte nivån.</p>`}
    <div class="fb-tools">
      ${onExplain && html`<button class="tool" onClick=${onExplain}><${IconChat} /> Förklara mer</button>`}
      ${item.kind !== 'math' && html`<button class="tool" onClick=${onSource}><${IconBook} /> ${source ? html`<span>Läs i materialet<small>${source.replace(/, sida /, ', s. ')}</small></span>` : 'Läs underlaget'}</button>`}
    </div>
    ${result.event === 'up' && html`<p class="levelup">Du går upp en nivå på det här målet.</p>`}
    ${result.event === 'fast' && html`<p class="levelup">Snabbspår! Tre rätt direkt, så du går upp en nivå.</p>`}
    ${result.event === 'mastered' && html`<p class="levelup">Det här målet är klart.</p>`}
    ${result.event === 'jumpBack' && html`<p class="levelup">Bra att du testade. Vi kör lite till på nivå ${result.mastery?.level} först.</p>`}
    ${jumpTo && html`<div class="jump"><span class="small">För lätt?</span>
      <button class="btn ghost small" onClick=${onJump}>Hoppa till nivå ${jumpTo}</button></div>`}
    <div class="actions">
      ${result.verdict !== 'right' && (result.rechecking
        ? html`<span class="small muted"><span class="spinner inline" aria-hidden="true"></span> Kontrollerar en gång till…</span>`
        : result.disputed
          ? result.recheck !== 'up' && html`<span class="small muted">${result.recheck === 'same' ? 'Rättningen stod sig. ' : ''}Förälder får titta på det.</span>`
          : item.kind !== 'math' && html`<button class="btn ghost small" onClick=${onDispute}>Jag tycker jag hade rätt</button>`)}
      ${blocked && html`<button class="link small" onClick=${() => setSkipped(true)}>Hoppa över övningen</button>`}
      <button ref=${ref} class=${'btn primary' + (ready ? '' : ' wait')} style=${`--wait: ${readMs}ms`} disabled=${!!result.rechecking || blocked || !ready} aria-describedby=${ready ? null : 'fb-wait'} onClick=${onNext}>Nästa</button>
      ${!ready && html`<span id="fb-wait" class="visually-hidden">Läs kommentaren först. Knappen blir klickbar om en liten stund.</span>`}
    </div>
  </section>`;
}

render(html`<${App} />`, document.getElementById('app'));
