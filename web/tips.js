// Lästips: var i materialet barnet ska läsa, en kort förklaring och något att göra, för mål som
// är svåra. Erbjuds av Plumpen när ett mål har kört fast (engine.js isStuck) och finns i provets
// meny ("Vad ska jag läsa på?"). Ett tips sparas som ett samtal (kind: 'tip'), så att föräldern
// ser det och samma tips visas igen samma dag i stället för ett nytt anrop.
import { html, useState, useEffect } from './lib.js';
import { Sheet } from './sheet.js';
import { SourceSheet } from './source.js';
import { SpeakButton } from './speech.js';
import { IconBook } from './ui.js';
import { childGoal, weakestGoals, tipDecision } from './engine.js';
import { tipMaterial, tipPrompt, validateTip, correctionPrompt } from './prompts.js';
import { uid } from './repo.js';

export const TIPS_PER_DAY = 6; // nya lästips per barn och prov och dag

export function TipSheet({ env, testId, profileId, goalIds, name = 'Plumpen', onClose }) {
  const { repo, ai } = env;
  const [st, setSt] = useState(null); // { test, goals, materials, tips } | { error }
  const [open, setOpen] = useState(null); // { m, p, what } som visas i materialet

  useEffect(() => {
    let live = true;
    (async () => {
      const [test, allGoals, banks, mastery, materials, attempts, chats] = await Promise.all([
        repo.getTest(testId), repo.listGoals(testId), repo.listBanks(testId), repo.listMastery(testId),
        repo.listMaterials(testId), repo.listAttempts(testId).catch(() => []), repo.listChats(testId), // utan samtalen går taket inte att räkna: då inget anrop
      ]);
      const active = allGoals.filter(childGoal);
      const mine = attempts.filter(a => !a.profileId || a.profileId === profileId);
      const goals = goalIds?.length
        ? active.filter(g => goalIds.includes(g.id))
        : weakestGoals({ goals: active, mastery, banks, attempts: mine, n: 2 });
      if (!goals.length) return live && setSt({ test, goals, materials, tips: [], empty: true });
      const d = tipDecision({ chats, profileId, goalIds: goals.map(g => g.id), perDay: TIPS_PER_DAY });
      if (d.cached) return live && setSt({ test, goals, materials, tips: d.cached });
      if (!ai) return live && setSt({ test, goals, materials, error: 'Lästips kräver Claude, som inte är tillgängligt här.' });
      if (d.limit) return live && setSt({ test, goals, materials, error: 'Du har fått många lästips i dag. Läs dem du har, eller fråga en vuxen.' });
      const material = tipMaterial({ goals, banks, attempts: mine, materials });
      if (!material.pages.length) return live && setSt({ test, goals, materials, error: 'Det finns inga sidor i materialet att hänvisa till för de här målen.' });
      const prompt = tipPrompt({ test, material });
      let v = validateTip((await ai.complete({ prompt, json: true, tier: 'default' })).json, material);
      if (!v.ok) v = validateTip((await ai.complete({ prompt: correctionPrompt(prompt, v.errors), json: true, tier: 'default' })).json, material);
      const tips = (v.tips || []).filter(t => t.read.length && t.explain && t.try);
      if (!tips.length) throw new Error('Tipset blev inte bra. Försök igen om en stund.');
      const saved = await repo.saveChat(testId, {
        id: uid('c'), kind: 'tip', profileId, goalIds: goals.map(g => g.id), ts: Date.now(),
        q: 'Lästips: ' + goals.map(g => g.text).join('; '), tips, messages: [],
      }).then(() => true, () => false);
      if (live) setSt({ test, goals, materials, tips, unsaved: !saved });
    })().catch(e => live && setSt(s => ({ ...(s || {}), error: (e && e.message) || 'Tipset gick inte att hämta.' })));
    return () => { live = false; };
  }, [testId, (goalIds || []).join()]);

  if (open) {
    const item = { src: { m: open.m, p: open.p }, q: open.what || '', answer: '' };
    return html`<${SourceSheet} files=${env.files} libs=${env.config?.libs} item=${item} materials=${st.materials} onClose=${() => setOpen(null)} />`;
  }
  const matName = m => st.materials.find(x => String(x.ref) === String(m))?.name || 'Materialet';
  return html`<${Sheet} title="Vad ska jag läsa på?" onClose=${onClose}>
    ${!st && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>${name} letar i ditt material…</p>`}
    ${st?.error && html`<p class="notice bad">${st.error}</p>`}
    ${st?.empty && html`<p>Jag hittar inget som är extra svårt just nu. Öva vidare, så kan jag ge tips om något blir knepigt.</p>`}
    ${st?.unsaved && html`<p class="notice small">Tipset kunde inte sparas, så en vuxen ser det inte. Kontrollera anslutningen.</p>`}
    ${st?.tips?.map(t => {
      const g = st.goals.find(x => x.id === t.goalId);
      const speak = [t.mistake, t.explain, 'Prova det här: ' + t.try].filter(Boolean).join(' ');
      return html`<section class="tip block flat">
        <div class="fb-head"><h3>${g ? g.text.replace(/^kunna\s+/i, '').replace(/^./, c => c.toUpperCase()) : 'Målet'}</h3><${SpeakButton} text=${speak} label="Läs upp" /></div>
        <p class="small"><strong>Läs här</strong></p>
        <div class="fb-tools">${t.read.map(r => html`<button class="tool" onClick=${() => setOpen(r)}>
          <${IconBook} /><span>${matName(r.m)}, s. ${r.p}${r.what ? html`<small>${r.what}</small>` : ''}</span></button>`)}</div>
        ${t.mistake && html`<p>${t.mistake}</p>`}
        <p>${t.explain}</p>
        <p><strong>Prova det här:</strong> ${t.try}</p>
      </section>`;
    })}
    ${st?.tips?.length > 0 && html`<p class="small muted">Läs först, gör sedan uppgiften, och öva sedan igen. Det är när du försöker själv som det fastnar.</p>`}
  <//>`;
}
