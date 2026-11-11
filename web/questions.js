// Interaktiva frågetyper: para ihop (tryck eller dra), sortering till kategorier, begreppskort.
// Allt går att göra med tryck och tangentbord; dra är ett tillägg för pekskärm och mus.
import { html, useState, useEffect, useMemo, useRef } from './lib.js';
import { shuffle, orderDistance } from './engine.js';

// Gemensam dra-logik: drar ett element och rapporterar vilket mål (data-drop) det släpps på.
function useDrag(onDrop) {
  const ghost = useRef(null);
  return (e, payload, label) => {
    if (e.button !== undefined && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
      if (!moved) {
        moved = true;
        const g = document.createElement('div');
        g.className = 'drag-ghost';
        g.textContent = label;
        document.body.appendChild(g);
        ghost.current = g;
      }
      ev.preventDefault();
      ghost.current.style.transform = `translate(${ev.clientX + 8}px, ${ev.clientY + 8}px)`;
      document.querySelectorAll('[data-drop].drop-hover').forEach(x => x.classList.remove('drop-hover'));
      document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]')?.classList.add('drop-hover');
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.querySelectorAll('[data-drop].drop-hover').forEach(x => x.classList.remove('drop-hover'));
      if (ghost.current) { ghost.current.remove(); ghost.current = null; }
      if (!moved) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]');
      if (target) onDrop(payload, target.dataset.drop);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
  };
}

// Para ihop: tryck på ett ord och sedan på förklaringen, eller dra ordet dit.
export function MatchQuestion({ item, disabled, onAnswer, result }) {
  const lefts = useMemo(() => shuffle(item.pairs.map(p => p[0])), [item.id]);
  const rights = useMemo(() => shuffle(item.pairs.map(p => p[1])), [item.id]);
  const [pairs, setPairs] = useState({}); // vänster -> höger
  const [sel, setSel] = useState(null);
  useEffect(() => { setPairs({}); setSel(null); }, [item.id]);
  const correct = Object.fromEntries(item.pairs);
  const link = (l, r) => setPairs(p => {
    const next = Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== l && v !== r));
    next[l] = r;
    return next;
  });
  const drag = useDrag((l, r) => { if (!disabled) { link(l, r); setSel(null); } });
  const colorOf = l => lefts.indexOf(l) % 5;
  const leftOf = r => Object.keys(pairs).find(k => pairs[k] === r);
  const complete = Object.keys(pairs).length === item.pairs.length;
  const shownPairs = result ? result.given || pairs : pairs;

  return html`<h2 class="q">${item.q}</h2>
    <p class="small muted hint-line">Tryck på ett ord och sedan på det som hör ihop. Du kan också dra.</p>
    <div class="match2">
      <div class="m-col">${lefts.map(l => {
        const r = shownPairs[l];
        const state = result ? (r === correct[l] ? ' ok' : ' no') : '';
        return html`<button class=${'m-item left' + (sel === l ? ' sel' : '') + (r ? ` paired c${colorOf(l)}` : '') + state} disabled=${disabled}
          onClick=${() => setSel(sel === l ? null : l)} onPointerDown=${e => !disabled && drag(e, l, l)} aria-pressed=${sel === l}>${l}</button>`;
      })}</div>
      <div class="m-col">${rights.map(r => {
        const l = Object.keys(shownPairs).find(k => shownPairs[k] === r);
        return html`<button class=${'m-item right' + (l ? ` paired c${colorOf(l)}` : '') + (sel && !disabled ? ' target' : '')} data-drop=${r} disabled=${disabled}
          onClick=${() => { if (sel) { link(sel, r); setSel(null); } else if (leftOf(r)) setPairs(p => { const n = { ...p }; delete n[leftOf(r)]; return n; }); }}>
          ${r}</button>`;
      })}</div>
    </div>
    ${result && result.verdict !== 'right' && html`<ul class="m-key small">${item.pairs.map(([l, r]) => html`<li><strong>${l}</strong> – ${r}</li>`)}</ul>`}
    ${!disabled && html`<div class="actions"><button class="btn ghost small" disabled=${!Object.keys(pairs).length} onClick=${() => setPairs({})}>Börja om</button>
      <button class="btn primary" disabled=${!complete} onClick=${() => onAnswer(pairs)}>Svara</button></div>`}`;
}

