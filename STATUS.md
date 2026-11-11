# Status för v15 (2026-11-11)

"Testat" betyder här: kört i testmiljön (`dev/harness`, headless Chromium, påhittad data och en AI-stub med fasta svar),
i både bredd 1000 px och 390 px, ljust och mörkt, utan fel i konsolen. Det finns **inga automatiska tester med asserts**.
Skripten i `dev/smoke` skriver ut resultat som har lästs manuellt. Riktig AI har bara använts i den publicerade artifacten.

## Fungerar och är provat

| Del | Hur det är provat |
| --- | --- |
| Föräldraflöde: nytt prov, läsa in PDF/Word/PowerPoint/foto, tolkning, föreslagna mål, godkännande, frågebank nivå 1–2, fritextfrågor 3–5, sorteringsövningar | I den publicerade artifacten med riktigt skolmaterial och riktig AI |
| Övningsläget: nivåer, snabbspår, eget hopp med provperiod, ned efter 3 missar, Leitner, dagsplan | Testmiljön + smoke-skript (`engine-smoke.mjs`) + användning i artifacten |
| Lokal rättning: flerval, lucktext, skriv (stavtolerans), para ihop, sortera | Smoke-skript + testmiljön |
| AI-rättning av fritext med eskalering och invändning | Artifacten |
| Föräldern ändrar rättning → nivån räknas om (`replayMastery`) | Artifacten |
| Läs i materialet: block, markering, bilder ur PDF:en | Testmiljön med en riktig PDF lokalt; i artifacten hämtas originalet via `/_blob/{id}` |
| Förklara mer, Plumpen-dockan, paus efter 20 min | Testmiljön (pausen genom att flytta klockan) |
| Titta, täck, skriv, kontrollera | Testmiljön (`cw.py`) |
| Inga felstavade svarsalternativ (`hasSpellingLure`) | Smoke-skript; mot en riktig frågebank: 0 av 107 flervalsfrågor träffades felaktigt |
| Ljust/mörkt, kompisstudio, provläge, Lär ut det | Testmiljön (`new.py`) med AI-stub |
| Utskrift (PDF med jsPDF 4.2.1), CSV, säkerhetskopia | Testmiljön; PDF:en öppnad och granskad sida för sida |

## Halvfärdigt eller inte byggt

- **Import av säkerhetskopian** finns inte. Bara export (`print.js → backupJson`).
- **`adapters/server.js`** är ett utkast som aldrig körts mot en server. Strömning (`onText`) saknas där.
- **Allt i plan 1.6 som är fas 3** saknas i koden: Go-backend, födelseår och `gradeOffset`, Tailscale-identitet, LAN-inloggning, skoluppgifter (`tasks`), materialprofiler, matematikgeneratorer, uppläsning.
- **Uppläsning (`speechSynthesis`)** finns inte i koden, trots att planen nämner det.
- **`config.features.tts` och `dictation`** är alltid `false` (platshållare).
- **Provläget** räknar facit i klienten. Plan 1.6 vill att servern räknar om.
- **Föräldra-PIN** hashas i webbläsaren med `crypto.subtle` (SHA-256 med salt). Plan 1.6: hashning i Go.

## Kända buggar och begränsningar

1. **Sidbilder sparas som URL**, inte fil-id (`pages[].img`, satt i `app.js → TestSetup → readAll`). URL:en gäller bara i artifacten. Säkerhetskopian tar bort `img`, men en import måste rendera om sidbilder från `fileAssetId`.
2. **CSV-exporten skriver flervalssvar som index** (0, 1, 2) i stället för alternativets text, och klockslag i enhetens tidszon.
3. **Menybubblan från Plumpen** kan ligga över knapparna på frågekortet på breda skärmar medan den är öppen.
4. **Ringen på 0 %** visar en liten prick (kanten på en båge med längd 0).
5. **Provläget**: ett flervalssvar går direkt vidare och kan inte ångras. Fritext som inte kan rättas (AI saknas eller fel) får "Ej rättad" i provet men sparas som `wrong` med 0 poäng i `attempts`.
6. **PDF-häftet** använder standardtypsnittet Helvetica: tecken utanför västeuropeiska (till exempel arabiska) byts ut. Långa frågor kan i sällsynta fall delas över en sidbrytning.
7. **Lär ut det** har ingen dagsgräns för antal AI-anrop, och visas inte för prov som bara har glosor.
8. **Bildurklipp** fungerar bara för PDF. För fotograferade sidor visas beskrivningen och en länk till hela bilden.
9. **`findPassage`** i `source.js` bytte API (returnerar `{ blocks, hit }`). Ett äldre smoke-skript som använde `parts` är inte med.
10. **Store-listningar** hämtar högst 1000 dokument per samling (`dbStore.list`). Räcker för ett barn och några prov, men `attempts` växer.
11. **Temaval på start- och föräldrasidan** följer senaste val på enheten (`localStorage`), inte en profil.

## Testa själv

```bash
cd dev/harness && ./build.sh             # hämtar biblioteken via npm och bygger site/
python3 -m http.server -d site 8080       # öppna http://localhost:8080/index.html, PIN 1234
python3 new.py 1000 && python3 cw.py 390  # Playwright-flöden (pip install playwright; playwright install chromium)
node ../smoke/engine-smoke.mjs
node ../tools/make-example-export.mjs     # skriver om examples/
```
