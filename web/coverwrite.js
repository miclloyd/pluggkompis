// "Titta, täck, skriv, kontrollera": efter ett stavfel tittar barnet på det rätta ordet, ordet
// döljs, barnet skriver det ur minnet och kontrollerar. Barnets felstavning visas aldrig igen,
// eftersom den annars kan fastna. Övningen påverkar inte nivån.
import { CharBar } from './chars.js';
import { html, useState, useEffect, useRef } from './lib.js';
import { normalize } from './engine.js';

const MAX_ROUNDS = 3;

// Gäller skrivna svar: glosor alltid när svaret inte var rätt, andra ämnen när felet var stavningen.
export function needsCoverWrite(item, goal, result) {
  if (!['cloze', 'write', 'dictation'].includes(item.kind) || !result || result.verdict === 'right') return false;
  if (goal.type === 'glosa') return true;
  return result.verdict === 'almost' && /stavning|accent|prickar/i.test(result.note || '');
}

export function CoverWrite({ word, chars, onDone }) {
  const [phase, setPhase] = useState('look'); // look | write | again | done
  const [round, setRound] = useState(1);
  const [ok, setOk] = useState(false);
  const [v, setV] = useState('');
  const btn = useRef();
  const input = useRef();
  useEffect(() => {
    if (phase === 'write') input.current?.focus();
    else btn.current?.focus();
  }, [phase]);

  function check(e) {
    e.preventDefault();
    if (!v.trim()) return;
    const ok = normalize(v) === normalize(word);
    setV('');
    if (ok) { setOk(true); setPhase('done'); onDone({ ok: true, rounds: round }); }
    else if (round >= MAX_ROUNDS) { setPhase('done'); onDone({ ok: false, rounds: round }); }
    else { setRound(r => r + 1); setPhase('again'); }
  }

  const steps = ['Titta', 'Täck', 'Skriv', 'Kontrollera'];
  const active = { look: 0, again: 0, write: 2, done: 3 }[phase];
  return html`<section class="cw" aria-live="polite">
    <ol class="cw-steps">${steps.map((s, i) => html`<li class=${i < active ? 'past' : i === active || (phase === 'write' && i === 1) ? 'now' : ''}>${s}</li>`)}</ol>
    ${(phase === 'look' || phase === 'again') && html`
      <p class="cw-lead">${phase === 'again' ? 'Nästan! Titta en gång till, bokstav för bokstav.' : 'Titta noga på ordet och säg det tyst för dig själv.'}</p>
      <p class="cw-word" lang="und">${word}</p>
      <button ref=${btn} class="btn primary" onClick=${() => setPhase('write')}>Täck över och skriv</button>`}
    ${phase === 'write' && html`
      <p class="cw-lead">Skriv ordet ur minnet.</p>
      <div class="cw-word cw-covered" aria-hidden="true">${word.replace(/\S/g, '•')}</div>
      <form class="cw-form" onSubmit=${check}>
        <label class="sr" for="cw-in">Skriv ordet</label>
        <input id="cw-in" ref=${input} class="answer" value=${v} onInput=${e => setV(e.target.value)}
          autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Skriv ordet" />
        <${CharBar} chars=${chars} inputRef=${input} value=${v} onChange=${setV} />
        <button class="btn primary" disabled=${!v.trim()}>Kontrollera</button>
      </form>`}
    ${phase === 'done' && html`
      <p class="cw-word cw-ok">${word}</p>
      <p class="cw-lead">${!ok ? 'Bra kämpat. Ordet kommer tillbaka snart så att du får öva på det igen.' : round === 1 ? 'Rätt stavat! Nu sitter ordbilden bättre.' : 'Där satt det!'}</p>`}
  </section>`;
}
