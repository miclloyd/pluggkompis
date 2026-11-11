// Plumpen: Pluggkompis figur. En riggad SVG-figur som drivs av fjädrar, helt utan bibliotek.
//
//   const k = createKompis(element, { color, accessory, name })
//   k.mood('vilar' | 'tanker' | 'forklarar' | 'glad' | 'peppar' | 'sover')
//   k.react('ratt' | 'fel' | 'nivaupp' | 'peta')
//   await k.speak(text)              hela texten på en gång
//   k.feed(delta); k.endSpeech()     text som strömmar in från Claude
//   k.lookAt(element | {x, y} | null)
//   k.setColor('#2f4fb8'); k.setAccessory('inget' | 'glasogon' | 'mossa' | 'rosett')
//   k.destroy()
//
// Allt rör sig via dämpade fjädrar mot mål, så att rörelser får förberedelse, överskjutning och
// efterslängande delar utan handskrivna nyckelbilder. Vid "minskad rörelse" visas lägena utan rörelse.

const SVGNS = 'http://www.w3.org/2000/svg';
const G = 205;            // marken
const CY = 147;           // kroppens mitt
const RX = 60, RY = 58;   // kroppens radier
const EYES = [80, 120], EYE_Y = 140, MOUTH_Y = 169, BROW_Y = 117;
const VOWELS = /[aeiouyåäöAEIOUYÅÄÖ]/;
let uidN = 0;

