import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refersToHiddenImage, validateBank, validateHigh, validateSortItems, bankPrompt, bankHighPrompt, sortPrompt } from '../web/prompts.js';

test('frågor som pekar på en bild barnet inte ser stoppas', () => {
  for (const q of ['Bilden med skogen och höga träd visar en svart linje som exempel. Vilken sorts linje är det?',
    'I diagrammet över rummets grund, var sitter gränspunkten?', 'Bilden visar en kub. Vilken sida ser du?', 'Diagrammet visar temperaturen. När är det varmast?',
    'Kartan över Norden: vilket land ligger längst norrut?', 'Titta på bilden ovan. Vad ser du?', 'Vad står i tabellen?', 'Figuren som visar cellen: vad är A?',
    'Vad syns på bilden ovan?', 'Vad ser du på bilden?', 'Vad visar bilden?', 'Vad ser man i diagrammet?', 'Vilken färg syns  på\u00a0bilden?',
    'Vilket djur står det på bilden?', 'Vad finns det i bilden?'])
    assert.ok(refersToHiddenImage(q), q);
  for (const q of ['Vilken bild passar bäst för grodperspektiv?', 'Vad är en gränspunkt?', 'Varför ritar man en bild i centralperspektiv?',
    'Var placerar du horisontlinjen i bilden om du vill rita ett rum i fågelperspektiv?', 'Vad ska finnas på bilden när du är klar?',
    'Hur läser man av en karta?', 'Vad är en bildtext?'])
    assert.ok(!refersToHiddenImage(q), q);
});

test('validateBank avvisar bildfrågan med en förklaring', () => {
  const goals = [{ id: 'g1', type: 'begrepp' }];
  const refs = new Set(['m1:6']);
  const item = q => ({ goal: 'g1', level: 1, kind: 'mcq', q, options: ['Lodrät', 'Vågrät', 'Sned'], answer: 0, src: { m: 'm1', p: 6 } });
  const r = validateBank({ items: [item('Bilden med skogen visar en linje. Vilken sorts linje?'), item('Hur står en lodrät linje mot marken?')] }, goals, refs);
  assert.ok(r.errors.some(e => /Fråga 1: pekar på en bild/.test(e)), JSON.stringify(r.errors));
  assert.ok(!r.errors.some(e => /Fråga 2/.test(e)), JSON.stringify(r.errors));
  assert.deepEqual(r.byGoal.g1.map(i => i.q), ['Hur står en lodrät linje mot marken?'], 'den giltiga frågan finns kvar');
});

test('alla frågepromptar har reglerna om bilder och materialets ord', () => {
  const args = { test: { grade: 6, subject: 'Bild' }, goals: [{ id: 'g1', text: 'Kunna x', type: 'begrepp', sources: [{ m: 'm1', p: 1 }] }], sourceText: '' };
  for (const p of [bankPrompt(args), bankHighPrompt(args), sortPrompt(args)]) {
    assert.match(p, /Barnet ser bara frågan, aldrig materialet/);
    assert.match(p, /materialets egna ord/);
  }
});

test('fritext och sortering stoppar också bildfrågor', () => {
  const goals = [{ id: 'g1', type: 'begrepp' }];
  const refs = new Set(['m1:6']);
  const high = q => ({ goal: 'g1', level: 3, kind: 'short', q, answer: 'Den står rakt upp.', must: ['nämner att den står rakt upp'], src: { m: 'm1', p: 6 } });
  const h = validateHigh({ items: [high('Bilden visar ett träd. Hur står trädet?'), high('Hur står en lodrät linje mot marken?')] }, goals, refs);
  assert.ok(h.errors.some(e => /^Fråga 1: pekar på en bild/.test(e)), JSON.stringify(h.errors));
  assert.ok(!h.errors.some(e => /^Fråga 2/.test(e)), JSON.stringify(h.errors));
  assert.deepEqual(h.byGoal.g1.map(i => i.q), ['Hur står en lodrät linje mot marken?']);
  const sort = first => ({ goal: 'g1', kind: 'sort', q: 'Sortera påståendena', categories: ['Lodrät', 'Vågrät'],
    items: [[first, 'Lodrät'], ['Kubens hörn', 'Lodrät'], ['Framsidans överkant', 'Vågrät'], ['Parallell med marken', 'Vågrät']], src: { m: 'm1', p: 6 } });
  const so = validateSortItems({ items: [sort('Linjen i bilden med skogen'), sort('Står i 90 grader mot marken')] }, goals, refs);
  assert.ok(so.errors.some(e => /^Övning 1: ett påstående pekar på en bild/.test(e)), JSON.stringify(so.errors));
  assert.ok(!so.errors.some(e => /^Övning 2/.test(e)), JSON.stringify(so.errors));
  assert.equal(so.byGoal.g1.length, 1);
  assert.equal(so.byGoal.g1[0].items[0][0], 'Står i 90 grader mot marken');
});

test('granskningens validering', async () => {
  const { validateCoverage, validateItemReview, itemReviewPrompt, coverageReviewPrompt } = await import('../web/prompts.js');
  const goals = [{ id: 'g1', type: 'begrepp', text: 'Kunna x', sources: [{ m: 'm1', p: 1 }] }];
  const refs = new Set(['m1:1', 'm1:2']);
  const c = validateCoverage({ krav: [
    { krav: 'Begreppet åra', status: 'täckt', mål: ['g1', 'gX'] },
    { krav: 'Begreppet sköld', status: 'saknas', mål: [], förslag: { text: 'Kunna förklara vad en sköld är', type: 'begrepp', sources: [{ m: 'm1', p: 2 }, { m: 'm9', p: 1 }] } },
    { krav: 'Utan förslag', status: 'delvis', mål: [] },
    { krav: 'Fel status', status: 'kanske' },
  ], sammanfattning: 'S' }, goals, refs);
  assert.equal(c.krav.length, 3);
  assert.deepEqual(c.krav[0].mal, ['g1'], 'okänt mål filtreras bort');
  assert.deepEqual(c.krav[1].forslag.sources, [{ m: 'm1', p: 2 }], 'ogiltig källa filtreras bort');
  assert.equal(c.krav[2].forslag, null);
  assert.ok(!c.ok && c.errors.length === 2, JSON.stringify(c.errors));
  assert.equal(validateCoverage({ krav: [] }, goals, refs).ok, false);

  const items = [{ id: 'i1', goalId: 'g1', level: 1, kind: 'mcq', q: 'Vad?', options: ['A', 'B'], answer: 0, src: { m: 'm1', p: 1 } }];
  const r = validateItemReview({ fynd: [{ id: 'i1', problem: 'flera-rätt', vad: 'Båda står.' }, { id: 'i1', problem: 'oklar', vad: 'x' },
    { id: 'i9', problem: 'oklar', vad: 'x' }, { id: 'i1', problem: 'påhittat', vad: 'x' }] }, items);
  assert.equal(r.fynd.length, 1, 'en per fråga, okända bort');
  assert.ok(!r.ok);
  assert.equal(validateItemReview({ fynd: [] }, items).ok, true, 'inga fynd är ett giltigt svar');
  assert.equal(validateItemReview({}, items).ok, false, 'saknad lista är inte "inga fynd"');
  const p = itemReviewPrompt({ test: { grade: 4, subject: 'Historia' }, goals, items, sourceText: '[m1:1] text' });
  assert.match(p, /"rätt":"A"/);
  assert.match(coverageReviewPrompt({ test: { grade: 4, subject: 'Historia', description: 'D' }, goals, materials: [] }), /Varje punkt i beskrivningen/);
});