// Sortering: lägg varje påstående i rätt kategori, som i ett Venn-diagram.
export function SortQuestion({ item, disabled, onAnswer, result }) {
  const order = useMemo(() => shuffle(item.items.map(i => i[0])), [item.id]);
  const [placed, setPlaced] = useState({}); // påstående -> kategori
  const [sel, setSel] = useState(null);
  useEffect(() => { setPlaced({}); setSel(null); }, [item.id]);
  const correct = Object.fromEntries(item.items);
  const put = (t, c) => setPlaced(p => ({ ...p, [t]: c }));
  const drag = useDrag((t, c) => { if (!disabled) { c === '__pool' ? setPlaced(p => { const n = { ...p }; delete n[t]; return n; }) : put(t, c); setSel(null); } });
  const shown = result ? result.given || placed : placed;
  const pool = order.filter(t => !shown[t]);
  const venn = item.categories.length === 3 && /båda|bägge|gemensamt/i.test(item.categories[2]);
  const cats = venn ? [item.categories[0], item.categories[2], item.categories[1]] : item.categories;

  const chip = t => {
    const state = result ? (shown[t] === correct[t] ? ' ok' : ' no') : '';
    return html`<button class=${'s-chip' + (sel === t ? ' sel' : '') + state} disabled=${disabled} aria-pressed=${sel === t}
      onClick=${() => setSel(sel === t ? null : t)} onPointerDown=${e => !disabled && drag(e, t, t)}>${t}</button>`;
  };

  return html`<h2 class="q">${item.q}</h2>
    <p class="small muted hint-line">Tryck på ett påstående och sedan på rätt ruta, eller dra det dit.</p>
    ${!disabled && html`<div class="s-pool" data-drop="__pool">${pool.length ? pool.map(chip) : html`<span class="small muted">Alla är sorterade.</span>`}</div>`}
    <div class=${'s-bins' + (venn ? ' venn' : '')}>
      ${cats.map(c => html`<div class=${'s-bin' + (sel && !disabled ? ' target' : '')} data-drop=${c}
          onClick=${e => { if (sel && e.target.closest('.s-chip') === null) { put(sel, c); setSel(null); } }}>
        <span class="s-label">${c}</span>
        <div class="s-items">${order.filter(t => shown[t] === c).map(chip)}</div>
      </div>`)}
    </div>
    ${result && result.verdict !== 'right' && html`<p class="small">Rättat: ${order.filter(t => shown[t] !== correct[t]).map(t => html`<span class="fix"><strong>${t}</strong> hör till ${correct[t]}. </span>`)}</p>`}
    ${!disabled && html`<div class="actions"><button class="btn ghost small" disabled=${!Object.keys(placed).length} onClick=${() => setPlaced({})}>Börja om</button>
      <button class="btn primary" disabled=${pool.length > 0} onClick=${() => onAnswer(placed)}>Svara</button></div>`}`;
}

