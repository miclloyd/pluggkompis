// Utskrift och export. Instuderingshäftet byggs som PDF (jsPDF, laddas vid behov) eftersom
// sidan inte kan öppna skrivardialogen själv. Export ger en säkerhetskopia (JSON) och svaren
// som tabell (CSV) för den som vill räkna själv.
import { gradeOf } from './grade.js';
import { html, useState } from './lib.js';
import { loadScript } from './lib.js';
import { Sheet } from './sheet.js';
import { isFree, shuffle, correctAnswerText } from './engine.js';
import { pickPrintItems, summaryFacts, goalLabel, goalTopic } from './booklet.js';
import { teachFacts } from './pipeline.js';

// Standardtypsnittet i PDF täcker västeuropeiska tecken. Annat byts mot närmaste motsvarighet.
const CP1252_EXTRA = new Set('–—‘’“”•…€‚„†‡ˆ‰Š‹ŒŽ˜™š›œžŸ');
function clean(s) {
  return String(s ?? '').replace(/\*\*/g, '').replace(/[✓✔]/g, 'v').replace(/[★]/g, '*').replace(/[​-‍﻿]/g, '')
    .replace(/./gsu, ch => (ch.charCodeAt(0) <= 255 || CP1252_EXTRA.has(ch) ? ch : (ch.normalize('NFKD').replace(/[^\x00-\xff]/g, '') || '?')));
}

const LETTERS = 'ABCDEFGH';

