// Visar källsidan för en fråga, läsvänligt uppdelad, med den del som frågan bygger på markerad.
import { html, useState, useMemo, useEffect, useRef } from './lib.js';
import { Sheet } from './sheet.js';
import { normalize, stripAccents } from './engine.js';

const words = s => stripAccents(normalize(s)).split(' ').filter(w => w.length >= 4);
const BULLET = /^[-*•●▪◦–]\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BOLD_DEF = /^\*\*(.+?)\*\*\s*[:–-]?\s*(.*)$/;
const PLAIN_DEF = /^([^:.!?]{2,42}):\s+(.+)$/;
const TERM_ONLY = /^\*{0,2}([^:.!?*]{2,42}?)\*{0,2}:\*{0,2}$/;      // "Moské, Imam:" med text på raderna under
const FIGURE = /^\*{0,2}(bild|figur|diagram|karta|illustration|foto)\*{0,2}\s*:\*{0,2}\s*(.+)$/i;
const fewWords = (s, n) => s.trim().split(/\s+/).length <= n;

// Delar en tolkad sida i block: rubriker, begrepp med förklaring, bilder, punktlistor och stycken.
// Varje läsbar enhet får ett nummer (u) så att rätt del kan markeras. Bilder numreras (n) i
// ordning på sidan så att de kan kopplas till bilderna i originalet.
export function parseBlocks(text) {
  const lines = String(text || '').split('\n').map(l => l.trim());
  const blocks = [];
  let u = 0, n = 0;
  const lastBlock = () => blocks[blocks.length - 1];
  const push = (type, item) => {
    let last = lastBlock();
    // Begreppsrader med tomrad emellan hör ändå till samma tabell.
    if (type === 'dl' && last?.type === 'gap' && blocks[blocks.length - 2]?.type === 'dl') { blocks.pop(); last = lastBlock(); }
    if (last && last.type === type) last.items.push(item);
    else blocks.push({ type, items: [item] });
  };
  const def = (term, text) => {
    // "Högtider: ramadan, eid al-fitr, eid al-adha" är en översikt: den blir en avsnittsrubrik.
    const parts = text.split(/,\s*|\s+och\s+/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 3 && !/[.!?]$/.test(text) && parts.every(x => fewWords(x, 4))) {
      blocks.push({ type: 'topic', text: term.replace(/\*\*/g, '').replace(/:$/, '').trim(), parts, u: u++ });
      return;
    }
    push('dl', { term: term.replace(/\*\*/g, '').replace(/:$/, '').trim(), text, u: text ? u++ : null, more: [] });
  };

  lines.forEach((line, i) => {
    if (!line) { blocks.push({ type: 'gap' }); return; }
    let m;
    if ((m = line.match(HEADING))) { blocks.push({ type: 'h', level: m[1].length, text: m[2].replace(/:$/, ''), u: u++ }); return; }
    if ((m = line.match(FIGURE))) { blocks.push({ type: 'fig', text: m[2], u: u++, n: n++ }); return; }
    if ((m = line.match(BULLET))) {
      const inner = m[1].match(BOLD_DEF) || m[1].match(PLAIN_DEF);
      push('ul', inner && inner[2] ? { term: inner[1].replace(/:$/, ''), text: inner[2], u: u++ } : { text: m[1], u: u++ });
      return;
    }
    if ((m = line.match(NUMBERED))) { push('ol', { text: m[2], u: u++ }); return; }
    if ((m = line.match(BOLD_DEF)) && m[2]) { def(m[1], m[2]); return; }
    if ((m = line.match(PLAIN_DEF)) && fewWords(m[1], 5)) { def(m[1], m[2]); return; }
    const next = lines.slice(i + 1).find(Boolean);
    if ((m = line.match(TERM_ONLY)) && fewWords(m[1], 6) && next) { def(m[1], ''); return; }
    // En rad direkt under ett begrepp (utan tomrad) fortsätter förklaringen.
    const last = lastBlock();
    if (last?.type === 'dl' && lines[i - 1]) {
      const it = last.items[last.items.length - 1];
      if (!it.text) { it.text = line; it.u = u++; } else it.more.push({ text: line, u: u++ });
      return;
    }
    const short = line.length <= 42 && !/[.!?,;:]$/.test(line) && fewWords(line, 6);
    if ((short && next) || /^\*\*[^*]+\*\*$/.test(line)) { blocks.push({ type: 'h', level: 3, text: line.replace(/\*\*/g, ''), u: u++ }); return; }
    blocks.push({ type: 'p', text: line, u: u++ });
  });
  // Begrepp som aldrig fick någon förklaring visas som rubrik.
  for (const [bi, b] of blocks.entries()) {
    if (b.type === 'dl' && b.items.every(it => !it.text)) blocks[bi] = { type: 'h', level: 3, text: b.items.map(it => it.term).join(', '), u: u++ };
    else if (b.type === 'dl') b.items = b.items.filter(it => it.text);
  }
  // Ta bort luckor i början, slutet och dubbla luckor.
  return blocks.filter((b, i, a) => b.type !== 'gap' || (i > 0 && i < a.length - 1 && a[i - 1].type !== 'gap'));
}

