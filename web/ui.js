// Små visuella byggstenar: ämnesomslag, ring, stämpel och svarsrad.
import { html } from './lib.js';

// Varje ämne får ett eget häftesomslag, som skrivböckerna i skolan.
const COVER_BY_SUBJECT = [
  [/relig|so\b|histor/i, 4],
  [/kemi|fysik|biolog|\bno\b|teknik|natur/i, 2],
  [/engelsk|spansk|tysk|fransk|språk|glos/i, 3],
  [/matem|matte/i, 1],
  [/svensk/i, 5],
  [/geograf|samhäll/i, 6],
];
export function coverOf(subject = '') {
  for (const [re, n] of COVER_BY_SUBJECT) if (re.test(subject)) return n;
  let h = 0;
  for (const c of subject) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
}
export const coverVar = subject => `--cover: var(--cover-${coverOf(subject)})`;

// Ring som visar en andel, med text i mitten.
export function Ring({ value, size = 96, stroke = 10, label, sub }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return html`<div class="ring" style=${`width:${size}px;height:${size}px`}>
    <svg viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size} aria-hidden="true">
      <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--rule)" stroke-width=${stroke} />
      ${v > 0 && html`<circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${v >= 1 ? 'var(--good)' : 'var(--pen)'} stroke-width=${stroke}
        stroke-linecap="round" stroke-dasharray=${`${c * v} ${c}`} transform=${`rotate(-90 ${size / 2} ${size / 2})`} />`}
    </svg>
    <span class="ring-label">${label}${sub && html`<small>${sub}</small>`}</span>
  </div>`;
}

// Lärarstämpel vid nivå upp eller klart mål.
export function Stamp({ children }) {
  return html`<div class="stamp" role="status"><span>${children}</span></div>`;
}

// En ruta per fråga i omgången, färgad efter hur det gick.
export function AnswerTrail({ log, total, current }) {
  return html`<ol class="trail" aria-label=${`Fråga ${Math.min(log.length + (current ? 1 : 0), total)} av ${total}`}>
    ${Array.from({ length: total }, (_, i) => {
      const l = log[i];
      const cls = l ? (l.score >= 1 ? 'right' : l.score > 0 ? 'almost' : 'wrong') : i === log.length && current ? 'now' : '';
      return html`<li class=${cls}></li>`;
    })}
  </ol>`;
}

// Enkla linjeikoner i textens färg.
const icon = d => html`<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const IconBook = () => icon(html`<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />`);
export const IconChat = () => icon(html`<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><path d="M8.5 9.5h7M8.5 12.5h4.5" />`);
export const IconMic = () => icon(html`<rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20.5" />`);