export async function buildBookletPdf({ libs, test, goals, banks, mastery, profileName, opts }) {
  await loadScript(libs.jspdf, libs.sri?.jspdf);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 18, CW = W - 2 * M;
  let y = M;
  const ink = [26, 33, 50], ink2 = [84, 95, 117], pen = [33, 72, 192], rule = [196, 207, 226];

  const font = (size, style = 'normal', color = ink) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const lh = size => size * 0.42;
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s, { size = 11, style = 'normal', color = ink, x = M, width = CW, gap = 1.5 } = {}) => {
    font(size, style, color);
    const lines = doc.splitTextToSize(clean(s), width);
    for (const line of lines) { need(lh(size) + 0.5); doc.text(line, x, y + lh(size) * 0.8); y += lh(size); }
    y += gap;
  };
  const writeLines = (n, x = M + 6) => {
    doc.setDrawColor(...rule); doc.setLineWidth(0.2);
    for (let i = 0; i < n; i++) { need(8); y += 8; doc.line(x, y, M + CW, y); }
    y += 3;
  };
  const heading = (s, size = 15) => { need(16); y += 3; text(s, { size, style: 'bold', color: ink, gap: 1 }); doc.setDrawColor(...pen); doc.setLineWidth(0.6); doc.line(M, y, M + 30, y); y += 5; };

  // Försättsblad
  font(24, 'bold'); doc.text(clean(test.subject), M, y + 9); y += 14;
  text(`Instuderingshäfte${profileName ? ` för ${profileName}` : ''}`, { size: 13, color: ink2 });
  text(`${test.testDate ? `Provet: ${new Date(test.testDate + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Inget provdatum'} · årskurs ${test.grade}`, { size: 11, color: ink2, gap: 6 });

  const picked = pickPrintItems({ goals, banks, mastery, perGoal: opts.perGoal, onlyOpen: opts.onlyOpen });

  if (opts.summary) {
    heading('Det här ska du kunna');
    picked.forEach(({ goal }, gi) => {
      need(14);
      text(`${gi + 1}. ${goalLabel(goal.text)}`, { size: 12, style: 'bold', gap: 1 });
      if (goal.type === 'glosa' && goal.term) { text(`${goal.term} = ${goal.translation}`, { x: M + 6, width: CW - 6 }); return; }
      // Hela meningar ur materialet först (citat och förklaringar), bedömningspunkter bara som reserv.
      const bank = banks[goal.id] || [];
      let facts = summaryFacts(bank.flatMap(it => [it.quote, it.explain]));
      // Inga hela meningar: bedömningspunkterna i stället, med stor bokstav.
      if (!facts.length) facts = summaryFacts(teachFacts(bank).map(f => f.replace(/^./, c => c.toUpperCase())), { minWords: 2 });
      for (const f of facts) {
        need(6); font(11); doc.setTextColor(...pen); doc.text('•', M + 6, y + lh(11) * 0.8);
        text(f, { x: M + 11, width: CW - 11, gap: 0.8 });
      }
      y += 2;
    });
  }

  const key = [];
  if (opts.questions) {
    if (opts.summary) { doc.addPage(); y = M; }
    heading('Öva');
    text('Svara utan att titta i materialet först. Rätta sedan med facit längst bak.', { size: 10, color: ink2, gap: 4 });
    let n = 0;
    for (const { goal, items } of picked) {
      if (!items.length) continue;
      need(18);
      text(goalTopic(goal.text), { size: 10, style: 'bold', color: pen, gap: 1.5 });
      for (const it of items) {
        n++;
        // Håll ihop frågan med sina alternativ eller skrivrader så långt det går.
        need(isFree(it) ? 16 + 8 * Math.min(6, it.level + 1) : it.kind === 'mcq' ? 14 + 5 * it.options.length : it.kind === 'write' ? 26 : 16);
        const q = it.kind === 'cloze' ? it.q.replace('___', '______________') : it.q;
        text(`${n}. ${q}`, { size: 11.5, style: 'bold', gap: 1.5 });
        if (it.kind === 'mcq') {
          const order = shuffle(it.options.map((_, i) => i));
          order.forEach((oi, k) => text(`${LETTERS[k]})  ${it.options[oi]}`, { x: M + 6, width: CW - 6, gap: 0.6 }));
          key.push(`${n}. ${LETTERS[order.indexOf(it.answer)]}) ${it.options[it.answer]}`);
          y += 2;
        } else if (it.kind === 'match') {
          const right = shuffle(it.pairs.map(p => p[1]));
          const half = CW / 2 - 4;
          it.pairs.forEach(([l], k) => {
            font(11); const h = Math.max(doc.splitTextToSize(clean(l), half - 14).length, doc.splitTextToSize(clean(right[k]), half - 8).length) * lh(11) + 2;
            need(h); const y0 = y;
            text(`${k + 1}. ${l}  ___`, { x: M + 6, width: half - 6, gap: 0 }); const y1 = y; y = y0;
            text(`${LETTERS[k]}) ${right[k]}`, { x: M + 6 + half + 4, width: half - 4, gap: 0 }); y = Math.max(y, y1) + 1.5;
          });
          key.push(`${n}. ${it.pairs.map(([l, r], k) => `${k + 1}${LETTERS[right.indexOf(r)]}`).join(', ')}`);
          y += 2;
        } else if (it.kind === 'sort') {
          text(`Skriv ${it.categories.map(c => `"${c}"`).join(', ').replace(/, ([^,]*)$/, ' eller $1')} efter varje påstående.`, { size: 10, color: ink2, x: M + 6, width: CW - 6 });
          it.items.forEach(([t]) => { text(`${t}  ______________`, { x: M + 6, width: CW - 6, gap: 1 }); });
          key.push(`${n}. ${it.items.map(([t, c]) => `${t}: ${c}`).join('; ')}`);
          y += 2;
        } else if (it.kind === 'math') {
          writeLines(2);
          key.push(`${n}. ${it.answerText}`);
          y += 2;
        } else if (it.kind === 'order') {
          text('Skriv 1 framför det som kommer först, 2 framför nästa och så vidare.', { size: 10, color: ink2, x: M + 6, width: CW - 6 });
          const shown = shuffle(it.steps);
          shown.forEach(t => { text(`___  ${t}`, { x: M + 6, width: CW - 6, gap: 1 }); });
          key.push(`${n}. ${shown.map(t => it.steps.indexOf(t) + 1).join(', ')}`);
          y += 2;
        } else if (it.kind === 'cloze') {
          key.push(`${n}. ${it.answer}`);
          y += 2;
        } else {
          writeLines(isFree(it) ? Math.min(6, it.level + 1) : 1);
          key.push(`${n}. ${isFree(it) ? `${it.answer}${it.must?.length ? ` (Ska ha med: ${it.must.join('; ')})` : ''}` : correctAnswerText(it)}`);
        }
      }
      y += 2;
    }
  }

  if (opts.key && key.length) {
    doc.addPage(); y = M;
    heading('Facit');
    // En facitpost delas inte mellan två sidor.
    for (const k of key) { font(10.5); need(doc.splitTextToSize(clean(k), CW).length * lh(10.5)); text(k, { size: 10.5, gap: 1.6 }); }
  }

  // Sidnummer
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); font(9, 'normal', ink2);
    doc.text(clean(`${test.subject} · sida ${p} av ${pages}`), W / 2, H - 9, { align: 'center' });
  }
  return doc.output('blob');
}

const csvCell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Svar som tabell. Semikolon och decimalkomma, så att svenskt Excel öppnar den direkt.
export function attemptsCsv({ attempts, goals, banks = {} }) {
  const goal = id => goals.find(g => g.id === id)?.text || '';
  const item = a => (banks[a.goalId] || []).find(i => i.id === a.itemId);
  // Flerval sparas som index; tabellen visar alternativets text.
  const shown = a => {
    const it = item(a);
    if (a.kind === 'mcq' && Number.isInteger(a.answer) && it?.options?.[a.answer] != null) return it.options[a.answer];
    if (Array.isArray(a.answer)) return a.answer.join(' → ');
    if (typeof a.answer === 'object' && a.answer) return Object.entries(a.answer).map(([x, y]) => `${x} – ${y}`).join(' | ');
    return a.answer;
  };
  const tz = { timeZone: 'Europe/Stockholm' };
  const head = ['Datum', 'Tid', 'Mål', 'Nivå', 'Frågetyp', 'Poäng', 'Bedömning', 'Läge', 'Svar'];
  const rows = attempts.slice().sort((a, b) => a.ts - b.ts).map(a => {
    const d = new Date(a.ts);
    const answer = shown(a);
    return [d.toLocaleDateString('sv-SE', tz), d.toLocaleTimeString('sv-SE', { ...tz, hour: '2-digit', minute: '2-digit' }), goal(a.goalId), a.level, a.kind,
      String(a.score).replace('.', ','), { right: 'Rätt', almost: 'Delvis', wrong: 'Fel' }[a.verdict] || a.verdict,
      a.exam ? 'Provläge' : a.helped ? 'Med materialet' : 'Övning', answer];
  });
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
}