function units(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.items) for (const it of b.items) {
      out.push({ u: it.u, text: it.term ? `${it.term}: ${it.text}` : it.text });
      for (const x of it.more || []) out.push({ u: x.u, text: `${it.term}: ${x.text}` });
    } else if (b.u != null) out.push({ u: b.u, text: b.parts ? `${b.text}: ${b.parts.join(', ')}` : b.text });
  }
  return out;
}

// Väljer den enhet som bäst matchar frågan. Citatet från frågegenereringen används först.
export function findPassage(text, item) {
  const blocks = parseBlocks(text);
  const list = units(blocks);
  if (!list.length) return { blocks, hit: -1 };
  if (item.quote) {
    const q = stripAccents(normalize(item.quote));
    const f = list.find(x => { const n = stripAccents(normalize(x.text)); return n.includes(q.slice(0, 60)) || (q.includes(n) && n.length > 12); });
    if (f) return { blocks, hit: f.u };
  }
  const answer = typeof item.answer === 'number' ? item.options?.[item.answer] : item.answer;
  const target = new Set(words([answer, item.explain, item.q, ...(item.must || []), ...(item.pairs || []).flat(), ...(item.items || []).map(i => i[0])].filter(Boolean).join(' ')));
  let best = -1, bestScore = 0;
  for (const x of list) {
    const score = words(x.text).filter(w => target.has(w)).length + (answer && stripAccents(normalize(x.text)).includes(stripAccents(normalize(answer))) ? 3 : 0);
    if (score > bestScore) { bestScore = score; best = x.u; }
  }
  return { blocks, hit: bestScore >= 2 ? best : -1 };
}

// **fet** i texten blir fet stil.
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map(p => (/^\*\*[^*]+\*\*$/.test(p) ? html`<strong>${p.slice(2, -2)}</strong>` : p));
}

// En bild ur originalet: urklipp av bilden om läget är känt, annars beskrivningen.
function Crop({ r, orig, onShowPage }) {
  const pad = 0.006;
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const w = Math.min(1 - x, r.w + 2 * pad), h = Math.min(1 - y, r.h + 2 * pad);
  return html`<button class="src-fig-crop" onClick=${onShowPage} aria-label="Visa hela originalsidan"
    style=${`aspect-ratio:${(w * orig.width) / (h * orig.height)};max-width:${Math.min(100, w * 230)}%`}>
    <img src=${orig.url} alt="" style=${`width:${100 / w}%;left:${(-x / w) * 100}%;top:${(-y / h) * 100}%`} /></button>`;
}

