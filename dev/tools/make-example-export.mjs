// Skapar examples/export-exempel.json och examples/svar-exempel.csv med påhittade data,
// genom samma funktioner som appen använder (backupJson, attemptsCsv, replayMastery).
// Kör: node dev/tools/make-example-export.mjs
import { writeFileSync } from 'node:fs';
globalThis.window = { htmPreact: new Proxy({}, { get: () => () => null }) };
const { backupJson, attemptsCsv } = await import('../../web/print.js');
const { replayMastery, applyResult, newMastery } = await import('../../web/engine.js');

const T0 = Date.parse('2026-11-02T15:00:00+01:00');
const MIN = 60e3, DAY = 864e5;
const test = { id: 'tdemo01', profileId: 'pdemo01', subject: 'Religion', grade: 5, testDate: '2026-11-19', description: 'Islam: fem pelare, moskén och högtider.',
  status: 'ready', outOfScope: [], comment: 'Påhittat exempel.', offDates: ['2026-11-08'], createdAt: T0 - 2 * DAY, updatedAt: T0, schemaVersion: 1 };
const materials = [{ id: 'mdemo01', ref: 'm1', name: 'Exempelmaterial islam', order: 0, status: 'interpreted', kind: 'pdf', role: 'material', fileAssetId: 'asset-demo-01',
  pages: [{ p: 1, kind: 'fakta', img: 'https://example.invalid/sida1.jpg', text: '## Fem pelare\n\n**Bönen:** man ber fem gånger om dagen.\n\n**Allmosan:** man ger till behövande. Kallas zakat.\n\nMoské, Imam:\nMoskén är byggnaden där man ber.\nImamen leder bönen.' }],
  createdAt: T0 - 2 * DAY, updatedAt: T0 - 2 * DAY, schemaVersion: 1 }];
const goals = [
  { id: 'g1', type: 'fakta', text: 'Kunna de fem pelarna', weight: 3, order: 0, sources: [{ m: 'm1', p: 1 }], enoughMaterial: true, approved: true, removed: false, parentNote: '', pv: 'p2.2' },
  { id: 'g2', type: 'samband', text: 'Kunna förklara varför man fastar', weight: 2, order: 1, sources: [{ m: 'm1', p: 1 }], enoughMaterial: true, approved: true, removed: false, parentNote: '', pv: 'p2.2' },
  { id: 'g3', type: 'glosa', text: 'Kunna glosan nödvändig = necessary', term: 'nödvändig', translation: 'necessary', langs: 'sv-en', weight: 1, order: 2, sources: [], enoughMaterial: true, approved: true, removed: false, parentNote: '', pv: 'p2.2' },
];
const src = { m: 'm1', p: 1 };
const banks = {
  g1: [
    { id: 'i1', goalId: 'g1', level: 1, kind: 'mcq', q: 'Hur många gånger om dagen ber man?', options: ['Tre', 'Fem', 'Sju'], answer: 1, explain: 'Man ber fem gånger om dagen.', quote: 'man ber fem gånger om dagen.', src, pv: 'p2.2' },
    { id: 'i2', goalId: 'g1', level: 2, kind: 'cloze', q: 'Allmosan kallas ___.', answer: 'zakat', accept: [], explain: 'Allmosan kallas zakat.', src, pv: 'p2.2' },
    { id: 'i3', goalId: 'g1', level: 2, kind: 'match', q: 'Para ihop', pairs: [['Bönen', 'Fem gånger om dagen'], ['Allmosan', 'Ge till behövande'], ['Imamen', 'Leder bönen']], explain: 'Tre delar ur materialet.', src, pv: 'p2.2' },
    { id: 'i4', goalId: 'g1', level: 3, kind: 'short', q: 'Vad är allmosan?', answer: 'Att ge pengar eller gåvor till dem som behöver.', must: ['ge pengar eller gåvor', 'till behövande'], explain: '', src, pv: 'p2.2' },
  ],
  g2: [
    { id: 'i5', goalId: 'g2', level: 2, kind: 'sort', q: 'Sortera påståendena', categories: ['Judendom', 'Islam', 'Båda'], items: [['Man ber fem gånger om dagen', 'Islam'], ['Man tror på en enda Gud', 'Båda'], ['Sabbaten börjar fredag kväll', 'Judendom']], explain: 'Båda är monoteistiska.', src, pv: 'p2.2' },
    { id: 'i6', goalId: 'g2', level: 4, kind: 'explain', q: 'Förklara varför man fastar under ramadan.', answer: 'För att förstå hur det är att inte ha mat och komma närmare Gud.', must: ['förstå människor som inte har mat', 'komma närmare Gud'], explain: '', src, pv: 'p2.2' },
  ],
  g3: [
    { id: 'i7', goalId: 'g3', level: 1, kind: 'mcq', q: 'Vad betyder necessary?', options: ['nödvändig', 'nyfiken', 'noggrann'], answer: 0, explain: '', src: null, pv: 'p2.2' },
    { id: 'i8', goalId: 'g3', level: 3, kind: 'write', q: 'Översätt till engelska: nödvändig', answer: 'necessary', accept: [], explain: 'Ett c och två s.', src: null, pv: 'p2.2' },
  ],
};
const P = 'pdemo01';
let n = 0;
const a = (min, goalId, itemId, level, kind, answer, score, verdict, extra = {}) =>
  ({ id: `a${String(++n).padStart(3, '0')}`, profileId: P, goalId, itemId, level, kind, answer, score, verdict, ts: T0 + min * MIN, disputed: false, ...extra });
