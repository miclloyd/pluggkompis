// Uppläsning med enhetens egen röst (speechSynthesis). Ingen server och ingen AI:
// planen 1.6 (diktering och uppläsning på enheten; ingen egen TTS-tjänst).
import { html, useState, useEffect, useRef } from './lib.js';

const VOICE_LANG = { sv: 'sv-SE', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', fi: 'fi-FI', no: 'nb-NO', da: 'da-DK' };

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

// iPhone: cancel() direkt före speak() kan få Safari att hoppa över uppläsningen, så den körs
// bara när något redan läses. Startar rösten inte inom 2,5 s kallas onSilent (ljudlöst läge
// på iPhone tystar webbläsarens röst; då händer inget alls för barnet).
export function speak(text, lang = 'sv', rate = 0.9, { onStart, onEnd, onSilent } = {}) {
  if (!canSpeak() || !text) return null;
  const tag = VOICE_LANG[lang] || lang || 'sv-SE';
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  const u = new window.SpeechSynthesisUtterance(String(text));
  u.lang = tag;
  u.rate = rate;
  const voices = synth.getVoices();
  const voice = voices.find(v => v.lang === tag) || voices.find(v => v.lang?.startsWith(tag.slice(0, 2)));
  if (voice) u.voice = voice;
  let started = false;
  const watch = setTimeout(() => { if (!started) { onSilent?.(); onEnd?.(); } }, 2500);
  u.onstart = () => { started = true; onStart?.(); };
  u.onend = () => { clearTimeout(watch); onEnd?.(); };
  // Ett fel innan rösten startat (ingen röst, tystad) ger samma tips; avbrutet av barnet gör det inte.
  u.onerror = e => {
    clearTimeout(watch);
    if (!started && e?.error !== 'interrupted' && e?.error !== 'canceled') onSilent?.();
    onEnd?.();
  };
  // Förhindrar att Safari släpper uppläsningen innan den spelats (u sparas tills den är klar).
  speak.current = u;
  if (synth.paused) synth.resume();
  synth.speak(u);
  return u;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

// "sv-en" → ['sv', 'en']: glosan (term) på första språket, översättningen på andra.
// Okänt språk ger null (då blir det ingen diktamen: fel röst lär ut fel uttal).
export function glosaLangs(goal) {
  const [a, b] = String(goal?.langs || '').toLowerCase().split(/[-_/ ]+/);
  return [VOICE_LANG[a] ? a : null, VOICE_LANG[b] ? b : null];
}

// Ett ord eller en kort fras som går att skriva efter gehör; inte "a dog / the dog" eller "(adj.)".
const dictable = w => typeof w === 'string' && w.trim() && !/[()/,;]/.test(w) && w.trim().split(/\s+/).length <= 3;

// Diktamen (materialprofil glosor): barnet hör ordet och skriver det. Frågan skapas
// här ur målet, inte av AI, och bara när enheten kan läsa upp.
export function withDictation(goals, banks) {
  if (!canSpeak()) return banks;
  const out = { ...banks };
  for (const g of goals) {
    if (g.type !== 'glosa' || g.removed || !dictable(g.translation)) continue;
    const [, lang] = glosaLangs(g);
    // Bara där banken redan har nivå 3: diktamen ska inte höja nivåtaket i övningen
    // (föräldrarnas omräkning använder den sparade banken).
    if (!lang || !(out[g.id] || []).some(i => i.level === 3) || out[g.id].some(i => i.kind === 'dictation')) continue;
    out[g.id] = [...out[g.id], {
      id: `dikt-${g.id}`, goalId: g.id, level: 3, kind: 'dictation', q: 'Lyssna och skriv ordet du hör',
      answer: g.translation, accept: [], lang, explain: `${g.translation} betyder ${g.term}.`, src: null,
    }];
  }
  return out;
}

export function SpeakButton({ text, lang = 'sv', label = 'Läs upp' }) {
  const [state, setState] = useState('idle'); // idle | speaking | silent
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => { setState('idle'); }, [text]);
  if (!canSpeak()) return null;
  const set = v => live.current && setState(v);
  function press() {
    if (state === 'speaking') { stopSpeaking(); set('idle'); return; }
    set('speaking');
    speak(text, lang, 0.9, { onStart: () => set('speaking'), onEnd: () => setState(s => (s === 'silent' ? s : 'idle')), onSilent: () => set('silent') });
  }
  return html`<span class="speak-wrap"><button type="button" class=${'btn ghost small speak' + (state === 'speaking' ? ' on' : '')} onClick=${press}
      aria-label=${state === 'speaking' ? 'Sluta läsa upp' : label} aria-pressed=${state === 'speaking'}>${state === 'speaking' ? '⏹ Läser upp…' : `🔊 ${label}`}</button>
    ${state === 'silent' && html`<span class="small muted speak-hint" role="status">Hör du inget? Stäng av ljudlöst läge och höj volymen.</span>`}</span>`;
}

// Det som läses upp för en fråga: frågan, och vid flerval alternativen.
export function readAloudText(item) {
  const q = String(item.q || '').replace(/___/g, 'lucka');
  if (item.kind === 'mcq') return `${q} ${item.options.map((o, i) => `${'ABCDE'[i]}: ${o}.`).join(' ')}`;
  return q;
}
