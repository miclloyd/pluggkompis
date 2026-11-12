import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalTopic, summaryFacts, pickPrintItems, overlap } from '../web/booklet.js';

test('rubriken över frågorna avslöjar inte svaret', () => {
  assert.equal(goalTopic('Kunna säga vad perspektivet kallas när man betraktar ett föremål underifrån (grodperspektiv).'),
    'Säga vad perspektivet kallas när man betraktar ett föremål underifrån');
  assert.equal(goalTopic('Kunna förklara vad en gränspunkt är: punkten på horisontlinjen där alla parallella linjer möts.'),
    'Förklara vad en gränspunkt är');
  assert.equal(goalTopic('Kunna jämföra grodperspektiv och fågelperspektiv: var man tittar från och vad man ser (undersidan respektive ovansidan).'),
    'Jämföra grodperspektiv och fågelperspektiv');
  // Kort text före kolon är ämnet, inte en fråga: behålls.
  assert.equal(goalTopic('Kunna begreppet: fotosyntes'), 'Begreppet: fotosyntes');
  assert.equal(goalTopic('Kunna förklara varför löven faller'), 'Förklara varför löven faller');
  // Parentes mitt i behålls.
  assert.equal(goalTopic('Kunna räkna med bråk (till exempel 1/2) i vardagen'), 'Räkna med bråk (till exempel 1/2) i vardagen');
});

test('punkterna är hela meningar utan nästan-dubbletter', () => {
  const facts = summaryFacts([
    'Horisontlinjen är din ögonhöjd:',
    'Horisontlinjen visar var betraktarens ögon befinner sig. Därför styr den vad man ser av föremålen.',
    'Föremål ovanför horisontlinjen ritas som om du tittar upp på dem (du ser föremålets undersida).',
    'Ett föremål ovanför horisontlinjen ritas som om du tittar upp på det. Då ser du undersidan.',
    'Vilket perspektiv har du om du betraktar ett föremål underifrån?',
    'motsvarar alltid betraktarens ögonhöjd.',
    'eftersom saker långt bort ser mindre ut.',
    'Blickvinkel lågt nerifrån där man tittar uppåt mot motivet.',
  ]);
  assert.deepEqual(facts, [
    'Horisontlinjen visar var betraktarens ögon befinner sig. Därför styr den vad man ser av föremålen.',
    'Föremål ovanför horisontlinjen ritas som om du tittar upp på dem (du ser föremålets undersida).',
    'Blickvinkel lågt nerifrån där man tittar uppåt mot motivet.',
  ]);
  assert.equal(summaryFacts(['A b c d e', 'F g h i j', 'K l m n o', 'P q r s t', 'U v x y z']).length, 4);
  assert.deepEqual(summaryFacts(['Komma närmare Gud', 'Ramadan', 'Förstå människor som inte har mat'], { minWords: 2 }),
    ['Komma närmare Gud', 'Förstå människor som inte har mat']);
});

test('samma fråga kommer inte två gånger i häftet, inte heller från olika mål', () => {
  const q = (id, level, text) => ({ id, level, kind: 'short', q: text });
  const goals = [{ id: 'g1' }, { id: 'g2' }];
  const banks = {
    g1: [q('a', 1, 'Varför ser vi undersidan på en kub som svävar ovanför horisontlinjen?'), q('b', 2, 'Vad är en horisontlinje?'),
      q('c', 3, 'Varför ser man undersidan av en kub som svävar högt ovanför horisontlinjen?'), q('d', 3, 'Vad visar horisontlinjen om den som tittar?')],
    g2: [q('e', 1, 'Varför ser man undersidan på en kub som svävar ovanför horisontlinjen?'), q('f', 1, 'Vilken sida ser du av en låda ovanför horisontlinjen?'),
      q('g', 2, 'Vad kallas perspektivet underifrån?')],
  };
  const out = pickPrintItems({ goals, banks, mastery: {}, perGoal: 3 });
  assert.deepEqual(out[0].items.map(i => i.id), ['a', 'b', 'd']);
  assert.deepEqual(out[1].items.map(i => i.id), ['f', 'g']);
  assert.ok(overlap('Vad är en horisontlinje?', 'Vad är en gränspunkt?') < 0.8, 'olika begrepp räknas inte som samma fråga');
});

test('glosor, matematik och korta frågor tas aldrig bort som dubbletter', () => {
  const q = (id, level, text, kind = 'short') => ({ id, level, kind, q: text });
  const goals = [{ id: 'a', type: 'glosa' }, { id: 'b', type: 'glosa' }, { id: 'm', type: 'matematik' }, { id: 'n', type: 'matematik' }, { id: 'c', type: 'begrepp' }, { id: 'd', type: 'begrepp' }];
  const banks = {
    // Långa nog för filtret (minst fem ord och överlapp ≥ 0,8): bara typen skyddar dem.
    a: [q('a1', 1, 'Vad heter ordet hund på engelska när du pratar?')], b: [q('b1', 1, 'Vad heter ordet katt på engelska när du pratar?')],
    m: [q('m1', 1, 'Hur mycket blir 3 plus 4 om du räknar?', 'math')], n: [q('n1', 1, 'Hur mycket blir 4 plus 3 om du räknar?', 'math')],
    c: [q('c1', 1, 'Vad är en horisontlinje?')], d: [q('d1', 1, 'Vad är en gränspunkt?')],
  };
  const out = pickPrintItems({ goals, banks, mastery: {}, perGoal: 2 });
  assert.deepEqual(out.map(o => o.items.length), [1, 1, 1, 1, 1, 1]);
  // Samma frågor under ett vanligt mål räknas som dubbletter: det är typen som skyddar.
  const asBegrepp = pickPrintItems({ goals: goals.map(g => ({ ...g, type: 'begrepp' })), banks, mastery: {}, perGoal: 2 });
  assert.deepEqual(asBegrepp.map(o => o.items.length), [1, 0, 1, 0, 1, 1]);
});

test('rubriken blir aldrig tom', () => {
  assert.equal(goalTopic('Kunna (grodperspektiv)'), 'Det här målet');
});
