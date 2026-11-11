// AI-flödet: tolka material → föreslå lärandemål → skapa frågebank.
// Varje steg sparar löpande, så ett avbrott tappar inget färdigt arbete.
// Inga automatiska omförsök: ett schemafel får en rättelse, sedan stoppar steget med ett tydligt fel.
import {
  interpretPrompt, validateInterpret, goalsPrompt, validateGoals,
  bankPrompt, validateBank, correctionPrompt, PROMPT_VERSION,
  bankHighPrompt, validateHigh, highLevelsFor, sortPrompt, validateSortItems, teachPrompt, validateTeach,
} from './prompts.js';
import { uid } from './repo.js';

export class StepError extends Error {}

async function askJson(ai, prompt, opts, validate) {
  const first = await ai.complete({ prompt, json: true, ...opts });
  let v = validate(first.json);
  if (v.ok) return v;
  const second = await ai.complete({ prompt: correctionPrompt(prompt, v.errors), json: true, ...opts });
  const v2 = validate(second.json);
  return v2.ok || scoreOf(v2) >= scoreOf(v) ? v2 : v;
}
const scoreOf = v => -(v.errors?.length || 0);

// ---- Steg 1 ----
// mat: { id, ref, name, pages:[{p, raw, image?}], needsAi }
export async function interpretMaterial({ ai, config, test, mat, onProgress }) {
  if (!mat.needsAi) {
    return mat.pages.map(p => ({ p: p.p, kind: 'fakta', text: p.raw }));
  }
  if (!ai) throw new StepError('Claude är inte tillgängligt, så PDF:er och foton kan inte tolkas här.');
  const withImages = !!config.features.images;
  const batchSize = withImages ? Math.max(1, Math.min(4, config.features.imageMaxCount || 4)) : 8;
  const result = [];
  for (let i = 0; i < mat.pages.length; i += batchSize) {
    const pages = mat.pages.slice(i, i + batchSize);
    onProgress?.(`Tolkar ${mat.name}, sida ${pages[0].p}${pages.length > 1 ? '–' + pages[pages.length - 1].p : ''} av ${mat.pages.length}`);
    const images = withImages ? pages.map(p => p.image).filter(Boolean) : undefined;
    const prompt = interpretPrompt({ test, fileName: mat.name, pages, withImages: !!images?.length });
    const v = await askJson(ai, prompt, { images, tier: 'default' }, out => validateInterpret(out, pages));
    if (!v.pages?.length) throw new StepError(`Kunde inte tolka ${mat.name}: ${v.errors.slice(0, 2).join(' ')}`);
    for (const p of pages) {
      const got = v.pages.find(x => x.p === p.p);
      result.push(got || { p: p.p, kind: 'ovrigt', text: p.raw });
    }
  }
  return result;
}

// ---- Steg 2 ----
export async function proposeGoals({ ai, test, materials }) {
  if (!ai) throw new StepError('Claude är inte tillgängligt, så lärandemål kan inte föreslås här.');
  const usable = materials.filter(m => m.status === 'interpreted');
  if (!usable.length) throw new StepError('Inget material är inläst än.');
  const prompt = goalsPrompt({ test, materials: usable });
  const v = await askJson(ai, prompt, { tier: 'complex' }, out => validateGoals(out, usable));
  if (!v.goals.length) throw new StepError('Inga lärandemål kunde tas fram. ' + v.errors.slice(0, 2).join(' '));
  return {
    goals: v.goals.map((g, i) => ({
      ...g, id: 'g' + uid(), order: i, approved: false, removed: false, parentNote: '', pv: PROMPT_VERSION,
    })),
    outOfScope: v.outOfScope,
    comment: v.comment,
    warnings: v.errors,
  };
}

// ---- Steg 3 ----
function sourceTextFor(goals, materials) {
  const want = new Set(goals.flatMap(g => g.sources.map(s => `${s.m}:${s.p}`)));
  let out = '';
  for (const m of materials) {
    for (const p of m.pages || []) {
      if (want.has(`${m.ref}:${p.p}`)) out += `\n[${m.ref}:${p.p}] ${m.name}, sida ${p.p}\n${p.text}\n`;
    }
  }
  const notes = goals.filter(g => g.parentNote).map(g => `[note:0] Förälderns anteckning till ${g.id}: ${g.parentNote}`);
  if (notes.length) out += '\n' + notes.join('\n') + '\n';
  return out;
}

