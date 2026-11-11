// Uppläsning med enhetens egen röst (speechSynthesis). Ingen server och ingen AI:
// planen 1.6 (diktering och uppläsning på enheten; ingen egen TTS-tjänst).
import { html } from './lib.js';

const VOICE_LANG = { sv: 'sv-SE', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', fi: 'fi-FI', no: 'nb-NO', da: 'da-DK' };

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

export function speak(text, lang = 'sv', rate = 0.9) {
  if (!canSpeak() || !text) return;
  const tag = VOICE_LANG[lang] || lang;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new window.SpeechSynthesisUtterance(String(text));
  u.lang = tag;
  u.rate = rate;
  const voice = synth.getVoices().find(v => v.lang === tag) || synth.getVoices().find(v => v.lang?.startsWith(tag.slice(0, 2)));
  if (voice) u.voice = voice;
  synth.speak(u);
}

// "sv-en" → ['sv', 'en']: glosan (term) på första språket, översättningen på andra.
export function glosaLangs(goal) {
  const [a, b] = String(goal?.langs || '').toLowerCase().split(/[-_/ ]+/);
  return [a || 'sv', b || 'en'];
}

// Diktamen (materialprofil glosor): barnet hör ordet och skriver det. Frågan skapas
// här ur målet, inte av AI, och bara när enheten kan läsa upp.
export function withDictation(goals, banks) {
  if (!canSpeak()) return banks;
  const out = { ...banks };
  for (const g of goals) {
    if (g.type !== 'glosa' || g.removed || !g.translation || !out[g.id]?.length) continue;
    const [, lang] = glosaLangs(g);
    if (out[g.id].some(i => i.kind === 'dictation')) continue;
    out[g.id] = [...out[g.id], {
      id: `dikt-${g.id}`, goalId: g.id, level: 3, kind: 'dictation', q: 'Lyssna och skriv ordet du hör',
      answer: g.translation, accept: [], lang, explain: `${g.translation} betyder ${g.term}.`, src: null,
    }];
  }
  return out;
}

export function SpeakButton({ text, lang = 'sv', label = 'Läs upp' }) {
  if (!canSpeak()) return null;
  return html`<button type="button" class="btn ghost small speak" onClick=${() => speak(text, lang)} aria-label=${label}>🔊 ${label}</button>`;
}

// Det som läses upp för en fråga: frågan, och vid flerval alternativen.
export function readAloudText(item) {
  const q = String(item.q || '').replace(/___/g, 'lucka');
  if (item.kind === 'mcq') return `${q} ${item.options.map((o, i) => `${'ABCDE'[i]}: ${o}.`).join(' ')}`;
  return q;
}
