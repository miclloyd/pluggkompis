// "Skapa din kompis": barnet väljer färg, något extra och namn på sin figur, och utseendet på appen.
import { html, useState, useEffect, useRef } from './lib.js';
import { Kompis, KOMPIS_DEFAULT } from './buddy.js';
import { ThemePicker, applyTheme } from './theme.js';

export const KOMPIS_COLORS = [
  ['#2f4fb8', 'Blå'], ['#0d7466', 'Blågrön'], ['#b23a47', 'Röd'], ['#6d45a6', 'Lila'], ['#b8710f', 'Ockra'], ['#33743a', 'Grön'],
];
const ACCESSORIES = [['inget', 'Inget'], ['glasogon', 'Glasögon'], ['mossa', 'Mössa'], ['rosett', 'Rosett']];
const SUGGESTIONS = ['Plumpen', 'Bläcky', 'Droppen', 'Plumpis'];

export function KompisStudio({ env, go, profileId, onTheme }) {
  const [profile, setProfile] = useState(null);
  const [look, setLook] = useState(KOMPIS_DEFAULT);
  const [theme, setTheme] = useState('auto');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const k = useRef(null);

  useEffect(() => {
    env.repo.listProfiles().then(ps => {
      const p = ps.find(x => x.id === profileId);
      setProfile(p || null);
      if (p?.kompis) setLook({ ...KOMPIS_DEFAULT, ...p.kompis });
      if (p?.theme) setTheme(p.theme);
    });
  }, [profileId]);

  function change(patch) {
    setSaved(false);
    setLook(l => {
      const n = { ...l, ...patch };
      if (patch.color) k.current?.setColor(n.color);
      if (patch.accessory) k.current?.setAccessory(n.accessory);
      if (patch.color || patch.accessory) k.current?.react('peta');
      return n;
    });
  }

  async function done() {
    const name = (look.name || '').trim() || KOMPIS_DEFAULT.name;
    const kompis = { color: look.color, accessory: look.accessory, name };
    try {
      await env.repo.saveProfile({ ...profile, kompis, theme });
      setProfile(p => ({ ...p, kompis, theme }));
      setLook(l => ({ ...l, name }));
      setSaved(true);
      setErr('');
      k.current?.react('nivaupp');
      k.current?.speak(`Hej ${profile.name}! Jag heter ${name}.`);
    } catch { setErr('Det gick inte att spara. Kontrollera anslutningen och försök igen.'); }
  }

  if (!profile) return html`<p class="muted">Laddar…</p>`;
  return html`<div class="studio">
    <section class="studio-stage">
      <div class="studio-fig"><${Kompis} look=${look} onReady=${x => { k.current = x; }} /></div>
      <button class="studio-name" onClick=${() => k.current?.react('peta')}>${(look.name || '').trim() || KOMPIS_DEFAULT.name}</button>
    </section>
    <section class="studio-controls">
      <h1>Din pluggkompis</h1>
      <div class="field">
        <span class="field-label">Färg</span>
        <div class="swatches">${KOMPIS_COLORS.map(([c, n]) => html`<button class=${'swatch' + (c === look.color ? ' on' : '')} style=${`--sw:${c}`}
          aria-pressed=${c === look.color} aria-label=${n} onClick=${() => change({ color: c })}></button>`)}</div>
      </div>
      <div class="field">
        <span class="field-label">Något extra</span>
        <div class="chips">${ACCESSORIES.map(([id, label]) => html`<button class=${'chip-btn' + (id === look.accessory ? ' on' : '')}
          aria-pressed=${id === look.accessory} onClick=${() => change({ accessory: id })}>${label}</button>`)}</div>
      </div>
      <div class="field">
        <label class="field-label" for="kname">Vad heter din kompis?</label>
        <div class="name-row">
          <input id="kname" class="answer" maxlength="14" value=${look.name} placeholder=${KOMPIS_DEFAULT.name}
            onInput=${e => { setSaved(false); setLook(l => ({ ...l, name: e.target.value })); }} />
        </div>
        <div class="chips">${SUGGESTIONS.map(n => html`<button class="chip-btn dashed" onClick=${() => { setSaved(false); setLook(l => ({ ...l, name: n })); }}>${n}</button>`)}</div>
      </div>
      <div class="field">
        <span class="field-label">Utseende på appen</span>
        <${ThemePicker} mode=${theme} onChange=${t => { setTheme(t); setSaved(false); applyTheme(t); onTheme?.(t); }} />
      </div>
      ${err && html`<p class="notice bad">${err}</p>`}
      <div class="actions">
        <button class="btn ghost" onClick=${() => { if (!saved) { applyTheme(profile.theme || 'auto'); onTheme?.(profile.theme || 'auto'); } go({ name: 'child', profileId }); }}>${saved ? 'Tillbaka' : 'Avbryt'}</button>
        <button class="btn primary" onClick=${done}>${saved ? 'Sparat!' : 'Klar'}</button>
      </div>
    </section>
  </div>`;
}
