// Lokal testmiljö: låtsas vara plattformens db med påhittade exempeldata.
(() => {
  const DAY = 864e5;
  const now = Date.now();
  const dk = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const docs = new Map();
  const put = (p, d) => docs.set(p, d);

  put('settings/parent', { salt: 's1', pinHash: 'b48bb8e07f48151c4c7e8dbe4a50708061646357f397e2fac1f3df5cb43629a2' });
  put('profiles/p1', { id: 'p1', name: 'Elsa', grade: 5, color: '#2148c0', createdAt: 1, schedule: { trainingDays: [1, 3], training: [15, 30], free: [20, 60] } });
  put('profiles/p2', { id: 'p2', name: 'Vidar', grade: 3, color: '#1d7a50', createdAt: 2 });

  put('tests/t1', { id: 't1', profileId: 'p1', subject: 'Religion', grade: 5, testDate: dk(now + 8 * DAY), status: 'ready', description: '',
    comment: 'Lägg mest tid på de fem pelarna, Koranen och högtiderna, eftersom det är kärnan i materialet.' });
  put('tests/t2', { id: 't2', profileId: 'p1', subject: 'Kemi', grade: 5, testDate: dk(now + 13 * DAY), status: 'goals', description: 'Begreppen på begreppslistan och våra laborationer.' });
  put('tests/t3', { id: 't3', profileId: 'p2', subject: 'Engelska glosor', grade: 3, testDate: dk(now + 4 * DAY), status: 'ready' });

  put('tests/t1/materials/m1', {"id": "m1", "ref": "m1", "name": "Exempelmaterial religion", "order": 0, "status": "interpreted", "kind": "pdf", "role": "material", "pages": [{"p": 1, "kind": "fakta", "text": "Exempelmaterial religion\n\nFem pelare: Trosbekännelsen, Bönen, Allmosan, Fastan, Vallfärden\n\nBild: En byggnad med fem pelare, en för varje del.\n\nTrosbekännelsen: man säger vad man tror på.\n\nBönen: man ber fem gånger om dagen och vänder sig mot Mekka.\n\nAllmosan: man ger till dem som behöver. Kallas zakat.\n\nMoské, Imam:\nMoskén är byggnaden där man ber tillsammans.\nImamen leder bönen."}, {"p": 2, "kind": "fakta", "text": "Moskén: platsen där muslimer ber. Imamen leder bönen."}, {"p": 3, "kind": "fakta", "text": "## Islam\nIslam är en **monoteistisk** religion. Man tror på en enda Gud.\n\n### Viktiga platser\n- **Mekka:** den heligaste staden\n- **Moskén:** byggnaden där man ber\n\n### Så går bönen till\n1. Man tvättar sig först.\n2. Man vänder sig mot Mekka."}]});
  put('tests/t1/materials/m2', { id: 'm2', ref: 'm2', name: 'Exempelmaterial judendom', order: 1, status: 'interpreted', kind: 'pdf', role: 'material',
    pages: [{ p: 1, kind: 'fakta', text: 'Monoteistisk religion: man tror på en enda Gud.' }] });
  put('tests/t2/materials/m1', { id: 'm1', ref: 'm1', name: 'Begreppslista till provet', order: 0, status: 'interpreted', kind: 'pdf', role: 'material', pages: [{ p: 1, kind: 'fakta', text: 'Materia, atom, molekyl …' }] });

  const goals = [
    ['g1', 'begrepp', 'Kunna förklara vad allmosan (zakat) är', 3, 'm1', 1],
    ['g2', 'fakta', 'Kunna de fem pelarna i islam', 3, 'm1', 1],
    ['g3', 'fakta', 'Kunna hur och när en muslim ber', 2, 'm1', 1],
    ['g4', 'begrepp', 'Kunna vad en moské och en imam är', 2, 'm1', 2],
    ['g5', 'samband', 'Kunna jämföra hur man ser på Gud i judendomen och islam', 3, 'm2', 1],
    ['g6', 'fakta', 'Kunna vad Tanakh och Torah är', 2, 'm2', 1],
    ['g7', 'resonemang', 'Kunna förklara varför man fastar under ramadan', 2, 'm1', 1],
    ['g8', 'begrepp', 'Kunna vad kosher betyder', 1, 'm2', 1],
  ];
  goals.forEach(([id, type, text, weight, m, p], i) => put(`tests/t1/goals/${id}`, { id, type, text, weight, order: i, sources: [{ m, p }], enoughMaterial: true, approved: true, removed: false, parentNote: '' }));
  ['Kunna vad gas, fast och flytande betyder', 'Kunna förklara vad en atom är', 'Kunna vad som hände i stålullslabben'].forEach((text, i) =>
    put(`tests/t2/goals/k${i}`, { id: `k${i}`, type: i === 2 ? 'samband' : 'begrepp', text, weight: 2, order: i, sources: [{ m: 'm1', p: 1 }], enoughMaterial: i !== 2, note: i === 2 ? 'Frågan hänvisar till elevens egen labbrapport.' : '', approved: false, removed: false, parentNote: '' }));

  const mcq = (g, l, q, options, answer, explain) => ({ id: `${g}-${l}-${q.length}`, goalId: g, level: l, kind: 'mcq', q, options, answer, explain, src: { m: 'm1', p: 1 } });
  const max = { begrepp: 3, fakta: 3, samband: 5, resonemang: 5 };
  for (const [id, type] of goals) {
    const items = [
      mcq(id, 1, 'Vad kallas allmosan på arabiska?', ['Ramadan', 'Zakat', 'Kaba'], 1, 'Allmosan kallas zakat. Man ger gåvor till behövande.'),
      mcq(id, 1, 'Hur många gånger om dagen ber en muslim?', ['Tre', 'Fem', 'Sju'], 1, 'Bönen ska göras fem gånger om dagen.'),
      { id: `${id}-c`, goalId: id, level: 2, kind: 'cloze', q: 'Den som leder bönen i moskén kallas ___.', answer: 'imam', accept: ['imamen'], explain: 'Imamen leder bönen.', src: { m: 'm1', p: 2 } },
      { id: `${id}-m`, goalId: id, level: 2, kind: 'match', q: 'Para ihop pelaren med vad den handlar om', pairs: [['Bönen', 'Fem gånger om dagen'], ['Fastan', 'Under ramadan'], ['Vallfärden', 'Resan till Mekka']], explain: 'Tre av de fem pelarna.', src: { m: 'm1', p: 1 } },
      mcq(id, 2, 'Vilken stad vänder man sig mot när man ber?', ['Medina', 'Jerusalem', 'Mekka', 'Kairo'], 2, 'Man vänder sig mot Mekka.'),
    ];
    for (let l = 3; l <= max[type]; l++) items.push({ id: `${id}-f${l}`, goalId: id, level: l, kind: l === 3 ? 'short' : 'explain',
      q: l === 3 ? 'Förklara med egna ord vad zakat är.' : 'Varför tror du att fastan under ramadan är viktig för muslimer?',
      answer: l === 3 ? 'Zakat är att man ger gåvor eller pengar till människor som behöver det.' : 'Man fastar för att förstå hur det känns att inte ha mat, och för att komma närmare Gud.',
      must: l === 3 ? ['ger gåvor eller pengar', 'till behövande'] : ['förstå människor som inte har mat', 'kommer närmare Gud eller tron'], explain: '', src: { m: 'm1', p: 1 } });
    put(`tests/t1/banks/${id}`, { items });
  }
  const levels = { g1: 3, g2: 2, g3: 2, g4: 1, g5: 3, g6: 1 };
  for (const [g, lv] of Object.entries(levels)) put(`tests/t1/mastery/${g}`, { goalId: g, level: lv, levelN: 1, history: [{ l: lv, s: 1, t: now - DAY }, { l: lv, s: 1, t: now - 2e6 }], missStreak: 0, box: 1, due: now + DAY, passedMax: g === 'g1', seen: {}, jumps: g === 'g5' ? [{ from: 2, to: 3, at: now - DAY, held: true }] : [] });


  // Testprov för de interaktiva frågetyperna
  put('profiles/p3', { id: 'p3', name: 'Test', grade: 5, color: '#7a3fb0', createdAt: 3 });
  put('tests/t4', { id: 't4', profileId: 'p3', subject: 'Religion', grade: 5, testDate: dk(now + 6 * DAY), status: 'ready' });
  put('tests/t4/materials/m1', docs.get('tests/t1/materials/m1'));
  put('tests/t4/goals/s1', { id: 's1', type: 'samband', text: 'Kunna jämföra judendom och islam', weight: 3, order: 0, sources: [{ m: 'm1', p: 1 }], enoughMaterial: true, approved: true, removed: false });
  put('tests/t4/banks/s1', { items: [
    { id: 'i-mcq', goalId: 's1', level: 1, kind: 'mcq', q: 'Vad heter islams heliga skrift?', options: ['Tanakh', 'Koranen', 'Torah'], answer: 1, explain: 'Koranen är islams heliga skrift.', src: { m: 'm1', p: 1 } },
    { id: 'i-match', goalId: 's1', level: 1, kind: 'match', q: 'Para ihop pelaren med vad den handlar om', pairs: [['Bönen', 'Fem gånger om dagen mot Mekka'], ['Fastan', 'Under ramadan'], ['Allmosan', 'Gåvor till behövande'], ['Vallfärden', 'Resan till Mekka']], explain: 'Fyra av de fem pelarna.', src: { m: 'm1', p: 1 } },
    { id: 'i-sort', goalId: 's1', level: 1, kind: 'sort', q: 'Sortera påståendena', categories: ['Judendom', 'Islam', 'Båda'], items: [['Man tror på en enda Gud', 'Båda'], ['Den heliga skriften heter Tanakh', 'Judendom'], ['Man ber fem gånger om dagen', 'Islam'], ['Sabbaten firas från fredag kväll', 'Judendom'], ['Man fastar under ramadan', 'Islam'], ['Abraham är en viktig person', 'Båda']], explain: 'Båda religionerna är monoteistiska.', src: { m: 'm1', p: 1 } },
  ] });

  put('tests/t5', { id: 't5', profileId: 'p3', subject: 'Engelska', grade: 5, testDate: dk(now + 5 * DAY), status: 'ready' });
  put('tests/t5/goals/w1', { id: 'w1', type: 'glosa', term: 'nödvändig', translation: 'necessary', langs: 'sv-en', text: 'Kunna glosan nödvändig = necessary', weight: 2, order: 0, sources: [], enoughMaterial: true, approved: true, removed: false });
  put('tests/t5/banks/w1', { items: [
    { id: 'w-1', goalId: 'w1', level: 1, kind: 'write', q: 'Översätt till engelska: nödvändig', answer: 'necessary', accept: [], explain: 'Ett c och två s.', src: null },
  ] });
  let n = 0;
  const att = (dayOff, mins, right) => {
    const base = now - dayOff * DAY - 3 * 3600e3;
    const count = Math.round(mins * 2.2);
    for (let i = 0; i < count; i++) {
      const s = Math.random() < right ? 1 : Math.random() < 0.3 ? 0.5 : 0;
      put(`tests/t1/attempts/a${n}`, { id: `a${n++}`, profileId: 'p1', goalId: goals[i % 6][0], itemId: `${goals[i % 6][0]}-c`, level: 1, kind: i % 3 ? 'mcq' : 'cloze', answer: 'x', score: s, verdict: s === 1 ? 'right' : s ? 'almost' : 'wrong', ts: base + i * 27e3, disputed: i === 7 && dayOff === 0 });
    }
  };
  att(2, 18, 0.7); att(1, 24, 0.8); att(0, 9, 0.85);

  const db = {
    doc: path => ({
      get: async () => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) }),
      set: async d => { docs.set(path, structuredClone(d)); },
      update: async d => { docs.set(path, { ...(docs.get(path) || {}), ...structuredClone(d) }); },
      delete: async () => { docs.delete(path); },
    }),
    collection: path => {
      const q = { limit: () => q, get: async () => {
        const out = [];
        for (const [p, d] of docs) if (p.split('/').slice(0, -1).join('/') === path) out.push({ id: p.split('/').pop(), exists: true, data: () => structuredClone(d) });
        return { docs: out, size: out.length, empty: !out.length };
      } };
      return q;
    },
  };
  const sample = Object.assign(async () => ({ text: 'Zakat betyder att man delar med sig. Den som har pengar ger en del till dem som behöver, ungefär som när klassen samlar in till en insamling. Det står i ditt material att allmosan är en av de fem pelarna.' }), { json: async (prompt) => {
      const t = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      if (t.includes('"stars"')) return t.includes('sista svaret')
        ? { covered: ['Man ber fem gånger om dagen', 'Man ger till fattiga'], missing: [], wrong: null, reply: 'Tack! Nu fattar jag att pelarna är fem saker alla muslimer ska göra, som att be och ge till fattiga.', question: null, stars: 3 }
        : { covered: ['Man ber fem gånger om dagen'], missing: ['Allmosan'], wrong: null, reply: 'Okej, så man ber fem gånger om dagen och vänder sig mot Mekka. Det fattar jag!', question: 'Men finns det någon pelare som handlar om pengar?', stars: 2 };
      return {};
    }, limits: async () => ({ maxPromptBytes: 262144 }) });
  const assets = { upload: async b => ({ id: 'x', url: URL.createObjectURL(b) }), delete: async () => {}, list: async () => ({ assets: [] }) };
  const downloads = { save: async ({ filename, data }) => { window.__saved = { filename, data }; return { status: 'saved' }; } };
  window.claude = { use: async name => (name === 'db' ? db : name === 'sample' ? sample : name === 'assets' ? assets : name === 'downloads' ? downloads : null) };
})();
