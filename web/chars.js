// Specialtecken för glosor. Användaren skriver på ett svenskt tangentbord, så bara tecken
// som saknas där visas: å, ä och ö finns redan. Tecknen beror på språket, aldrig på facit,
// så raden avslöjar inte vilka tecken svaret har.
import { html, useState } from './lib.js';

export const SPECIAL = {
  es: ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'],
  fr: ['à', 'â', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ'],
  de: ['ü', 'ß'],
  it: ['à', 'è', 'é', 'ì', 'ò', 'ù'],
  pt: ['á', 'â', 'ã', 'à', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú'],
  no: ['æ', 'ø'],
  da: ['æ', 'ø'],
  is: ['á', 'ð', 'é', 'í', 'ó', 'ú', 'ý', 'þ', 'æ'],
  pl: ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'],
};

// Språket kan stå som kod (sv-es, es-ES) eller namn (svenska-spanska).
const NAMES = { svenska: 'sv', spanska: 'es', franska: 'fr', tyska: 'de', italienska: 'it', portugisiska: 'pt',
  norska: 'no', danska: 'da', isländska: 'is', polska: 'pl', engelska: 'en', finska: 'fi' };
const code = w => NAMES[w] || w.slice(0, 2);

// "sv-es" → tecknen för de språk i paret som inte är svenska.
export function charsForLangs(langs) {
  const codes = String(langs || '').toLowerCase().split(/[-_/ ,]+/).filter(Boolean).map(code).filter(c => c !== 'sv');
  return [...new Set(codes.flatMap(c => SPECIAL[c] || []))];
}

// Infogar ch i value där markeringen [s, e) står. Returnerar nytt värde och markörens plats.
export function insertAt(value, s, e, ch) {
  const v = String(value ?? '');
  const a = Math.max(0, Math.min(s ?? v.length, v.length)), b = Math.max(a, Math.min(e ?? a, v.length));
  return { value: v.slice(0, a) + ch + v.slice(b), caret: a + ch.length };
}

// Versal om det finns en enkel versal (ß har ingen: står kvar).
export const upperOf = c => (c.toUpperCase().length === 1 ? c.toUpperCase() : c);

// Frågorna i glosmål får sitt språks tecken (övning och provläge laddar banken så här).
export function withChars(goals, banks) {
  const out = { ...banks };
  for (const g of goals) {
    if (g.type !== 'glosa' || !out[g.id]) continue;
    const chars = charsForLangs(g.langs);
    if (chars.length) out[g.id] = out[g.id].map(i => ({ ...i, chars }));
  }
  return out;
}

// Infogar tecknet där markören står och behåller fokus (pekskärmen fäller inte ned tangentbordet).
export function CharBar({ chars, inputRef, value, onChange }) {
  const [upper, setUpper] = useState(false);
  if (!chars?.length) return null;
  const put = c => {
    const el = inputRef.current;
    const r = insertAt(value, el?.selectionStart, el?.selectionEnd, upper ? upperOf(c) : c);
    onChange(r.value);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.caret, r.caret); });
  };
  const keep = e => e.preventDefault(); // tryck tar inte fokus från svarsfältet
  return html`<div class="char-bar" role="group" aria-label="Specialtecken">
    ${chars.map(c => html`<button type="button" class="char" onPointerDown=${keep} onMouseDown=${keep} onClick=${() => put(c)}>${upper ? upperOf(c) : c}</button>`)}
    <button type="button" class=${'char shift' + (upper ? ' on' : '')} aria-pressed=${upper} aria-label="Versaler" onPointerDown=${keep} onMouseDown=${keep} onClick=${() => setUpper(!upper)}>⇧</button>
  </div>`;
}
