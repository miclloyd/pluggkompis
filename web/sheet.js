// Sidopanel (nerifrån på mobil). Stänger på Escape och tryck utanför, och lämnar tillbaka fokus.
import { html, useEffect, useRef } from './lib.js';

export function Sheet({ title, onClose, children, wide }) {
  const panel = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    panel.current?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.();
    };
  }, []);
  return html`<div class="sheet-backdrop" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <section class=${'sheet-panel' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${panel}>
      <header class="sheet-head">
        <h2>${title}</h2>
        <button class="btn ghost small" onClick=${onClose}>Stäng</button>
      </header>
      <div class="sheet-body">${children}</div>
    </section>
  </div>`;
}
