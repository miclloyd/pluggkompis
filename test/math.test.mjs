import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer, show, frac, checkMath, mathBank, SKILLS, roundThousandths } from '../web/math.js';

const val = v => v.n / v.d;
const num = s => Number(String(s).replace('−', '-').replace(',', '.'));

test('svar som barnet kan skriva', () => {
  const cases = [['7', 7], ['−3', -3], ['-3', -3], ['0,5', 0.5], ['0.5', 0.5], [',5', 0.5], ['1/2', 0.5], ['1 1/2', 1.5],
    ['50 %', 0.5], ['50%', 0.5], ['2,5 cm', 2.5, 'cm'], ['+4', 4], ['3/0', null], ['abc', null], ['', null], ['1,2,3', null],
    ['1 500', 1500], ['12 000,5', 12000.5], ['1 500 cm', 1500, 'cm'], ['−1/2', -0.5]];
  for (const [s, want, unit] of cases) {
    const v = parseAnswer(s, unit);
    if (want === null) assert.equal(v, null, s);
    else assert.ok(v && Math.abs(val(v) - want) < 1e-12, `${s} → ${v && val(v)}`);
  }
});

test('visning med decimalkomma', () => {
  assert.equal(show(frac(1, 2)), '0,5');
  assert.equal(show(frac(-3, 4)), '−0,75');
  assert.equal(show(frac(1, 3)), '1/3');
  assert.equal(show(frac(5, 100)), '0,05');
  assert.equal(show(frac(3, 4), 'fraction'), '3/4');
  assert.equal(show(frac(12)), '12');
});

