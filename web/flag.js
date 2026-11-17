// "Något är fel": barnet flaggar en rättning eller en fråga. Föräldern får en notis (servern,
// notify.go) och ser flaggan under Flaggat i föräldraläget. En flaggad fråga kommer inte
// tillbaka förrän föräldern har tittat (engine.js blockedItems).
import { html, useState } from './lib.js';
import { Sheet } from './sheet.js';

//   canGrade: svaret var inte helt rätt, så "rättningen är fel" går att välja
//   onSend({ kind, comment }) sparar flaggan; kind = 'grading' | 'question'
export function FlagSheet({ canGrade, onSend, onClose }) {
  const [kind, setKind] = useState(canGrade ? 'grading' : 'question');
  const [comment, setComment] = useState('');
  const [state, setState] = useState(null); // null | 'sending' | 'sent' | felmeddelande
  async function send(e) {
    e.preventDefault();
    setState('sending');
    try { await onSend({ kind, comment: comment.trim().slice(0, 500) }); setState('sent'); }
    catch { setState('Det gick inte att skicka. Försök igen.'); }
  }
  return html`<${Sheet} title="Något är fel" onClose=${onClose}>
    ${state === 'sent'
      ? html`<p>Tack! Bra att du säger till. En vuxen tittar på det.</p>
        ${kind === 'question' && html`<p class="small muted">Frågan kommer inte tillbaka förrän någon har tittat på den.</p>`}
        <div class="actions"><button class="btn primary" onClick=${onClose}>Okej</button></div>`
      : html`<form onSubmit=${send}>
        <fieldset class="flag-kind">
          ${canGrade && html`<label><input type="radio" name="fk" checked=${kind === 'grading'} onChange=${() => setKind('grading')} /> Jag tycker att rättningen är fel</label>`}
          <label><input type="radio" name="fk" checked=${kind === 'question'} onChange=${() => setKind('question')} /> Frågan är konstig eller fel</label>
        </fieldset>
        <label for="flag-c">Vill du berätta mer? (frivilligt)</label>
        <textarea id="flag-c" rows="3" maxlength="500" value=${comment} onInput=${e => setComment(e.target.value)}
          placeholder=${kind === 'grading' ? 'Till exempel: jag skrev samma sak med andra ord.' : 'Till exempel: frågan går att förstå på två sätt.'}></textarea>
        ${state && state !== 'sending' && html`<p class="notice bad">${state}</p>`}
        <div class="actions"><button type="button" class="btn ghost" onClick=${onClose}>Avbryt</button>
          <button class="btn primary" disabled=${state === 'sending'}>Skicka</button></div>
      </form>`}
  <//>`;
}
