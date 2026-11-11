const { hasSpellingLure, pickNext } = await import('../../web/engine.js');
const t = (options, answer) => hasSpellingLure({ kind: 'mcq', options, answer });
console.log(t(['moské', 'moskè', 'mosske'], 0), t(['necessary', 'neccessary', 'necesary'], 0), t(['beautiful','beutiful','beautifull'],0));
console.log(t(['dog', 'cat', 'horse'], 0), t(['Mekka', 'Medina', 'Jerusalem', 'Kairo'], 0), t(['Koranen','Tanakh','Torah'],0), t(['imam','rabbin','präst'],0));
const bank = { g: [{ id: 'a', level: 1, kind: 'mcq', options: ['moské','moskè','mosske'], answer: 0 }, { id: 'b', level: 1, kind: 'mcq', options: ['dog','cat','cow'], answer: 0 }] };
for (let i = 0; i < 5; i++) process.stdout.write(pickNext({ goals: [{ id: 'g', type: 'glosa' }], masteryById: {}, banks: bank, now: Date.now() }).item.id);
console.log();