// Räknar om facit ur frågetexten med vanliga flyttal, oberoende av bråkkoden.
function recompute(skill, q) {
  const n = (q.match(/−?\d+(?:,\d+)?/g) || []).map(num);
  switch (skill) {
    case 'addition': return n[0] + n[1];
    case 'subtraktion': return n[0] - n[1];
    case 'multiplikation': return n[0] * n[1];
    case 'division': return n[0] / n[1];
    case 'bråk-förkorta': { const [a, b] = q.match(/(\d+)\/(\d+)/).slice(1).map(Number); return a / b; }
    case 'bråk-addition': { const f = [...q.matchAll(/(\d+)\/(\d+)/g)].map(m => m[1] / m[2]); return f[0] + f[1]; }
    case 'bråkdel-av-tal': { const [, a, b, x] = q.match(/(\d+)\/(\d+) av (\d+)/).map(Number); return a / b * x; }
    case 'procent-av-tal': return n[0] / 100 * n[1];
    case 'omvandla': { const [, a, b] = q.match(/(\d+)\/(\d+)/).map(Number); return a / b; }
    case 'area':
      if (/omkrets/.test(q)) return 2 * (n[0] + n[1]);
      if (/triangel/.test(q)) return n[0] * n[1] / 2;
      return n[0] * n[1];
    case 'ekvation': {
      const m = q.match(/(\d*)x \+ (\d+) = (−?\d+)/);
      const a = m[1] ? Number(m[1]) : 1;
      return (num(m[3]) - Number(m[2])) / a;
    }
    case 'avrundning': {
      if (/decimal/.test(q)) {
        // Med heltal ur siffrorna, inte flyttal: "2,675" → 2675 tusendelar.
        const [i, d = ''] = q.match(/Avrunda (\d+(?:,\d+)?)/)[1].split(',');
        const x = Number(i) * 1000 + Number(d.padEnd(3, '0'));
        const step = /två/.test(q) ? 10 : 100;
        return Math.floor((x + step / 2) / step) * step / 1000;
      }
      const to = /tiotal/.test(q) ? 10 : 100; return Math.round(n[0] / to) * to;
    }
    case 'negativa-tal': {
      if (/− \(−/.test(q)) return n[0] + Math.abs(n[1]);
      return /\+/.test(q) ? n[0] + n[1] : n[0] - n[1];
    }
    case 'enheter': {
      const k = { 'km-m': 1000, 'm-mm': 1000, 'kg-g': 1000, 'l-dl': 10, 'l-ml': 1000, 'm-cm': 100, 'cm-mm': 10 };
      const m = q.match(/Hur många (\w+) är (\d+(?:,\d+)?) (\w+)\?/);
      const [, to, x, from] = m;
      return k[`${from}-${to}`] ? num(x) * k[`${from}-${to}`] : num(x) / k[`${to}-${from}`];
    }
  }
  throw new Error('okänd färdighet ' + skill);
}

test('varje facit stämmer med en oberoende uträkning (alla färdigheter, nivåer, 30 frön)', () => {
  let n = 0;
  for (const skill of Object.keys(SKILLS)) {
    for (let s = 0; s < 30; s++) {
      for (const it of mathBank({ id: `g${s}`, skill }, 8)) {
        const want = recompute(skill, it.q);
        const got = it.percentOnly ? val(it.answer) : val(it.answer);
        assert.ok(Math.abs(got - want) < 1e-9, `${skill}: ${it.q} facit ${got}, räknat ${want}`);
        // Facit självt ska godkännas av rättningen.
        assert.equal(checkMath(it, it.answerText).score, 1, `${skill}: ${it.q} godkänner inte sitt eget facit ${it.answerText}`);
        n++;
      }
    }
  }
  assert.ok(n > 3000);
});

test('stegen som visas avslöjar aldrig svaret', () => {
  for (const skill of Object.keys(SKILLS)) {
    for (let s = 0; s < 200; s++) {
      for (const it of mathBank({ id: `h${s}`, skill }, 8)) {
        const shown = it.steps.slice(0, it.shown).join(' ');
        const ans = it.answerText.replace(/ (cm²|cm|mm|km|kg|g|dl|ml|m|l|%)$/, '');
        // Svaret får inte stå som resultat ("= 42", "är 42") i de steg som visas.
        assert.ok(!new RegExp(`(=|är|blir) ${ans.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\d,/])`).test(shown),
          `${skill} nivå ${it.level}: "${it.q}" visar svaret ${ans} i "${shown}"`);
      }
    }
  }
});

test('nivåtrappan: visade steg och ledtrådar', () => {
  const b = mathBank({ id: 'x', skill: 'bråkdel-av-tal' });
  for (const l of [1, 2, 3, 4]) assert.equal(b.filter(i => i.level === l).length, 8);
  assert.ok(b.filter(i => i.level === 1).every(i => i.shown === i.steps.length - 1));
  assert.ok(b.filter(i => i.level === 2).every(i => i.shown === 1));
  assert.ok(b.filter(i => i.level >= 3).every(i => i.shown === 0 && i.hints.length >= 2));
  assert.deepEqual(mathBank({ id: 'x', skill: 'bråkdel-av-tal' }), b, 'samma frö ger samma bank');
  assert.deepEqual(mathBank({ id: 'x', skill: 'finns-inte' }), []);
});

test('likvärdiga svar och format', () => {
  const half = { answer: frac(1, 2), answerText: '0,5' };
  for (const s of ['0,5', '1/2', '2/4', '50 %', '0.5']) assert.equal(checkMath(half, s).score, 1, s);
  assert.equal(checkMath(half, '0,4').score, 0);
  assert.equal(checkMath(half, 'hälften').note, 'Skriv ett tal, till exempel 7, 0,5 eller 1/2.');
  const reduce = { answer: frac(2, 3), exact: 'fraction' };
  assert.equal(checkMath(reduce, '2/3').score, 1);
  assert.equal(checkMath(reduce, '4/6').score, 0.5, 'rätt värde men inte förkortat');
  assert.equal(checkMath(reduce, '0,666').score, 0);
  const pct = { answer: frac(3, 4), percentOnly: true };
  assert.equal(checkMath(pct, '75 %').score, 1);
  assert.equal(checkMath(pct, '75').score, 1);
  assert.equal(checkMath(pct, '0,75').score, 0);
  const unit = { answer: frac(12), unit: 'cm' };
  assert.equal(checkMath(unit, '12 cm').score, 1);
  assert.equal(checkMath(unit, '12').score, 1);
});

test('mål: matematik kräver en känd färdighet', async () => {
  const { validateGoals } = await import('../web/prompts.js');
  const materials = [{ ref: 'm1', pages: [{ p: 1 }] }];
  const g = (skill) => ({ text: 'Kunna räkna med bråk', type: 'matematik', skill, weight: 2, sources: [{ m: 'm1', p: 1 }] });
  const out = validateGoals({ goals: [g('bråkdel-av-tal'), g('integraler'), g('toString')] }, materials);
  assert.equal(out.goals.length, 1);
  assert.equal(out.goals[0].skill, 'bråkdel-av-tal');
});

test('frågebanken för matematik byggs utan AI', async () => {
  const { buildBank } = await import('../web/pipeline.js');
  const saved = {};
  const repo = { saveBank: async (t, g, items) => { saved[g] = items; } };
  const goals = [{ id: 'g1', type: 'matematik', skill: 'procent-av-tal' }];
  const r = await buildBank({ ai: null, repo, test: { id: 't' }, goals, materials: [], existing: {} });
  assert.deepEqual(r.short, []);
  assert.equal(saved.g1.length, 32);
  assert.ok(saved.g1.every(i => i.kind === 'math' && i.pv === 'math1'));
});

test('avrundning med kända flyttalsfällor', () => {
  assert.equal(roundThousandths(2675, 2), 268); // 2,675 → 2,68 (flyttal: 2,67)
  assert.equal(roundThousandths(1005, 2), 101); // 1,005 → 1,01 (flyttal: 1,00)
  assert.equal(roundThousandths(1250, 1), 13);  // 1,25 → 1,3
  assert.equal(roundThousandths(1249, 1), 12);
  // 2,675 och 1,005 avrundas uppåt (flyttal ger 2,67 och 1,00).
  for (let s = 0; s < 400; s++) for (const it of mathBank({ id: 'r' + s, skill: 'avrundning' }).filter(i => i.level === 4)) {
    if (/Avrunda 2,675 till två/.test(it.q)) assert.equal(it.answerText, '2,68');
    if (/Avrunda 1,005 till två/.test(it.q)) assert.equal(it.answerText, '1,01');
    assert.match(it.q, /Avrunda \d+,\d{3} /, 'alltid tre decimaler i frågan');
  }
  const it = { answer: frac(268, 100), decimalOnly: true };
  assert.equal(checkMath(it, '2,68').score, 1);
  assert.equal(checkMath(it, '268 %').score, 0.5);
  assert.equal(checkMath(it, '67/25').score, 0.5);
});

test('okänd eller prototyp-färdighet ger ingen bank', () => {
  for (const skill of ['toString', 'constructor', '__proto__']) assert.deepEqual(mathBank({ id: 'x', skill }), []);
});