// Bilder som texten inte beskriver kopplas till det begrepp som står bredvid dem i originalet.
function placeFigures(blocks, orig) {
  const described = blocks.filter(b => b.type === 'fig').length;
  const rest = (orig?.figures || []).slice(described);
  const byItem = new Map(), extra = [];
  const terms = blocks.filter(b => b.type === 'dl').flatMap(b => b.items).map(it => {
    const first = it.term.toLowerCase().split(/[\s,]+/)[0];
    const ys = (orig?.text || []).filter(t => t.s.trim().startsWith(first)).map(t => t.y);
    return ys.length ? { it, ys } : null;
  }).filter(Boolean);
  for (const r of rest) {
    let best = null, dist = Infinity;
    for (const t of terms) for (const y of t.ys) {
      if (y < r.y - 0.04 || y > r.y + r.h) continue;
      if (Math.abs(y - r.y) < dist) { dist = Math.abs(y - r.y); best = t; }
    }
    if (best) byItem.set(best.it, [...(byItem.get(best.it) || []), r]);
    else extra.push(r);
  }
  return { byItem, extra };
}

function Figure({ b, orig, onShowPage, mark }) {
  const r = orig?.figures?.[b.n];
  const crop = r ? html`<${Crop} r=${r} orig=${orig} onShowPage=${onShowPage} />` : null;
  return html`<figure class="src-fig">
    ${crop || (orig === undefined && html`<div class="src-fig-wait" aria-hidden="true"></div>`)}
    <figcaption><span class="src-fig-tag">Bild</span> ${mark(b.u, inline(b.text))}
      ${!crop && onShowPage && orig !== undefined && html` <button class="link small" onClick=${onShowPage}>Se bilden på originalsidan</button>`}</figcaption>
  </figure>`;
}

function Blocks({ blocks, hit, markRef, orig, onShowPage, byItem }) {
  const mark = (u, content) => (u === hit ? html`<mark class="src-hit" ref=${markRef}>${content}</mark>` : content);
  return blocks.map(b => {
    if (b.type === 'gap') return html`<div class="src-gap" aria-hidden="true"></div>`;
    if (b.type === 'h') return b.level <= 2
      ? html`<h3 class="src-h1">${mark(b.u, inline(b.text))}</h3>`
      : html`<h4 class="src-h">${mark(b.u, inline(b.text))}</h4>`;
    if (b.type === 'topic') return html`<section class=${'src-topic' + (b.u === hit ? ' is-hit' : '')}>
      <h4 class="src-h">${inline(b.text)}</h4>
      <ul class="src-parts">${b.parts.map(x => html`<li>${inline(x.replace(/^\p{Ll}/u, c => c.toUpperCase()))}</li>`)}</ul></section>`;
    if (b.type === 'fig') return html`<${Figure} b=${b} orig=${orig} onShowPage=${onShowPage} mark=${mark} />`;
    if (b.type === 'p') return html`<p class="src-p">${mark(b.u, inline(b.text))}</p>`;
    if (b.type === 'dl') return html`<dl class="src-dl">${b.items.map(it => {
      const hitHere = it.u === hit || it.more.some(x => x.u === hit);
      return html`<div class=${'src-def' + (hitHere ? ' is-hit' : '')}>
        <dt>${inline(it.term)}</dt>
        <dd><p>${mark(it.u, inline(it.text))}</p>${it.more.map(x => html`<p>${mark(x.u, inline(x.text))}</p>`)}
          ${byItem?.get(it)?.map(r => html`<${Crop} r=${r} orig=${orig} onShowPage=${onShowPage} />`)}</dd></div>`;
    })}</dl>`;
    const List = b.type === 'ol' ? 'ol' : 'ul';
    return html`<${List} class="src-list">${b.items.map(it => html`<li>${it.term
      ? html`<strong>${inline(it.term)}:</strong> ${mark(it.u, inline(it.text))}`
      : mark(it.u, inline(it.text))}</li>`)}<//>`;
  });
}

