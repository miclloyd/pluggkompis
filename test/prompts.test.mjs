import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refersToHiddenImage, validateBank, bankPrompt, bankHighPrompt, sortPrompt } from '../web/prompts.js';

test('frågor som pekar på en bild barnet inte ser stoppas', () => {
  for (const q of ['Bilden med skogen och höga träd visar en svart linje som exempel. Vilken sorts linje är det?',
    'I diagrammet över rummets grund, var sitter gränspunkten?', 'Vad ser du på bilden?', 'Figuren som visar cellen: vad är A?'])
    assert.ok(refersToHiddenImage(q), q);
  for (const q of ['Vilken bild passar bäst för grodperspektiv?', 'Vad är en gränspunkt?', 'Varför ritar man en bild i centralperspektiv?'])
    assert.ok(!refersToHiddenImage(q), q);
});

test('validateBank avvisar bildfrågan med en förklaring', () => {
  const goals = [{ id: 'g1', type: 'begrepp' }];
  const refs = new Set(['m1:6']);
  const item = q => ({ goal: 'g1', level: 1, kind: 'mcq', q, options: ['Lodrät', 'Vågrät', 'Sned'], answer: 0, src: { m: 'm1', p: 6 } });
  const r = validateBank({ items: [item('Bilden med skogen visar en linje. Vilken sorts linje?'), item('Hur står en lodrät linje mot marken?')] }, goals, refs);
  assert.ok(r.errors.some(e => /Fråga 1: pekar på en bild/.test(e)), JSON.stringify(r.errors));
  assert.ok(!r.errors.some(e => /Fråga 2/.test(e)), JSON.stringify(r.errors));
});

test('alla frågepromptar har reglerna om bilder och materialets ord', () => {
  const args = { test: { grade: 6, subject: 'Bild' }, goals: [{ id: 'g1', text: 'Kunna x', type: 'begrepp', sources: [{ m: 'm1', p: 1 }] }], sourceText: '' };
  for (const p of [bankPrompt(args), bankHighPrompt(args), sortPrompt(args)]) {
    assert.match(p, /Barnet ser bara frågan, aldrig materialet/);
    assert.match(p, /materialets egna ord/);
  }
});
