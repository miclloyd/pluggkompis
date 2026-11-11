// "Förklara mer": ett kort samtal med Claude efter ett svar, förankrat i barnets material.
//
// Modellval: snabb modell (quick) för förklaringar och följdfrågor, eftersom svaret ska bygga på
// texten som skickas med. "Förklara på ett annat sätt" använder noggrann modell (default), för
// när den första förklaringen inte räckte. Högst MAX_TURNS egna frågor per övningsfråga.
import { html, useState, useEffect, useRef } from './lib.js';
import { Sheet } from './sheet.js';
import { explainContext } from './prompts.js';
import { Kompis, KOMPIS_DEFAULT } from './buddy.js';

export const MAX_TURNS = 5;
const CHIPS = [
  { label: 'Förklara enklare', text: 'Kan du förklara det enklare?', tier: 'quick' },
  { label: 'Ge ett exempel', text: 'Kan du ge ett exempel?', tier: 'quick' },
  { label: 'Varför är det så?', text: 'Varför är det så?', tier: 'quick' },
  { label: 'Förklara på ett annat sätt', text: 'Jag förstår inte riktigt. Kan du förklara på ett helt annat sätt?', tier: 'default' },
];

export function ExplainSheet({ ai, test, item, answerText, verdict, material, onClose, onSave, look = KOMPIS_DEFAULT }) {
  const [msgs, setMsgs] = useState([]); // { role: 'user'|'assistant', content, shown? }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState('');
  const end = useRef();
  const k = useRef(null); // Plumpen pratar medan svaret strömmar in
  const page = material?.pages.find(p => p.p === item.src?.p);
  const context = explainContext({ test, item, answerText, verdict, pageText: page?.text || '', materialName: material?.name || 'förälderns anteckning', page: item.src?.p });
  const asked = msgs.filter(m => m.role === 'user' && m.shown).length;

  async function ask(text, tier = 'quick', first = false) {
    if (busy || !ai) return;
    setErr('');
    const userMsg = { role: 'user', content: first ? `${context}\n\nBörja med att förklara rätt svar och varför det är rätt.` : text, shown: first ? null : text };
    const history = [...msgs, userMsg];
    setMsgs([...history, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    k.current?.mood('tanker');
    let heard = 0;
    try {
      // Första turen bär sammanhanget, så det följer med i varje anrop.
      const turns = history.map(m => ({ role: m.role, content: m.content }));
      const r = await ai.complete({ prompt: turns, tier, onText: ({ text: t }) => {
        if (t.length > heard) { if (!heard) k.current?.mood('forklarar'); k.current?.feed(t.slice(heard)); heard = t.length; }
        setMsgs([...history, { role: 'assistant', content: t, pending: true }]);
      } });
      if (!heard) { k.current?.mood('forklarar'); k.current?.feed(r.text); }
      k.current?.endSpeech();
      const done = [...history, { role: 'assistant', content: r.text, tier }];
      setMsgs(done);
      onSave?.(done.filter(m => m.shown !== null || m.role === 'assistant').map(m => ({ role: m.role, text: m.role === 'user' ? m.shown : m.content, tier: m.tier || null })));
    } catch (e) {
      setMsgs(msgs);
      k.current?.endSpeech();
      k.current?.mood('vilar');
      setErr((e && e.message) || 'Förklaringen gick inte att hämta.');
    }
    setBusy(false);
  }

  useEffect(() => { if (ai) ask('', 'quick', true); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs.length, busy]);

  const shown = msgs.filter(m => m.role === 'assistant' || m.shown);
  return html`<${Sheet} title="Förklara mer" onClose=${onClose}>
    ${!ai && html`<p class="notice warn">Förklaringar kräver Claude, som inte är tillgängligt här.</p>`}
    <div class="chat-kompis">
      <${Kompis} look=${look} onReady=${x => { k.current = x; }} />
      <p class="small muted chat-q">${item.q}</p>
    </div>
    <div class="chat" aria-live="polite">
      ${shown.map(m => html`<div class=${'bubble ' + (m.role === 'user' ? 'me' : 'ai')}>
        ${m.role === 'assistant' && !m.content ? html`<span class="typing" aria-label="Skriver"><i></i><i></i><i></i></span>` : (m.role === 'user' ? m.shown : m.content)}
      </div>`)}
      <span ref=${end}></span>
    </div>
    ${err && html`<p class="notice bad">${err}</p>`}
    ${ai && asked < MAX_TURNS && html`
      <div class="chips">${CHIPS.map(c => html`<button class="chip-btn" disabled=${busy} onClick=${() => ask(c.text, c.tier)}>${c.label}</button>`)}</div>
      <form class="chat-form" onSubmit=${e => { e.preventDefault(); if (draft.trim()) { ask(draft.trim()); setDraft(''); } }}>
        <label class="sr" for="chat-in">Din fråga</label>
        <input id="chat-in" value=${draft} disabled=${busy} onInput=${e => setDraft(e.target.value)} placeholder="Fråga något om det här" autocomplete="off" />
        <button class="btn primary" disabled=${busy || !draft.trim()}>Fråga</button>
      </form>`}
    ${asked >= MAX_TURNS && html`<p class="small muted">Nu har du frågat ${MAX_TURNS} gånger om den här frågan. Fråga gärna en vuxen om du vill veta mer.</p>`}
  <//>`;
}
