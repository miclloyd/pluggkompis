// Matematik (materialprofil, plan 1.6): uppgifter från kodade generatorer med slumpade tal.
// AI:n skapar aldrig uppgifter eller facit i matematik, eftersom ett räknefel i facit lär ut
// fel. AI:n väljer bara färdighet (skill); allt här är ren kod, testad i test/math.test.mjs.
//
// Nivåtrappa (genomräknade exempel enligt forskningen): 1 alla steg visas utom svaret,
// 2 bara första steget visas, 3 egen uppgift med ledtrådsstege, 4 svårare tal.

// ── exakta tal (bråk) ────────────────────────────────────────────────────────

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
export function frac(n, d = 1) {
  if (d === 0) throw new Error('nämnaren är 0');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
export const eq = (a, b) => a.n === b.n && a.d === b.d;

// Läser barnets svar: 7, −3, 0,5, 0.5, 1/2, 1 1/2, 50 %, 2,5 cm (med enheten). null om det inte är ett tal.
export function parseAnswer(raw, unit = '') {
  let s = String(raw ?? '').trim().toLowerCase().replace(/[−–]/g, '-').replace(/\s+/g, ' ');
  // Tusentalsmellanslag: 1 500 och 12 000,5 (men 1 1/2 är blandad form).
  if (/^-?\d{1,3}( \d{3})+([.,]\d+)?( |%|$)/.test(s)) s = s.replace(/(\d) (?=\d{3}\b)/g, '$1');
  if (unit) s = s.replace(new RegExp(`\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '');
  s = s.replace(/^\+/, '');
  let percent = false;
  if (/%$/.test(s)) { percent = true; s = s.replace(/\s*%$/, ''); }
  let m;
  let v = null;
  if ((m = s.match(/^(-?)(\d+) (\d+)\/(\d+)$/))) {          // blandad form 1 1/2
    const sign = m[1] ? -1 : 1;
    v = frac(sign * (Number(m[2]) * Number(m[4]) + Number(m[3])), Number(m[4]));
  } else if ((m = s.match(/^(-?\d+)\/(-?\d+)$/))) {         // 3/4
    if (Number(m[2]) === 0) return null;
    v = frac(Number(m[1]), Number(m[2]));
  } else if ((m = s.match(/^(-?)(\d*)[.,](\d+)$/)) || (m = s.match(/^(-?)(\d+)$/))) {
    const [, sign, int, dec = ''] = m;
    if (!int && !dec) return null;
    const den = 10 ** dec.length;
    v = frac((sign ? -1 : 1) * (Number(int || 0) * den + Number(dec || 0)), den);
  }
  if (!v) return null;
  return percent ? mul(v, frac(1, 100)) : v;
}

// Visning med svenskt decimalkomma.
export function show(v, as = 'auto') {
  if (v.d === 1) return String(v.n).replace('-', '−');
  if (as === 'fraction') return `${v.n < 0 ? '−' : ''}${Math.abs(v.n)}/${v.d}`;
  // Ändliga decimaler när nämnaren bara har faktorerna 2 och 5.
  let d = v.d; while (d % 2 === 0) d /= 2; while (d % 5 === 0) d /= 5;
  if (d === 1) {
    let k = 0, p = 1; while ((v.n * p) % v.d !== 0) { p *= 10; k++; }
    const x = (v.n * p) / v.d;
    const neg = x < 0, a = String(Math.abs(x)).padStart(k + 1, '0');
    return `${neg ? '−' : ''}${a.slice(0, -k)},${a.slice(-k)}`;
  }
  return show(v, 'fraction');
}

// ── slump med frö (samma frö ger samma uppgifter) ────────────────────────────

export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Avrundar x tusendelar till to decimaler (halvt uppåt), i heltal: svaret i 10^to-delar.
export const roundThousandths = (x, to) => { const step = 1000 / 10 ** to; return Math.floor((x + step / 2) / step); };
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const sv = n => String(n).replace('-', '−');

// ── generatorer ──────────────────────────────────────────────────────────────
// Varje generator ger { q, answer (frac), steps: [...], hints: [...], unit?, as? }.
// Det sista steget är alltid själva svaret.

const G = {
  addition: {
    label: 'Addition', gen(r, hard) {
      // Entalen är aldrig 0, så att stegen före svaret inte redan är svaret.
      const nz = (lo, hi) => { let x; do x = int(r, lo, hi); while (x % 10 === 0); return x; };
      const a = hard ? nz(120, 899) : nz(12, 89), b = hard ? nz(105, 899) : nz(11, 89);
      const ones = (a % 10) + (b % 10);
      return { q: `Räkna ut ${a} + ${b}.`, answer: frac(a + b),
        steps: [`Entalen: ${a % 10} + ${b % 10} = ${ones}${ones >= 10 ? ' (minnessiffra 1)' : ''}`, `Lägg ihop resten: ${a - (a % 10)} + ${b - (b % 10)} = ${a + b - ones}`, `${a} + ${b} = ${a + b}`],
        hints: ['Börja med entalen.', 'Glöm inte minnessiffran om entalen blir 10 eller mer.'] };
    },
  },
  subtraktion: {
    label: 'Subtraktion', gen(r, hard) {
      // Talet som dras bort har ental, annars är första steget redan svaret.
      let b; do b = hard ? int(r, 105, 499) : int(r, 11, 49); while (b % 10 === 0);
      const a = b + (hard ? int(r, 50, 450) : int(r, 5, 49));
      return { q: `Räkna ut ${a} − ${b}.`, answer: frac(a - b),
        steps: [`Ta bort tiotalen först: ${a} − ${b - (b % 10)} = ${a - (b - (b % 10))}`, `Ta bort entalen: ${a - (b - (b % 10))} − ${b % 10}`, `${a} − ${b} = ${a - b}`],
        hints: ['Dela upp talet du drar bort i tiotal och ental.', 'Kontrollera: svaret plus det du drog bort ska bli det första talet.'] };
    },
  },
  multiplikation: {
    label: 'Multiplikation', gen(r, hard) {
      const a = hard ? int(r, 12, 49) : int(r, 2, 9), b = int(r, 2, 9);
      const t = a - (a % 10), o = a % 10;
      return { q: `Räkna ut ${a} · ${b}.`, answer: frac(a * b),
        steps: hard ? [`Dela upp: ${a} = ${t} + ${o}`, `${t} · ${b} = ${t * b} och ${o} · ${b} = ${o * b}`, `${t * b} + ${o * b} = ${a * b}`]
          : [`${a} · ${b} betyder ${b} grupper med ${a} i varje.`, `Räkna: ${Array(b).fill(a).join(' + ')}`, `${a} · ${b} = ${a * b}`],
        hints: hard ? ['Dela upp det större talet i tiotal och ental.', 'Multiplicera båda delarna och lägg ihop.'] : ['Tänk på multiplikationstabellen.', `Räkna ${a}-hopp ${b} gånger.`] };
    },
  },
  division: {
    label: 'Division', gen(r, hard) {
      const b = int(r, 2, 9), qn = hard ? int(r, 11, 40) : int(r, 2, 10), a = b * qn;
      return { q: `Räkna ut ${a} / ${b}.`, answer: frac(qn),
        steps: [`Hur många gånger får ${b} plats i ${a}?`, `Räkna ${b}-hopp tills du kommer till ${a}, eller tänk: ${b} · ? = ${a}`, `${a} / ${b} = ${qn}`],
        hints: ['Division är baklänges multiplikation.', `Vilket tal gånger ${b} blir ${a}?`] };
    },
  },
  'bråk-förkorta': {
    label: 'Förkorta bråk', as: 'fraction', gen(r, hard) {
      const n = int(r, 1, 7), d = n + int(r, 1, 8), k = hard ? int(r, 4, 12) : int(r, 2, 5);
      const v = frac(n, d);
      return { q: `Förkorta ${n * k}/${d * k} så långt det går.`, answer: v, as: 'fraction',
        steps: [`Hitta det största tal som delar både ${n * k} och ${d * k}.`, `Dela täljaren ${n * k} och nämnaren ${d * k} med det talet.`, `${n * k}/${d * k} = ${v.n}/${v.d}`],
        hints: ['Dela täljare och nämnare med samma tal.', 'Fortsätt tills inget tal (utom 1) delar båda.'], exact: 'fraction' };
    },
  },
  'bråk-addition': {
    label: 'Addera bråk', as: 'fraction', gen(r, hard) {
      if (!hard) {
        const d = int(r, 3, 12), a = int(r, 1, d - 2), b = int(r, 1, d - a - 1);
        const v = frac(a + b, d);
        return { q: `Räkna ut ${a}/${d} + ${b}/${d}.`, answer: v, as: 'fraction',
          steps: ['Nämnarna är lika, så lägg ihop täljarna.', `Täljarna: ${a} + ${b}, nämnaren är kvar ${d}. Förkorta om det går.`, `${a}/${d} + ${b}/${d} = ${show(v, 'fraction')}`],
          hints: ['Samma nämnare: bara täljarna läggs ihop.', 'Nämnaren ändras inte.'] };
      }
      const d1 = pick(r, [2, 3, 4, 5]), d2 = pick(r, [3, 4, 6, 8, 10].filter(x => x !== d1)), a = int(r, 1, d1 - 1), b = int(r, 1, d2 - 1);
      const v = add(frac(a, d1), frac(b, d2)), D = d1 * d2 / gcd(d1, d2);
      return { q: `Räkna ut ${a}/${d1} + ${b}/${d2}.`, answer: v, as: 'fraction',
        steps: [`Gemensam nämnare: ${D}`, `${a}/${d1} = ${a * D / d1}/${D} och ${b}/${d2} = ${b * D / d2}/${D}`, `${a * D / d1 + b * D / d2}/${D} = ${show(v, 'fraction')}`],
        hints: ['Gör nämnarna lika först.', `Vilket är det minsta tal som både ${d1} och ${d2} går jämnt upp i?`] };
    },
  },
  'bråkdel-av-tal': {
    label: 'Bråkdel av ett tal', gen(r, hard) {
      // Täljaren är minst 2, annars är första steget (1/d av x) redan svaret.
      const d = pick(r, hard ? [3, 4, 5, 6, 8, 10] : [3, 4, 5]), n = int(r, 2, d - 1), x = d * int(r, 2, hard ? 15 : 8);
      return { q: `Vad är ${n}/${d} av ${x}?`, answer: frac(n * x / d),
        steps: [`1/${d} av ${x} är ${x} / ${d} = ${x / d}`, `${n}/${d} är ${n} sådana delar: ${n} · ${x / d}`, `${n}/${d} av ${x} = ${n * x / d}`],
        hints: [`Börja med att ta reda på 1/${d} av ${x}.`, 'Gånga sedan med täljaren.'] };
    },
  },
  'procent-av-tal': {
    label: 'Procent av ett tal', gen(r, hard) {
      const p = pick(r, hard ? [5, 15, 30, 35, 40, 60, 75] : [10, 20, 25, 50]), x = (hard ? 20 : 4) * int(r, 2, 25);
      const v = frac(p * x, 100);
      return { q: `Hur mycket är ${p} % av ${x}?`, answer: v,
        steps: [`${p} % = ${p}/100`, `1 % av ${x} är ${show(frac(x, 100))}`, `${p} % av ${x} = ${show(v)}`],
        hints: ['Procent betyder hundradelar.', `Ta reda på 1 % eller 10 % av ${x} först.`] };
    },
  },
  omvandla: {
    label: 'Bråk, decimaltal och procent', gen(r, hard) {
      const [n, d] = pick(r, hard ? [[3, 8], [7, 20], [9, 25], [3, 5], [11, 20]] : [[1, 2], [1, 4], [3, 4], [1, 5], [1, 10], [2, 5]]);
      const v = frac(n, d), to = pick(r, ['decimal', 'procent']);
      if (to === 'procent') {
        return { q: `Skriv ${n}/${d} i procent.`, answer: v, unit: '%', percentOnly: true,
          steps: [`Förläng ${n}/${d} så att nämnaren blir 100.`, 'Hundradelar är procent: x/100 = x %.', `${n}/${d} = ${sv(n * 100 / d)} %`],
          hints: ['Vilket tal gånger nämnaren blir 100?', 'x/100 är x procent.'] };
      }
      return { q: `Skriv ${n}/${d} som decimaltal.`, answer: v, decimalOnly: true,
        steps: [`Dela täljaren med nämnaren: ${n} / ${d}`, `Eller gör nämnaren till 10, 100 eller 1000.`, `${n}/${d} = ${show(v)}`],
        hints: ['Ett bråk är en division.', 'Prova att förlänga så att nämnaren blir 10 eller 100.'] };
    },
  },
  area: {
    label: 'Area och omkrets', gen(r, hard) {
      const a = int(r, 2, hard ? 25 : 12), b = int(r, 2, hard ? 25 : 12), kind = pick(r, hard ? ['area', 'omkrets', 'triangel'] : ['area', 'omkrets']);
      if (kind === 'omkrets') {
        return { q: `En rektangel är ${a} cm lång och ${b} cm bred. Hur lång är omkretsen?`, answer: frac(2 * (a + b)), unit: 'cm',
          steps: ['Omkretsen är alla sidor tillsammans.', `${a} + ${b} + ${a} + ${b}`, `Omkretsen är ${2 * (a + b)} cm`],
          hints: ['En rektangel har fyra sidor, två och två lika långa.', 'Lägg ihop alla fyra.'] };
      }
      if (kind === 'triangel') {
        return { q: `En triangel har basen ${a} cm och höjden ${b} cm. Hur stor är arean?`, answer: frac(a * b, 2), unit: 'cm²',
          steps: ['Arean av en triangel är bas · höjd / 2.', `${a} · ${b} = ${a * b}`, `${a * b} / 2 = ${show(frac(a * b, 2))} cm²`],
          hints: ['En triangel är en halv rektangel.', 'Räkna bas gånger höjd och dela med 2.'] };
      }
      return { q: `En rektangel är ${a} cm lång och ${b} cm bred. Hur stor är arean?`, answer: frac(a * b), unit: 'cm²',
        steps: ['Arean av en rektangel är längd · bredd.', `${a} · ${b}`, `Arean är ${a * b} cm²`],
        hints: ['Hur många rutor på 1 cm² får plats?', 'Gånga längden med bredden.'] };
    },
  },
  ekvation: {
    label: 'Ekvationer', gen(r, hard) {
      const x = int(r, hard ? -9 : 1, hard ? 15 : 12);
      if (!hard) {
        const a = int(r, 2, 20);
        return { q: `Lös ekvationen x + ${a} = ${x + a}.`, answer: frac(x),
          steps: [`Ta bort ${a} på båda sidor.`, `x = ${x + a} − ${a}`, `x = ${x}`],
          hints: ['Vilket tal plus ' + a + ' blir ' + (x + a) + '?', 'Gör samma sak på båda sidor om likhetstecknet.'] };
      }
      const a = int(r, 2, 9), b = int(r, 1, 20);
      return { q: `Lös ekvationen ${a}x + ${b} = ${sv(a * x + b)}.`, answer: frac(x),
        steps: [`Ta bort ${b} på båda sidor: ${a}x = ${sv(a * x)}`, `Dela båda sidor med ${a}.`, `x = ${sv(x)}`],
        hints: ['Få x ensamt: ta först bort talet som läggs till.', `Dela sedan med ${a}.`] };
    },
  },
  avrundning: {
    label: 'Avrundning', gen(r, hard) {
      if (hard) {
        // Heltal i tusendelar, aldrig flyttal (2,675 · 100 är 267,49999… i flyttal).
        let x; do x = int(r, 1001, 99999); while (x % 10 === 0);
        const to = pick(r, [1, 2]), p = 10 ** to, rv = roundThousandths(x, to);
        return { q: `Avrunda ${show(frac(x, 1000))} till ${to === 1 ? 'en decimal' : 'två decimaler'}.`, answer: frac(rv, p), decimalOnly: true,
          steps: [`Titta på siffran efter ${to === 1 ? 'första' : 'andra'} decimalen.`, '0–4 avrundas nedåt, 5–9 uppåt.', `Svaret är ${show(frac(rv, p))}`],
          hints: ['Vilken siffra bestämmer om det blir uppåt eller nedåt?', '5 eller mer: uppåt.'] };
      }
      const v = int(r, 101, 9899), to = pick(r, [10, 100]), rv = Math.round(v / to) * to;
      return { q: `Avrunda ${v} till närmaste ${to === 10 ? 'tiotal' : 'hundratal'}.`, answer: frac(rv),
        steps: [`Titta på ${to === 10 ? 'entalssiffran' : 'tiotalssiffran'}.`, '0–4 avrundas nedåt, 5–9 uppåt.', `${v} ≈ ${rv}`],
        hints: ['Vilket av de två närmaste ' + (to === 10 ? 'tiotalen' : 'hundratalen') + ' ligger närmast?', '5 eller mer: uppåt.'] };
    },
  },
  'negativa-tal': {
    label: 'Negativa tal', gen(r, hard) {
      const a = int(r, -15, 10), b = int(r, 2, hard ? 25 : 12), op = pick(r, hard ? ['-', '--', '+'] : ['-', '+']);
      const v = op === '+' ? a + b : op === '-' ? a - b : a + b;
      const q = op === '--' ? `${sv(a)} − (−${b})` : `${sv(a)} ${op === '+' ? '+' : '−'} ${b}`;
      return { q: `Räkna ut ${q}.`, answer: frac(v),
        steps: [op === '--' ? 'Minus ett negativt tal är samma sak som plus.' : 'Tänk på en tallinje.', op === '-' ? `Gå ${b} steg åt vänster från ${sv(a)}.` : `Gå ${b} steg åt höger från ${sv(a)}.`, `${q} = ${sv(v)}`],
        hints: ['Rita en tallinje.', 'Åt höger blir det större, åt vänster mindre.'] };
    },
  },
  enheter: {
    label: 'Enheter', gen(r, hard) {
      const conv = hard
        ? [['km', 'm', 1000], ['m', 'mm', 1000], ['kg', 'g', 1000], ['l', 'dl', 10], ['l', 'ml', 1000], ['m', 'cm', 100]]
        : [['m', 'cm', 100], ['cm', 'mm', 10], ['kg', 'g', 1000], ['l', 'dl', 10]];
      const [big, small, k] = pick(r, conv), down = r() < 0.5;
      if (down || !hard) {
        const x = hard ? int(r, 11, 99) / 10 : int(r, 2, 9);
        const v = frac(Math.round(x * 10) * k, 10);
        return { q: `Hur många ${small} är ${show(frac(Math.round(x * 10), 10))} ${big}?`, answer: v, unit: small,
          steps: [`1 ${big} = ${k} ${small}`, `${show(frac(Math.round(x * 10), 10))} · ${k}`, `${show(frac(Math.round(x * 10), 10))} ${big} = ${show(v)} ${small}`],
          hints: [`Hur många ${small} är 1 ${big}?`, 'Från större till mindre enhet: gånga.'] };
      }
      const y = int(r, 2, 40) * (k / 10 >= 1 ? k / 10 : 1) * 5;
      const v = frac(y, k);
      return { q: `Hur många ${big} är ${y} ${small}?`, answer: v, unit: big,
        steps: [`1 ${big} = ${k} ${small}`, `${y} / ${k}`, `${y} ${small} = ${show(v)} ${big}`],
        hints: [`Hur många ${small} är 1 ${big}?`, 'Från mindre till större enhet: dela.'] };
    },
  },
};

export const SKILLS = Object.fromEntries(Object.entries(G).map(([k, g]) => [k, g.label]));

// Godkänns svaret? Exakt värde; "bara bråk" kräver förkortat bråk, "bara decimal" ett
// decimaltal, procent kräver procenttecken eller talet (50 eller 50 %).
export function checkMath(item, given) {
  const want = frac(item.answer.n, item.answer.d);
  if (item.percentOnly) {
    const v = parseAnswer(String(given).replace(/\s*%\s*$/, ''));
    if (!v) return { score: 0, verdict: 'wrong', note: 'Skriv ett tal, till exempel 25 %.' };
    return eq(v, mul(want, frac(100))) ? { score: 1, verdict: 'right' } : { score: 0, verdict: 'wrong' };
  }
  const v = parseAnswer(given, item.unit);
  if (!v) return { score: 0, verdict: 'wrong', note: 'Skriv ett tal, till exempel 7, 0,5 eller 1/2.' };
  if (!eq(v, want)) return { score: 0, verdict: 'wrong' };
  const s = String(given).trim().replace(/[−–]/g, '-');
  if (item.decimalOnly && /%/.test(s)) return { score: 0.5, verdict: 'almost', note: 'Rätt värde, men skriv det som ett decimaltal.' };
  if (item.exact === 'fraction' && want.d !== 1) {
    const m = s.match(/^\s*-?(\d+)\s*\/\s*(\d+)\s*$/);
    if (!m) return { score: 0.5, verdict: 'almost', note: 'Rätt värde, men skriv det som ett bråk.' };
    if (gcd(Number(m[1]), Number(m[2])) !== 1) return { score: 0.5, verdict: 'almost', note: 'Rätt värde, men det går att förkorta mer.' };
  }
  if (item.decimalOnly && /\//.test(s)) return { score: 0.5, verdict: 'almost', note: 'Rätt värde, men skriv det som ett decimaltal.' };
  return { score: 1, verdict: 'right' };
}

// Frågebank för ett matematikmål: count uppgifter per nivå, samma frö ger samma bank.
export function mathBank(goal, count = 8) {
  if (!Object.hasOwn(G, String(goal.skill))) return [];
  const g = G[goal.skill];
  const items = [];
  for (let level = 1; level <= 4; level++) {
    const r = rng(`${goal.id}:${goal.skill}:${level}`);
    const seen = new Set();
    for (let i = 0, tries = 0; items.filter(x => x.level === level).length < count && tries < count * 10; tries++) {
      const t = g.gen(r, level === 4);
      if (seen.has(t.q)) continue;
      seen.add(t.q);
      items.push({
        id: `mx-${goal.id}-${level}-${i++}`, goalId: goal.id, level, kind: 'math', skill: goal.skill,
        q: t.q, answer: { n: t.answer.n, d: t.answer.d }, answerText: t.percentOnly ? `${show(mul(t.answer, frac(100)))} %` : `${show(t.answer, t.as)}${t.unit ? ' ' + t.unit : ''}`,
        steps: t.steps, shown: level === 1 ? t.steps.length - 1 : level === 2 ? 1 : 0,
        hints: level >= 3 ? t.hints : [], ...(t.unit && !t.percentOnly ? { unit: t.unit } : {}),
        ...(t.percentOnly ? { percentOnly: true } : {}), ...(t.decimalOnly ? { decimalOnly: true } : {}), ...(t.exact ? { exact: t.exact } : {}),
        explain: t.steps.at(-1), src: null, pv: 'math1',
      });
    }
  }
  return items;
}
