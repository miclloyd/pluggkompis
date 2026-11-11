// Ljust, mörkt eller som enheten. Valet sparas per barn i profilen, och senaste valet på den
// här enheten används på start- och föräldrasidorna. "Som enheten" lämnar tillbaka det läge
// sidan hade när den öppnades (claude.ai kan själv ha satt ett läge).
import { html } from './lib.js';

const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme');
export const THEMES = ['auto', 'light', 'dark'];
export const THEME_LABEL = { auto: 'Som enheten', light: 'Ljust', dark: 'Mörkt' };

export function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else if (hostTheme) root.setAttribute('data-theme', hostTheme);
  else root.removeAttribute('data-theme');
}

export const nextTheme = mode => THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];

export function ThemeButton({ mode, onChange }) {
  const next = nextTheme(mode);
  return html`<button class="theme-btn" onClick=${() => onChange(next)}
    aria-label=${`Utseende: ${THEME_LABEL[mode].toLowerCase()}. Tryck för ${THEME_LABEL[next].toLowerCase()}.`} title=${THEME_LABEL[mode]}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${mode === 'dark' && html`<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />`}
      ${mode === 'light' && html`<circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />`}
      ${mode === 'auto' && html`<rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" />`}
    </svg>
    <span class="theme-label">${THEME_LABEL[mode]}</span>
  </button>`;
}

// Tre knappar sida vid sida, för profilinställningar.
export function ThemePicker({ mode, onChange }) {
  return html`<div class="theme-picker" role="radiogroup" aria-label="Utseende">
    ${THEMES.map(t => html`<button role="radio" aria-checked=${t === mode} class=${'theme-opt ' + t + (t === mode ? ' on' : '')} onClick=${() => onChange(t)}>
      <span class="theme-swatch" aria-hidden="true"></span>${THEME_LABEL[t]}</button>`)}
  </div>`;
}