// Sätt i ordning: barnet flyttar stegen upp och ned (knappar fungerar på iPad utan
// dragningar). Startordningen är aldrig redan rätt.
export function OrderQuestion({ item, disabled, onAnswer, result }) {
  // Startordningen är minst två byten från rätt, så att ett svar utan att flytta något aldrig blir rätt eller nästan rätt.
  const start = useMemo(() => {
    let o = shuffle(item.steps);
    for (let i = 0; i < 30 && orderDistance(item.steps, o) < 2; i++) o = shuffle(item.steps);
    if (orderDistance(item.steps, o) < 2) o = item.steps.slice().reverse();
    return o;
  }, [item.id]);
  const [order, setOrder] = useState(start);
  useEffect(() => { setOrder(start); }, [item.id]);
  const shown = result ? (Array.isArray(result.given) ? result.given : order) : order;
  const move = (i, d) => setOrder(o => { const n = o.slice(); [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  return html`<h2 class="q">${item.q}</h2>
    <p class="small muted hint-line">Flytta stegen med pilarna tills de står i rätt ordning, det första överst.</p>
    <ol class="order-list">${shown.map((s, i) => html`<li class=${'order-item' + (result ? (s === item.steps[i] ? ' ok' : ' no') : '')}>
      <span class="order-n">${i + 1}</span><span class="order-text">${s}</span>
      ${!disabled && html`<span class="order-btns">
        <button class="btn ghost small" aria-label=${`Flytta upp: ${s}`} disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button>
        <button class="btn ghost small" aria-label=${`Flytta ned: ${s}`} disabled=${i === shown.length - 1} onClick=${() => move(i, 1)}>↓</button></span>`}
    </li>`)}</ol>
    ${result && result.verdict !== 'right' && html`<p class="small">Rätt ordning: ${item.steps.map((s, i) => html`<span class="fix">${i + 1}. ${s} </span>`)}</p>`}
    ${!disabled && html`<div class="actions"><button class="btn primary" onClick=${() => onAnswer(order)}>Svara</button></div>`}`;
}

// Matematik (math.js): genomräknade steg som visas efter nivå, ledtrådsstege och ett svar.
// En ledtråd räknas som hjälp (flyttar inte nivån), som att titta i materialet.
export function MathQuestion({ item, disabled, onAnswer, result, onHelp }) {
  const [v, setV] = useState('');
  const [hints, setHints] = useState(0);
  const ref = useRef();
  useEffect(() => { setV(''); setHints(0); ref.current?.focus(); }, [item.id]);
  const steps = result ? item.steps : item.steps.slice(0, item.shown);
  return html`<form class="math" onSubmit=${e => { e.preventDefault(); if (v.trim() && !disabled) onAnswer(v); }}>
    <h2 class="q">${item.q}</h2>
    ${steps.length > 0 && html`<ol class="math-steps">${steps.map((s, i) => html`<li class=${result && i >= item.shown ? 'revealed' : ''}>${s}</li>`)}
      ${!result && item.shown > 0 && html`<li class="math-blank">${item.shown === item.steps.length - 1 ? 'Svaret blir …' : 'Fortsätt själv …'}</li>`}</ol>`}
    ${!result && item.hints?.length > 0 && html`<div class="math-hints">
      ${item.hints.slice(0, hints).map(h => html`<p class="hint-line">💡 ${h}</p>`)}
      ${hints < item.hints.length && html`<button type="button" class="btn ghost small" onClick=${() => { setHints(hints + 1); onHelp?.(); }}>${hints ? 'En ledtråd till' : 'Ledtråd'}</button>`}
    </div>`}
    <label class="sr" for="ans">Ditt svar</label>
    <span class="math-answer"><input id="ans" ref=${ref} class="answer" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text"
      disabled=${disabled} value=${result ? result.given : v} onInput=${e => setV(e.target.value)} placeholder="Ditt svar" />${item.unit && html`<span class="unit">${item.unit}</span>`}</span>
    <p class="small muted">Du kan skriva till exempel 7, 0,5, 1/2 eller 50 %.</p>
    ${!disabled && html`<button class="btn primary" disabled=${!v.trim()}>Svara</button>`}
  </form>`;
}

// Begreppskort: visas första gången ett mål dyker upp. Ingen rättning, bara bekanta sig.
export function IntroCard({ goal, item, onDone }) {
  const [flipped, setFlipped] = useState(false);
  const back = item.kind === 'mcq' ? item.options[item.answer] : item.answer;
  return html`<div class="intro">
    <p class="eyebrow">Nytt att lära</p>
    <button class=${'flip' + (flipped ? ' on' : '')} onClick=${() => setFlipped(!flipped)} aria-label=${flipped ? 'Visa frågan' : 'Vänd kortet'}>
      <span class="flip-inner">
        <span class="flip-face face-front"><span class="q">${item.q}</span><span class="small muted">Tryck för att vända</span></span>
        <span class="flip-face face-back"><strong class="flip-answer">${back}</strong>${item.explain && html`<span>${item.explain}</span>`}</span>
      </span>
    </button>
    <p class="small muted">${goal.text.replace(/^kunna\s+/i, 'Du ska kunna ')}</p>
    <div class="actions"><button class="btn primary" disabled=${!flipped} onClick=${onDone}>${flipped ? 'Jag har läst, nu kör vi' : 'Vänd kortet först'}</button></div>
  </div>`;
}
