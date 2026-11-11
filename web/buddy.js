// Plumpen i appen: en Preact-komponent runt createKompis och dockan i övningsläget.
import { html, useEffect, useRef, useState } from './lib.js';
import { createKompis } from './kompis.js';

export const KOMPIS_DEFAULT = { color: '#2f4fb8', accessory: 'inget', name: 'Plumpen' };

// Ritar figuren i en div och lämnar ut styrobjektet via onReady.
export function Kompis({ look = KOMPIS_DEFAULT, onReady, class: cls = '' }) {
  const host = useRef();
  useEffect(() => {
    const k = createKompis(host.current, look);
    onReady?.(k);
    return () => { onReady?.(null); k.destroy(); };
  }, []);
  return html`<div class=${'kompis-host ' + cls} ref=${host} aria-hidden="true"></div>`;
}

// Dockan nere i hörnet. Barnet trycker på figuren för att få hjälp; figuren kan också själv
// erbjuda något (say), till exempel en förklaring efter ett fel eller en paus efter 20 minuter.
//   say: { text, actions: [{ label, onClick, primary }] } | null
//   menu: [{ label, onClick }] – visas när barnet trycker
export function KompisDock({ look = KOMPIS_DEFAULT, kRef, say, menu = [], onDismiss }) {
  const [open, setOpen] = useState(false);
  const dock = useRef();
  // Dockans höjd styr hur mycket luft sidan lämnar längst ner, så att pratbubblan aldrig
  // täcker knappen barnet ska trycka på. Den fokuserade knappen flyttas upp när bubblan växer.
  useEffect(() => {
    const root = document.documentElement;
    const set = () => {
      root.style.setProperty('--dock-h', `${Math.ceil(dock.current?.offsetHeight || 0)}px`);
      const f = document.activeElement;
      if (f && f !== document.body && !dock.current?.contains(f)) f.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    const ro = 'ResizeObserver' in window ? new ResizeObserver(set) : null;
    ro?.observe(dock.current); set();
    return () => { ro?.disconnect(); root.style.removeProperty('--dock-h'); };
  }, []);
  const bubble = say || (open && menu.length ? { text: 'Vad vill du ha hjälp med?', actions: menu } : null);
  useEffect(() => { if (say) setOpen(false); }, [say]);

  function tap() {
    kRef.current?.react('peta');
    if (say) { onDismiss?.(); return; }
    setOpen(o => !o);
  }
  const run = a => () => { setOpen(false); a.onClick(); };

  return html`<div class="kompis-dock" ref=${dock}>
    ${bubble && html`<div class="kompis-bubble" role="status">
      <p>${bubble.text}</p>
      ${bubble.actions?.length > 0 && html`<div class="kompis-actions">${bubble.actions.map(a =>
        html`<button class=${'btn small ' + (a.primary ? 'primary' : 'ghost')} onClick=${run(a)}>${a.label}</button>`)}</div>`}
    </div>`}
    <button class="kompis-btn" onClick=${tap} aria-expanded=${!!bubble}
      aria-label=${`${look.name}, din pluggkompis. Tryck för hjälp.`}>
      <${Kompis} look=${look} onReady=${k => { kRef.current = k; }} />
    </button>
  </div>`;
}