export function backupJson(data) {
  const strip = m => ({ ...m, pages: (m.pages || []).map(({ img, ...p }) => p) });
  return JSON.stringify({ format: 'pluggkompis-backup', version: 1, exportedAt: new Date().toISOString(), ...data, materials: data.materials.map(strip) }, null, 2);
}

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prov';

export function PrintSheet({ env, test, goals, banks, mastery, materials, attempts, events, chats, exams, profile, onClose }) {
  const [opts, setOpts] = useState({ summary: true, questions: true, key: true, perGoal: 3, onlyOpen: false });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { kind, text }
  const canSave = !!env.save;
  const base = `${slug(test.subject)}-${test.testDate || 'utan-datum'}`;

  async function save(label, filename, make) {
    setBusy(label); setMsg(null);
    try {
      const data = await make();
      const r = await env.save(filename, data);
      setMsg(r === 'declined' ? null : { kind: 'ok', text: `${filename} är sparad.` });
    } catch (e) { setMsg({ kind: 'bad', text: (e && e.message) || 'Det gick inte att skapa filen.' }); }
    setBusy('');
  }
  const set = patch => setOpts(o => ({ ...o, ...patch }));
  const box = (k, label, hint) => html`<label class="opt-row"><input type="checkbox" checked=${opts[k]} onChange=${e => set({ [k]: e.target.checked })} />
    <span><strong>${label}</strong>${hint && html`<br /><span class="small muted">${hint}</span>`}</span></label>`;

  return html`<${Sheet} title="Skriv ut och exportera" onClose=${onClose} wide>
    ${!canSave && html`<p class="notice warn">Filer kan inte sparas i den här vyn. Öppna Pluggkompis direkt på claude.ai.</p>`}
    <section class="print-block">
      <h3>Instuderingshäfte (PDF)</h3>
      <p class="small muted">Att skriva ut och plugga med på papper. Frågorna går från lätt till svårare, och felstavade svarsalternativ tas aldrig med.</p>
      ${box('summary', 'Det här ska du kunna', 'Målen med de viktigaste punkterna under varje mål.')}
      ${box('questions', 'Övningsfrågor', 'Flerval, lucktext, para ihop och skrivfrågor med rader att skriva på.')}
      ${box('key', 'Facit', 'På egna sidor sist, så att det går att ta bort.')}
      ${box('onlyOpen', 'Bara mål som inte är klara', 'Hoppar över det barnet redan klarar.')}
      <label class="opt-row"><span><strong>Frågor per mål</strong></span>
        <select value=${opts.perGoal} onChange=${e => set({ perGoal: Number(e.target.value) })}>
          ${[2, 3, 4, 6].map(n => html`<option value=${n}>${n}</option>`)}</select></label>
      <button class="btn primary" disabled=${!canSave || !!busy || !env.config.libs.jspdf || !(opts.summary || opts.questions)}
        onClick=${() => save('Skapar häftet…', `${base}-instuderingshafte.pdf`, () => buildBookletPdf({ libs: env.config.libs, test, goals, banks, mastery, profileName: profile?.name, opts }))}>Skapa PDF</button>
    </section>
    <section class="print-block">
      <h3>Exportera</h3>
      <div class="actions left">
        <button class="btn ghost" disabled=${!canSave || !!busy || !attempts.length}
          onClick=${() => save('Skapar tabellen…', `${base}-svar.csv`, async () => attemptsCsv({ attempts, goals, banks }))}>Alla svar som tabell (CSV)</button>
        <button class="btn ghost" disabled=${!canSave || !!busy}
          onClick=${() => save('Skapar kopian…', `${base}-sakerhetskopia.json`, async () => backupJson({ test, profile: profile ? { name: profile.name, grade: gradeOf(profile) } : null, goals, banks, mastery, materials, attempts, events, chats, exams }))}>Säkerhetskopia (JSON)</button>
      </div>
      <p class="small muted">Tabellen öppnas direkt i Excel. Säkerhetskopian innehåller allt om provet utom bilder, och kan läsas in på den egna servern senare.</p>
    </section>
    ${busy && html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>${busy}</p>`}
    ${msg && html`<p class=${'notice ' + (msg.kind === 'bad' ? 'bad' : '')}>${msg.text}</p>`}
  <//>`;
}