const attempts = [
  a(0, 'g1', 'i1', 1, 'mcq', 1, 1, 'right'),
  a(1, 'g1', 'i1', 1, 'mcq', 1, 1, 'right'),
  a(2, 'g1', 'i1', 1, 'mcq', 0, 0, 'wrong'),
  a(3, 'g1', 'i1', 1, 'mcq', 1, 1, 'right', { helped: true }),
  a(4, 'g3', 'i7', 1, 'mcq', 0, 1, 'right'),
  a(5, 'g3', 'i8', 3, 'write', 'neccesary', 0.5, 'almost', { coverWrite: { ok: true, rounds: 2 } }),
  a(7, 'g1', 'i4', 3, 'short', 'Man ger pengar.', 0.5, 'almost', { disputed: true, grading: { tier: 'quick', escalated: false, reason: null, met: [true, false], feedback: 'Bra! Vem ger man till?', confidence: 'hög', calls: 1 } }),
  a(1440, 'g2', 'i5', 2, 'sort', { 'Man ber fem gånger om dagen': 'Islam', 'Man tror på en enda Gud': 'Båda', 'Sabbaten börjar fredag kväll': 'Judendom' }, 1, 'right', { exam: 'xdemo01' }),
  a(1441, 'g1', 'i2', 2, 'cloze', 'zakat', 1, 'right', { exam: 'xdemo01' }),
];
const events = [{ id: 'edemo01', type: 'jump', goalId: 'g3', ts: T0 + 4.5 * MIN, from: 1, to: 2, profileId: P }];
const mastery = Object.fromEntries(goals.map(g => [g.id, { ...replayMastery(g, attempts, test.testDate, banks[g.id], events), id: g.id }]));
const chats = [
  { id: 'cdemo01', profileId: P, goalId: 'g1', itemId: 'i2', q: 'Allmosan kallas ___.', ts: T0 + 6 * MIN,
    messages: [{ role: 'assistant', text: 'Zakat betyder att man delar med sig till dem som behöver.', tier: 'quick' }, { role: 'user', text: 'Ge ett exempel', tier: null }, { role: 'assistant', text: 'Som när klassen samlar in pengar till någon som behöver.', tier: 'quick' }] },
  { id: 'tdemochat', kind: 'teach', profileId: P, goalId: 'g1', q: 'Kunna de fem pelarna', ts: T0 + 1450 * MIN, stars: 2,
    covered: ['Man ber fem gånger om dagen'], missing: ['Allmosan'], wrong: null,
    messages: [{ role: 'assistant', text: 'Jag fattar inte riktigt det här: ”De fem pelarna”. Kan du förklara det för mig med egna ord?' }, { role: 'user', text: 'Det är fem saker man gör, som att be fem gånger om dagen.' }, { role: 'assistant', text: 'Okej, man ber fem gånger om dagen! Finns det någon pelare som handlar om pengar?' }] },
];
const exams = [{ id: 'xdemo01', profileId: P, ts: T0 + 1440 * MIN, endTs: T0 + 1442 * MIN, points: 2, max: 3,
  items: [{ goalId: 'g2', itemId: 'i5', level: 2, kind: 'sort', answer: attempts[7].answer, score: 1, verdict: 'right' },
          { goalId: 'g1', itemId: 'i2', level: 2, kind: 'cloze', answer: 'zakat', score: 1, verdict: 'right' },
          { goalId: 'g2', itemId: 'i6', level: 4, kind: 'explain', answer: null, score: 0, verdict: 'skipped' }] }];
const profile = { name: 'Testbarn', grade: 5 };

writeFileSync(new URL('../../examples/export-exempel.json', import.meta.url),
  backupJson({ test, profile, goals, banks, mastery, materials, attempts, events, chats, exams }) + '\n');
writeFileSync(new URL('../../examples/svar-exempel.csv', import.meta.url), attemptsCsv({ attempts, goals }));
console.log('Skrev examples/export-exempel.json och examples/svar-exempel.csv');