export async function buildBank({ ai, repo, test, goals, materials, existing, onProgress }) {
  if (!ai) throw new StepError('Claude är inte tillgängligt, så frågor kan inte skapas här.');
  const todo = goals.filter(g => !existing[g.id]?.length);
  const batches = [];
  const glosor = todo.filter(g => g.type === 'glosa');
  const other = todo.filter(g => g.type !== 'glosa');
  for (let i = 0; i < other.length; i += 3) batches.push(other.slice(i, i + 3));
  for (let i = 0; i < glosor.length; i += 6) batches.push(glosor.slice(i, i + 6));

  const validRefs = new Set(materials.flatMap(m => (m.pages || []).map(p => `${m.ref}:${p.p}`)));
  const short = [];
  let done = goals.length - todo.length;
  for (const batch of batches) {
    onProgress?.({ done, total: goals.length, label: batch.map(g => g.text).join(' · ') });
    const prompt = bankPrompt({ test, goals: batch, sourceText: sourceTextFor(batch, materials) });
    const v = await askJson(ai, prompt, { tier: 'default' }, out => validateBank(out, batch, validRefs));
    for (const g of batch) {
      const items = (v.byGoal[g.id] || []).map(it => ({ ...it, id: 'i' + uid() }));
      if (!items.length) { short.push(g.text); continue; }
      await repo.saveBank(test.id, g.id, items);
      if (v.short.some(s => s.startsWith(g.id))) short.push(g.text);
      done += 1;
    }
    onProgress?.({ done, total: goals.length, label: '' });
  }
  return { short };
}

// ---- Steg 3b: fritextfrågor för nivå 3–5 (glosor nivå 4) ----
// Läggs till i befintlig frågebank. Mål som redan har fritextfrågor hoppas över.
export async function buildHighBank({ ai, repo, test, goals, materials, existing, onProgress }) {
  if (!ai) throw new StepError('Claude är inte tillgängligt, så frågor kan inte skapas här.');
  const hasHigh = g => (existing[g.id] || []).some(i => highLevelsFor(g).includes(i.level) && i.must);
  const todo = goals.filter(g => highLevelsFor(g).length && !hasHigh(g));
  const batches = [];
  const glosor = todo.filter(g => g.type === 'glosa');
  const other = todo.filter(g => g.type !== 'glosa');
  for (let i = 0; i < other.length; i += 2) batches.push(other.slice(i, i + 2));
  for (let i = 0; i < glosor.length; i += 6) batches.push(glosor.slice(i, i + 6));

  const validRefs = new Set(materials.flatMap(m => (m.pages || []).map(p => `${m.ref}:${p.p}`)));
  const short = [];
  let done = 0;
  for (const batch of batches) {
    onProgress?.({ done, total: todo.length, label: batch.map(g => g.text).join(' · ') });
    const prompt = bankHighPrompt({ test, goals: batch, sourceText: sourceTextFor(batch, materials) });
    const v = await askJson(ai, prompt, { tier: 'default' }, out => validateHigh(out, batch, validRefs));
    for (const g of batch) {
      const items = (v.byGoal[g.id] || []).map(it => ({ ...it, id: 'i' + uid() }));
      if (items.length) await repo.saveBank(test.id, g.id, [...(existing[g.id] || []), ...items]);
      if (!items.length || v.short.some(s => s.startsWith(g.id))) short.push(g.text);
      done += 1;
    }
    onProgress?.({ done, total: todo.length, label: '' });
  }
  return { short, created: todo.length };
}

// ---- Sorteringsövningar i efterhand (samband-mål, nivå 2) ----
export async function buildSortBank({ ai, repo, test, goals, materials, existing, onProgress }) {
  if (!ai) throw new StepError('Claude är inte tillgängligt, så övningar kan inte skapas här.');
  const todo = goals.filter(g => g.type === 'samband' && !(existing[g.id] || []).some(i => i.kind === 'sort'));
  const validRefs = new Set(materials.flatMap(m => (m.pages || []).map(p => `${m.ref}:${p.p}`)));
  let done = 0;
  const short = [];
  for (let i = 0; i < todo.length; i += 3) {
    const batch = todo.slice(i, i + 3);
    onProgress?.({ done, total: todo.length, label: '' });
    const prompt = sortPrompt({ test, goals: batch, sourceText: sourceTextFor(batch, materials) });
    const v = await askJson(ai, prompt, { tier: 'default' }, out => validateSortItems(out, batch, validRefs));
    for (const g of batch) {
      const items = (v.byGoal[g.id] || []).map(it => ({ ...it, id: 'i' + uid() }));
      if (items.length) await repo.saveBank(test.id, g.id, [...(existing[g.id] || []), ...items]);
      else short.push(g.text);
      done += 1;
    }
  }
  return { short, created: todo.length };
}

// ---- Lär ut det ----
// Kärnan i ett mål: bedömningspunkter och förklaringar ur frågebanken, utan dubbletter.
export function teachFacts(bank = []) {
  const seen = new Set();
  const out = [];
  for (const it of bank.slice().sort((a, b) => b.level - a.level)) {
    for (const f of [...(it.must || []), it.quote, it.explain]) {
      const t = String(f || '').trim();
      const key = t.toLowerCase();
      if (t && t.length > 3 && !seen.has(key)) { seen.add(key); out.push(t); }
    }
  }
  return out.slice(0, 14);
}

export async function teachTurn({ ai, test, goal, facts, pageText, kompis, turns }) {
  const v = await askJson(ai, teachPrompt({ test, goal, facts, pageText, kompis, turns }), { tier: 'default' }, validateTeach);
  if (!v.ok) throw new StepError('Svaret gick inte att läsa. Försök igen.');
  return v.value;
}