export function SourceSheet({ item, materials, onClose, before, files, libs }) {
  const mat = materials.find(m => m.ref === item.src?.m);
  const [page, setPage] = useState(item.src?.p || 1);
  const [showImg, setShowImg] = useState(false);
  const [orig, setOrig] = useState(undefined); // undefined = laddar, null = finns inte
  const pg = mat?.pages.find(p => p.p === page);
  const { blocks, hit } = useMemo(() => (pg ? findPassage(pg.text, item) : { blocks: [], hit: -1 }), [pg, item]);
  const pages = mat?.pages.map(p => p.p) || [];
  const idx = pages.indexOf(page);
  const onSource = page === item.src?.p;
  const markEl = useRef();
  const fromPdf = mat?.kind === 'pdf' && mat.fileAssetId && files?.urlFor && libs?.pdfjs;

  // Originalsidan ritas upp ur PDF:en när sidan har en bild eller när barnet vill se den.
  useEffect(() => {
    let live = true;
    if (!fromPdf) { setOrig(pg?.img && mat?.kind === 'image' ? { url: pg.img, width: 1, height: 1, figures: [] } : null); return; }
    setOrig(undefined);
    import('./figures.js').then(f => f.pdfPage({ files, libs, assetId: mat.fileAssetId, p: page }))
      .then(o => live && setOrig(o), () => live && setOrig(null));
    return () => { live = false; };
  }, [page, showImg && fromPdf]);
  useEffect(() => { if (onSource && !showImg) setTimeout(() => markEl.current?.scrollIntoView({ block: 'center' }), 80); }, [page, showImg]);

  const pageImg = orig?.url || pg?.img;
  // Bilder i originalet som texten inte beskriver visas sist, så att inget går förlorat.
  const { byItem, extra } = useMemo(() => placeFigures(blocks, orig), [blocks, orig]);
  const canShow = !!(pg?.img || fromPdf);
  return html`<${Sheet} title=${mat ? mat.name : 'Materialet'} onClose=${onClose} wide>
    ${before && html`<p class="notice small">Du tittar innan du svarar. Det är bra för att lära sig, men svaret räknas då som övning och flyttar inte nivån.</p>`}
    ${!mat && html`<p class="muted">Svaret bygger på förälderns anteckning, inte på en sida i materialet.</p>`}
    ${mat && html`
      <div class="src-bar">
        <button class="btn ghost small" disabled=${idx <= 0} onClick=${() => { setShowImg(false); setPage(pages[idx - 1]); }} aria-label="Föregående sida">←</button>
        <span class="src-page">Sida ${page} <span class="muted">av ${pages.length}</span></span>
        <button class="btn ghost small" disabled=${idx >= pages.length - 1} onClick=${() => { setShowImg(false); setPage(pages[idx + 1]); }} aria-label="Nästa sida">→</button>
        ${canShow && html`<button class="link small src-toggle" onClick=${() => setShowImg(!showImg)}>${showImg ? 'Visa som text' : 'Visa originalsidan'}</button>`}
      </div>
      ${onSource && hit >= 0 && !showImg && html`<p class="src-legend"><span class="src-swatch" aria-hidden="true"></span>Det markerade är det frågan bygger på.</p>`}
      ${showImg
        ? (pageImg ? html`<img class="src-img" src=${pageImg} alt=${`Sida ${page} i ${mat.name}`} />`
          : orig === undefined ? html`<p class="notice working" role="status"><span class="spinner" aria-hidden="true"></span>Hämtar originalsidan…</p>`
          : html`<p class="notice warn">Originalsidan gick inte att visa.</p>`)
        : html`<article class="src-doc"><${Blocks} blocks=${blocks} hit=${onSource ? hit : -1} markRef=${markEl} orig=${orig} byItem=${byItem}
            onShowPage=${canShow ? () => setShowImg(true) : null} />
          ${extra.length > 0 && html`<section class="src-extra"><h4 class="src-h">Fler bilder på sidan</h4>
            <div class="src-gallery">${extra.map(r => html`<${Crop} r=${r} orig=${orig} onShowPage=${() => setShowImg(true)} />`)}</div></section>`}
          </article>`}`}
  <//>`;
}