const spring = (x, k = 170, c = 18) => ({ x, v: 0, t: x, k, c });
function stepSpring(s, dt) {
  const a = s.k * (s.t - s.x) - s.c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Mål per läge. Allt annat (hopp, blinkningar, prat) läggs ovanpå.
const MOODS = {
  vilar:     { lid: 0.12, happy: 0,    smile: 0.55, width: 9,  open: 0,    brow: 0,    browTilt: 0,   armL: 12,  armR: -12, lean: 0,  cheek: 0.35, breath: 1 },
  tanker:    { lid: 0.18, happy: 0,    smile: -0.1, width: 5,  open: 0.05, brow: 3,    browTilt: -8,  armL: 16,  armR: -125, lean: -3, cheek: 0.25, breath: 0.8, look: { x: 0.65, y: -0.75 } },
  forklarar: { lid: 0.08, happy: 0.1,  smile: 0.6,  width: 10, open: 0,    brow: 2,    browTilt: 0,   armL: 30,  armR: -55, lean: 0,  cheek: 0.4,  breath: 1 },
  glad:      { lid: 0,    happy: 0.5,  smile: 1,    width: 13, open: 0.4,  brow: 3,    browTilt: 0,   armL: 165, armR: -165, lean: 0, cheek: 0.65, breath: 1 },
  peppar:    { lid: 0.1,  happy: 0.2,  smile: 0.7,  width: 10, open: 0.1,  brow: 1,    browTilt: 10,  armL: 20,  armR: -70, lean: 2,  cheek: 0.45, breath: 1 },
  sover:     { lid: 1,    happy: 0,    smile: 0.2,  width: 4,  open: 0.3,  brow: -2,   browTilt: 0,   armL: 10,  armR: -10, lean: 4,  cheek: 0.3,  breath: 2.2 },
};

export function createKompis(host, { color = '#2f4fb8', accessory = 'inget', name = 'Plumpen' } = {}) {
  const id = 'k' + (++uidN);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const label = String(name).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  host.innerHTML = `
<svg class="kompis" viewBox="0 -40 200 260" role="img" aria-label="${label}" xmlns="${SVGNS}">
  <defs>
    <clipPath id="${id}-e0"><ellipse cx="0" cy="0" rx="13" ry="15"/></clipPath>
    <clipPath id="${id}-e1"><ellipse cx="0" cy="0" rx="13" ry="15"/></clipPath>
  </defs>
  <ellipse data-r="shadow" cx="100" cy="${G + 2}" rx="46" ry="7" fill="currentColor" fill-opacity="0.13"/>
  <g data-r="particles"></g>
  <g data-r="rig">
    <g data-r="armL"><path data-r="armLp" d="M-7 -4 C-9 10 -6 24 2 26 C10 27 10 12 7 -4 Z"/></g>
    <g data-r="armR"><path data-r="armRp" d="M7 -4 C9 10 6 24 -2 26 C-10 27 -10 12 -7 -4 Z"/></g>
    <path data-r="body"/>
    <path data-r="shine" d="M64 140 Q66 114 88 104" fill="none" stroke="#fff" stroke-opacity="0.32" stroke-width="5" stroke-linecap="round"/>
    <ellipse data-r="cheekL" cx="64" cy="161" rx="9" ry="5" fill="#ffb3c4"/>
    <ellipse data-r="cheekR" cx="136" cy="161" rx="9" ry="5" fill="#ffb3c4"/>
    ${EYES.map((x, i) => `
    <g data-r="eye${i}" transform="translate(${x} ${EYE_Y})">
      <g clip-path="url(#${id}-e${i})">
        <ellipse cx="0" cy="0" rx="13" ry="15" fill="#fffdf6"/>
        <g data-r="pupil${i}"><circle r="6.8" fill="#0b1230"/><circle cx="2.3" cy="-2.6" r="2.2" fill="#fff"/></g>
        <ellipse data-r="lidT${i}" cx="0" cy="-48" rx="19" ry="18"/>
        <ellipse data-r="lidB${i}" cx="0" cy="48" rx="20" ry="16"/>
      </g>
    </g>
    <path data-r="brow${i}" d="M-9 1 Q0 -4 9 1" fill="none" stroke="#0b1230" stroke-width="3.4" stroke-linecap="round"/>`).join('')}
    <path data-r="mouth" fill="#0b1230"/>
    <ellipse data-r="tongue" cx="100" cy="${MOUTH_Y + 7}" rx="6" ry="3.5" fill="#ff8fa3"/>
    <g data-r="glasses" fill="#fff" fill-opacity="0.14" stroke="#1a2132" stroke-width="3">
      <circle cx="${EYES[0]}" cy="${EYE_Y}" r="18"/><circle cx="${EYES[1]}" cy="${EYE_Y}" r="18"/>
      <path d="M${EYES[0] + 18} ${EYE_Y - 2} Q100 ${EYE_Y - 8} ${EYES[1] - 18} ${EYE_Y - 2}" fill="none"/>
    </g>
    <g data-r="hat">
      <path d="M58 92 Q100 30 142 92 Z" fill="#e4a64f"/>
      <rect x="55" y="84" width="90" height="13" rx="6.5" fill="#b8710f"/>
      <circle data-r="pom" cx="100" cy="44" r="10" fill="#fffdf6"/>
    </g>
    <g data-r="bow">
      <path d="M100 66 L82 54 L84 78 Z M100 66 L118 54 L116 78 Z" fill="#d65450"/>
      <circle cx="100" cy="66" r="5" fill="#a83c3a"/>
    </g>
  </g>
  <g data-r="dots" fill="currentColor" fill-opacity="0.55">
    <circle cx="150" cy="58" r="4"/><circle cx="163" cy="44" r="5"/><circle cx="178" cy="28" r="6"/>
  </g>
</svg>`;
  const svg = host.querySelector('svg');
  const $ = r => svg.querySelector(`[data-r="${r}"]`);
  const el = Object.fromEntries(['shadow', 'particles', 'rig', 'armL', 'armR', 'armLp', 'armRp', 'body', 'cheekL', 'cheekR', 'mouth', 'tongue', 'glasses', 'hat', 'pom', 'bow', 'dots',
    'eye0', 'eye1', 'pupil0', 'pupil1', 'lidT0', 'lidT1', 'lidB0', 'lidB1', 'brow0', 'brow1'].map(r => [r, $(r)]));

  // ---- Tillstånd ----
  let moodName = 'vilar';
  let base = MOODS.vilar;
  let override = null;            // tillfälligt ansikte under en reaktion
  let overrideUntil = 0;
  const s = {
    squash: spring(0, 240, 19), lean: spring(0, 120, 14), lid: spring(0.12, 400, 30), happy: spring(0, 200, 20),
    smile: spring(0.55, 160, 18), width: spring(9, 160, 18), open: spring(0, 500, 26), brow: spring(0, 180, 16),
    browTilt: spring(0, 180, 16), armL: spring(18, 90, 9), armR: spring(-18, 90, 9), lookX: spring(0, 120, 16),
    lookY: spring(0, 120, 16), cheek: spring(0.35, 80, 14), pomX: spring(0, 60, 5), pomY: spring(0, 60, 5), bowRot: spring(0, 90, 6),
    dots: spring(0, 120, 18),
  };
  let hopY = 0, hopV = 0, grounded = true, wobble = 0, t = 0;
  let blinkAt = 1.5, blinkP = -1, nextGlance = 2, nextZ = 0;
  let lookTarget = null, lookUntil = 0, pointer = null;
  const queue = [];               // tecken att "säga"
  let talking = false, speechEnded = true, charClock = 0, onSpeechDone = null;
  const particles = [];
  let alive = true, raf = 0, last = performance.now(), visible = true;

  // ---- Utseende ----
  function setColor(c) {
    color = c;
    for (const r of ['body', 'armLp', 'armRp', 'lidT0', 'lidT1', 'lidB0', 'lidB1']) el[r].setAttribute('fill', c);
  }
  function setAccessory(a) {
    accessory = a;
    el.glasses.style.display = a === 'glasogon' ? '' : 'none';
    el.hat.style.display = a === 'mossa' ? '' : 'none';
    el.bow.style.display = a === 'rosett' ? '' : 'none';
  }
  setColor(color);
  setAccessory(accessory);

  // ---- Kroppen: procedurell droppe med gelérörelse ----
  function bodyPath() {
    const N = 26, pts = [];
    for (let i = 0; i < N; i++) {
      const th = -Math.PI / 2 + (i / N) * Math.PI * 2;
      let d = Math.atan2(Math.sin(th + Math.PI / 2), Math.cos(th + Math.PI / 2)); // vinkel från toppen
      const tipW = Math.exp(-(d * d) / 0.13);
      let x = 100 + RX * Math.cos(th) * (1 - 0.42 * tipW);
      let y = CY + RY * Math.sin(th) - 24 * tipW;
      const w = reduce ? 0 : wobble * (Math.sin(3 * th + t * 9) + 0.5 * Math.sin(5 * th - t * 12.5));
      x += Math.cos(th) * w;
      y += Math.sin(th) * w;
      if (grounded) y = Math.min(y, G);
      pts.push([x, y]);
    }
    let dStr = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      dStr += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return dStr + ' Z';
  }

  function mouthPath(w, open, smile) {
    const y = MOUTH_Y, c = smile * 7;
    const top = y + c * 0.55 - open * 3;
    const bot = y + c + 3 + open * 16;
    return `M${100 - w} ${y} Q100 ${top} ${100 + w} ${y} Q100 ${bot} ${100 - w} ${y} Z`;
  }

  // ---- Partiklar: bläckdroppar vid landning, z när den sover ----
  function spawnDrop(x, vx, vy) {
    const n = document.createElementNS(SVGNS, 'circle');
    n.setAttribute('r', (2 + Math.random() * 2.5).toFixed(1));
    n.setAttribute('fill', color);
    el.particles.appendChild(n);
    particles.push({ n, x, y: G - 4, vx, vy, life: 0.9, kind: 'drop' });
  }
  function spawnZ() {
    const n = document.createElementNS(SVGNS, 'text');
    n.textContent = 'z';
    n.setAttribute('font-size', '18');
    n.setAttribute('font-weight', '700');
    n.setAttribute('fill', 'currentColor');
    n.setAttribute('font-family', 'system-ui, sans-serif');
    el.particles.appendChild(n);
    particles.push({ n, x: 140, y: 70, vx: 10, vy: -16, life: 2.6, max: 2.6, kind: 'z' });
  }

  function land(power) {
    grounded = true;
    hopY = 0;
    s.squash.v += power * 1.9;
    wobble = Math.min(3.5, 1.2 + power * 2.2);
    s.pomY.v += 140 * power; s.bowRot.v -= 240 * power;
    if (!reduce) for (let i = 0; i < 2 + Math.round(power * 3); i++) {
      const side = i % 2 ? 1 : -1;
      spawnDrop(100 + side * (40 + Math.random() * 14), side * (30 + Math.random() * 50), -(90 + Math.random() * 90) * power);
    }
  }
  function hop(power = 1) {
    if (reduce) return;
    // Förberedelse: trycks ihop, sedan iväg.
    s.squash.t = 0.1 * power;
    setTimeout(() => {
      if (!alive) return;
      s.squash.t = 0;
      grounded = false;
      hopV = -330 * power;
      s.pomY.v -= 120; s.bowRot.v += 160;
    }, 140);
  }

  // ---- Tal ----
  function startTalking() { talking = true; speechEnded = false; charClock = 0; }
  function feed(text) { if (!talking) startTalking(); for (const ch of String(text)) queue.push(ch); }
  function endSpeech() { speechEnded = true; }
  function speak(text) {
    queue.length = 0;
    feed(text);
    endSpeech();
    return new Promise(res => { onSpeechDone = res; });
  }

  // ---- Huvudloop ----
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    t += dt;
    const face = override && now < overrideUntil ? { ...base, ...override } : base;
    if (override && now >= overrideUntil) override = null;

    // Mål från läget
    for (const k of ['lid', 'happy', 'smile', 'width', 'brow', 'browTilt', 'armL', 'armR', 'lean', 'cheek']) s[k].t = face[k];
    s.dots.t = moodName === 'tanker' ? 1 : 0;

    // Prat: munnen följer bokstäverna, ungefär 15 tecken i sekunden
    let talkOpen = 0;
    if (talking) {
      charClock += dt;
      while (queue.length && charClock > 0) {
        const ch = queue.shift();
        charClock -= /[.,!?:;]/.test(ch) ? 0.22 : ch === ' ' ? 0.045 : 0.066;
        s.open.t = /[.,!?:;]/.test(ch) ? 0 : ch === ' ' ? 0.08 : VOWELS.test(ch) ? 0.55 + Math.random() * 0.3 : 0.18 + Math.random() * 0.12;
      }
      talkOpen = 1;
      if (!queue.length && charClock > 0.15) {
        s.open.t = face.open;
        if (speechEnded) { talking = false; onSpeechDone?.(); onSpeechDone = null; }
      }
      // Gester medan den pratar
      s.armR.t = face.armR + Math.sin(t * 2.3) * 18;
      s.armL.t = face.armL + Math.sin(t * 1.7 + 1) * 10;
      s.lean.t = face.lean + Math.sin(t * 1.3) * 2;
    } else {
      s.open.t = face.open;
    }

    // Blick: följer ett mål, pekaren eller vandrar i vila
    let lx = face.look?.x ?? 0, ly = face.look?.y ?? 0;
    const tgt = lookTarget && now < lookUntil ? lookTarget : pointer;
    if (tgt && !face.look && moodName !== 'sover') {
      const r = svg.getBoundingClientRect();
      const ex = r.left + r.width * 0.5, ey = r.top + r.height * 0.6;
      let p = tgt instanceof Element ? (() => { const b = tgt.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })() : tgt;
      const dx = p.x - ex, dy = p.y - ey, dist = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, dist / 220);
      lx = (dx / dist) * m; ly = (dy / dist) * m;
    } else if (!face.look && !talking && moodName !== 'sover' && t > nextGlance) {
      nextGlance = t + 2.2 + Math.random() * 3.5;
      s.lookX.t = (Math.random() - 0.5) * 1.2; s.lookY.t = (Math.random() - 0.6) * 0.6;
    }
    if (tgt || face.look || talking) { s.lookX.t = lx; s.lookY.t = ly; }
    if (talking && !tgt) { s.lookX.t = 0; s.lookY.t = 0.1; }

    // Blinkningar
    let blink = 0;
    if (!reduce && moodName !== 'sover') {
      if (blinkP < 0 && t > blinkAt) { blinkP = 0; }
      if (blinkP >= 0) {
        blinkP += dt / 0.16;
        blink = Math.sin(Math.min(1, blinkP) * Math.PI);
        if (blinkP >= 1) { blinkP = -1; blinkAt = t + (Math.random() < 0.2 ? 0.25 : 2.5 + Math.random() * 4); }
      }
    }

    // Andning
    const breath = reduce ? 0 : Math.sin(t * (moodName === 'sover' ? 1.3 : 2.1)) * 0.012 * face.breath;
    // Hopp och fall
    if (!grounded) {
      hopV += 1500 * dt;
      hopY += hopV * dt;
      s.squash.t = -clamp(-hopV / 1700, 0, 0.12);
      if (hopY >= 0) land(Math.min(1.2, hopV / 330));
    }
    // Lätt gungning när den peppar
    const nod = moodName === 'peppar' && !reduce ? Math.sin(t * 4) * 1.6 : 0;
    // Svaj när den tänker
    const sway = moodName === 'tanker' && !reduce ? Math.sin(t * 1.6) * 2 : 0;

    if (reduce) { for (const k in s) { s[k].x = s[k].t; s[k].v = 0; } }
    else for (const k in s) stepSpring(s[k], dt);
    // Efterslängande delar dras mot noll
    s.pomX.t = -s.lean.x * 1.5; s.pomY.t = 0; s.bowRot.t = s.lean.x * 2;
    wobble *= Math.exp(-dt * 3.2);
    if (moodName === 'sover' && !reduce && t > nextZ) { nextZ = t + 1.7; spawnZ(); }

    // ---- Rita ----
    const sq = s.squash.x;
    const sy = 1 - sq + breath, sx = 1 + sq * 0.6 - breath * 0.6;
    el.rig.setAttribute('transform', `translate(100 ${(G + hopY + nod).toFixed(2)}) skewX(${(s.lean.x + sway).toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-100 -${G})`);
    el.body.setAttribute('d', bodyPath());
    const air = clamp(-hopY / 90, 0, 1);
    el.shadow.setAttribute('rx', (46 * (1 - air * 0.45) * sx).toFixed(1));
    el.shadow.setAttribute('fill-opacity', (0.13 * (1 - air * 0.5)).toFixed(3));

    const lidCover = clamp(Math.max(s.lid.x, blink), 0, 1);
    const happyCover = clamp(s.happy.x, 0, 0.9);
    for (const i of [0, 1]) {
      el['pupil' + i].setAttribute('transform', `translate(${(s.lookX.x * 5).toFixed(2)} ${(s.lookY.x * 5.5).toFixed(2)})`);
      // Övre lockets underkant går från ögats topp (-15) ned till botten (+15).
      el['lidT' + i].setAttribute('cy', (-15 + 31 * lidCover - 18).toFixed(2));
      // Undre locket är en rundad kind som trycker upp underifrån när den är glad.
      el['lidB' + i].setAttribute('cy', (15 - 17 * happyCover + 16).toFixed(2));
      const side = i === 0 ? -1 : 1;
      const tilt = s.browTilt.x * side * (i === 1 && moodName === 'tanker' ? -1.6 : 1);
      el['brow' + i].setAttribute('transform', `translate(${EYES[i]} ${(BROW_Y - s.brow.x - s.happy.x * 2).toFixed(2)}) rotate(${tilt.toFixed(2)})`);
    }
    const open = clamp(s.open.x, 0, 1);
    el.mouth.setAttribute('d', mouthPath(s.width.x + open * 2, open, s.smile.x));
    el.tongue.setAttribute('opacity', open > 0.3 ? Math.min(1, (open - 0.3) * 3).toFixed(2) : '0');
    el.tongue.setAttribute('cy', (MOUTH_Y + s.smile.x * 7 + open * 11).toFixed(2));
    el.cheekL.setAttribute('fill-opacity', s.cheek.x.toFixed(2));
    el.cheekR.setAttribute('fill-opacity', s.cheek.x.toFixed(2));
    el.armL.setAttribute('transform', `translate(44 165) rotate(${s.armL.x.toFixed(2)})`);
    el.armR.setAttribute('transform', `translate(156 165) rotate(${s.armR.x.toFixed(2)})`);
    el.pom.setAttribute('transform', `translate(${s.pomX.x.toFixed(2)} ${(s.pomY.x * 0.06).toFixed(2)})`);
    el.bow.setAttribute('transform', `rotate(${s.bowRot.x.toFixed(2)} 100 66)`);
    el.dots.setAttribute('opacity', s.dots.x.toFixed(2));
    if (s.dots.x > 0.01) [...el.dots.children].forEach((c, i) => c.setAttribute('transform', `translate(0 ${(Math.sin(t * 3 - i * 0.6) * 2.5).toFixed(2)})`));

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.kind === 'drop') { p.vy += 900 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'drop') { if (p.y > G + 2) { p.y = G + 2; p.vx *= 0.5; p.vy = 0; } p.n.setAttribute('cx', p.x.toFixed(1)); p.n.setAttribute('cy', p.y.toFixed(1)); p.n.setAttribute('opacity', Math.max(0, p.life / 0.9).toFixed(2)); }
      else { p.n.setAttribute('x', p.x.toFixed(1)); p.n.setAttribute('y', p.y.toFixed(1)); p.n.setAttribute('opacity', Math.max(0, Math.sin((p.life / p.max) * Math.PI)).toFixed(2)); }
      if (p.life <= 0) { p.n.remove(); particles.splice(i, 1); }
    }
    raf = visible ? requestAnimationFrame(frame) : 0;
  }

  // Pausa när figuren inte syns
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && !document.hidden;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }) : null;
  io?.observe(svg);
  const onVis = () => { visible = !document.hidden; if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  const onMove = e => { if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY }; };
  const onLeave = () => { pointer = null; };
  window.addEventListener('pointermove', onMove);
  document.addEventListener('pointerleave', onLeave);
  raf = requestAnimationFrame(frame);

  // ---- Publikt gränssnitt ----
  const api = {
    get moodName() { return moodName; },
    mood(m) {
      if (!MOODS[m]) return;
      if (m === 'glad' && moodName !== 'glad') hop(0.7);
      if (moodName === 'sover' && m !== 'sover') { s.squash.v -= 1.2; wobble = 3; }
      moodName = m; base = MOODS[m];
    },
    react(kind) {
      const now = performance.now();
      if (kind === 'ratt') { hop(1); override = { happy: 0.55, smile: 1, width: 13, open: 0.45, armL: 165, armR: -165, cheek: 0.7, brow: 3 }; overrideUntil = now + 1400; }
      else if (kind === 'nivaupp') { hop(1.15); setTimeout(() => alive && hop(0.8), 760); override = { happy: 0.6, smile: 1, width: 14, open: 0.55, armL: 172, armR: -172, cheek: 0.8, brow: 4 }; overrideUntil = now + 2200; }
      else if (kind === 'fel') { s.squash.t = 0; s.squash.v += 0.7; override = { brow: 2, browTilt: 14, smile: 0.35, width: 8, lean: 3, armR: -60, armL: 22, happy: 0.15 }; overrideUntil = now + 1700; }
      else if (kind === 'peta') { s.squash.v += 1.8; wobble = 3.5; s.pomX.v += 160; override = { happy: 0.6, smile: 0.9, open: 0.3, width: 11, cheek: 0.8 }; overrideUntil = now + 700; }
    },
    speak, feed, endSpeech,
    get talking() { return talking; },
    lookAt(target, ms = 1500) { lookTarget = target; lookUntil = performance.now() + ms; },
    setColor, setAccessory,
    destroy() {
      alive = false; cancelAnimationFrame(raf); io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      host.innerHTML = '';
    },
  };
  return api;
}
