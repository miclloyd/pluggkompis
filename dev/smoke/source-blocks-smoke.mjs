globalThis.window = { htmPreact: { html: ()=>null, render(){}, h(){}, Component: class{}, useState(){}, useEffect(){}, useRef(){}, useMemo(){}, useCallback(){}, useLayoutEffect(){}, Fragment: {} } };
const { parseBlocks, findPassage } = await import('../../web/source.js');
const t = `## Islam
Islam är en av världens största religioner.

### Fem pelare
- **Shahada:** trosbekännelsen
- Salat: bön fem gånger om dagen
- Zakat

Moské: byggnaden där muslimer ber
Imam: den som leder bönen

Koranen
Koranen är islams heliga bok.
1. Läs
2. Skriv`;
console.log(JSON.stringify(parseBlocks(t), null, 0));
console.log(findPassage(t, { q: 'Vem leder bönen?', answer: 'Imam' }).hit);
// old-style plain text
console.log(parseBlocks('Begrepp\nSabbat: vilodag i judendomen\nTora: judarnas heliga skrift\nDet här är en lång mening som beskriver saker.').map(b=>b.type).join(','));
