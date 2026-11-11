# Pluggkompis – manifest för källkoden (artifact v15)

Källkoden i `web/` är byte för byte den som är publicerad som artifact-version 15
(version-id `1794412419-9fa8`, 2026-11-11). Varje fil i `web/` har jämförts mot den publicerade filen.
Enda undantaget är `index.html`, som på claude.ai visas inlindad i plattformens egen `<!doctype html><head>…<body>`;
här ligger den som den skrevs, utan inlindningen. Gällande plan: plan 1.6.

Ingen fil har flyttats till `ui/`, `engine/`, `prompts/` eller `extract/`. Filerna importerar varandra med relativa
sökvägar (`./engine.js`), så en omflyttning ändrar importerna och ska göras som ett eget steg i repot. Kolumnen
**Område** i filträdet visar vart varje fil hör, som underlag för den omflyttningen.

## Filträd

```
pluggkompis/
├── MANIFEST.md                 den här filen
├── STATUS.md                   testat, halvfärdigt, kända buggar
├── README.md                   kort orientering
├── web.sha256                  sha256 för varje fil i web/ (v15)
├── web/                        appen, exakt v15
│   ├── index.html
│   ├── app.js  lib.js  env.js  repo.js
│   ├── engine.js  plan.js  stats.js  grading.js
│   ├── prompts.js  pipeline.js
│   ├── extract.js  figures.js
│   ├── ui.js  sheet.js  questions.js  source.js  explain.js  coverwrite.js
│   ├── kompis.js  buddy.js  studio.js  theme.js
│   ├── exam.js  teach.js  print.js
│   └── adapters/
│       ├── artifact.js  server.js  memory.js
├── dev/
│   ├── harness/                lokal testmiljö med påhittad data (Playwright)
│   │   ├── build.sh  stub.js  new.py  cw.py
│   ├── smoke/                  nodskript som skriver ut resultat (inga asserts)
│   │   ├── engine-smoke.mjs  source-blocks-smoke.mjs  spelling-lure-smoke.mjs
│   └── tools/
│       └── make-example-export.mjs
└── examples/
    ├── export-exempel.json     säkerhetskopia med påhittade data
    └── svar-exempel.csv        svarstabellen med samma data
```

| Fil | Område | Vad den gör |
| --- | --- | --- |
| `web/index.html` | ui | All CSS (tokens för ljust/mörkt, alla komponenter), typsnitt från Google Fonts, laddar htm+Preact och `app.js` som modul |
| `web/app.js` | ui | Huvudappen: routing (`start`, `parent`, `test`, `child`, `practice`, `exam`, `teach`, `kompis`), start och onboarding, PIN-spärr, föräldravyer (prov, material, mål, frågebank, plan, statistik, överprövningar), barnets startsida, övningsläget, frågekomponenter (`Question`, `Mcq`, `TextAnswer`, `FreeAnswer`, `SelfGrade`, `Feedback`) |
| `web/lib.js` | ui | Enda stället som känner till htm/Preact (`window.htmPreact`) och `loadScript(src, integrity)` för bibliotek som laddas vid behov |
| `web/env.js` | adapters | `loadEnvironment()`: väljer artifact-, server- eller minnesadaptrar |
| `web/repo.js` | adapters | Dokumentsökvägar och CRUD ovanpå Store, `uid()`, `hashPin()` |
| `web/adapters/artifact.js` | adapters | claude.ai: `sample` (AI), `db` (lagring), `assets` (filer), `downloads` (spara fil); felmeddelanden |
| `web/adapters/server.js` | adapters | Utkast för fas 3 mot `/api/*` (ej kört mot någon server) |
| `web/adapters/memory.js` | adapters | Lagring i minnet (förhandsvisning, demoläge) |
| `web/engine.js` | engine | Nivåer, mastery, Leitner, snabbspår, eget hopp, omräkning, urval, lokal rättning, felstavade alternativ |
| `web/plan.js` | engine | Dagsplan per profil: faser, minuter per dag, vilka mål som är introducerade |
| `web/stats.js` | engine | Sammanställning av svar för föräldravyn |
| `web/grading.js` | engine | AI-rättning av fritext: modellval, eskalering, invändning |
| `web/prompts.js` | prompts | Alla prompter och svarsvalidering (`PROMPT_VERSION = 'p2.2'`) |
| `web/pipeline.js` | prompts | AI-flödet: tolka material, föreslå mål, skapa frågebanker, Lär ut det |
| `web/extract.js` | extract | Läser PDF (pdf.js), Word och PowerPoint (JSZip), foton och text i webbläsaren |
| `web/figures.js` | extract | Ritar en PDF-sida ur originalet och hittar bildernas lägen och textens position |
| `web/ui.js` | ui | `coverVar`, `Ring`, `Stamp`, `AnswerTrail`, ikoner |
| `web/sheet.js` | ui | Dialogpanel (Sheet) |
| `web/questions.js` | ui | Para ihop, sortera/Venn, begreppskort (`IntroCard`), dra-och-släpp |
| `web/source.js` | ui | "Läs i materialet": Markdown-tolkning till block, markering av källan, bilder ur originalet |
| `web/explain.js` | ui | "Förklara mer": samtal med AI om en fråga |
| `web/coverwrite.js` | ui | Titta, täck, skriv, kontrollera |
| `web/kompis.js` | ui | Plumpen: riggad SVG-figur med fjädrar, humör, reaktioner, prat |
| `web/buddy.js` | ui | Preact-komponenter runt figuren: `Kompis`, `KompisDock` |
| `web/studio.js` | ui | Skapa din kompis (färg, accessoar, namn, tema) |
| `web/theme.js` | ui | Ljust/mörkt/som enheten |
| `web/exam.js` | ui + engine | Provläge: urval (`pickExam`), rättning på slutet, resultat |
| `web/teach.js` | ui | Lär ut det |
| `web/print.js` | ui | Instuderingshäfte som PDF (jsPDF), svar som CSV, säkerhetskopia som JSON |
| `dev/harness/build.sh` | test | Bygger `web/` med lokala bibliotek och `stub.js` till `dev/harness/site` |
| `dev/harness/stub.js` | test | Låtsas-`window.claude` med påhittade profiler (Elsa, Vidar, Test), prov t1–t5, svar och en AI som ger fasta svar |
| `dev/harness/new.py` | test | Playwright-flöde: kompisstudio, tema, provläge, Lär ut det, föräldravy, PDF och CSV |
| `dev/harness/cw.py` | test | Playwright-flöde: titta, täck, skriv, kontrollera |
| `dev/smoke/*.mjs` | test | Snabbkontroller i Node som skriver ut resultat |
| `dev/tools/make-example-export.mjs` | test | Skapar exempelfilerna i `examples/` med appens egna funktioner |

## Externa bibliotek

| Bibliotek | Version | Laddas från (v15) | Hash |
| --- | --- | --- | --- |
| htm + Preact (standalone) | htm 3.1.1 | `https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/preact/standalone.umd.min.js` (i `index.html`) | Ingen SRI i v15. npm-tarboll: `sha512-983Vyg8NwUE7JkZ6NmOqpCZ+sh1bKv2iYTlUkzlWmA5JD2acKoxd4KVxbMmxX/85mtfdnDmTFoNKcg5DGAvxNQ==`. npm-paketet har `preact/standalone.umd.js` (ej `.min`): `sha384-w94Y7k7ToXbmIx5Vi/LxHtprASwddoLhbR/0ZhekgNn8pP9VNRRHzmp2tqrALfKY` |
| pdf.js | pdfjs-dist 3.11.174 | `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js` och `pdf.worker.min.js` | Ingen SRI i v15. npm-tarboll: `sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==`. npm-filerna: `build/pdf.min.js` `sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e`, `build/pdf.worker.min.js` `sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2` |
| JSZip | 3.10.1 | `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js` | Ingen SRI i v15. npm-tarboll: `sha512-xXDvecyTpGLrqFrvkrUSoxxfJI5AH7U8zxxtVclpsUtMCq4JQ290LY8AW5c7Ggnr/Y/oK+bQMbqK2qmtk3pN4g==`. `dist/jszip.min.js`: `sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG` |
| jsPDF | 4.2.1 | `https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js` | SRI i v15: `sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3` (samma fil som i npm). npm-tarboll: `sha512-YyAXyvnmjTbR4bHQRLzex3CuINCDlQnBqoSYyjJwTP2x9jDLuKDzy7aKUl0hgx3uhcl7xzg32agn5vlie6HIlQ==` |
| Atkinson Hyperlegible | Google Fonts (ingen version) i v15; testmiljön: `@fontsource/atkinson-hyperlegible` 5.1.0 | `https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap` | npm-tarboll 5.1.0: `sha512-2qT7mpgHWYM0bB3+5zbcfy49PD5xil/8t3maXxdgFpJo2dFaD9qBgk5u72KgK7ZtmGOWbCjCoAk5e+vpOIqfvA==`. Licens OFL-1.1 |
| Bricolage Grotesque | Google Fonts (samma länk); testmiljön: `@fontsource-variable/bricolage-grotesque` 5.1.0 | se ovan | npm-tarboll 5.1.0: `sha512-9YiKURmSyEGvbMHCH6UBMP31JMNels5hJR/pIzBvo+mYtSvPCXSIP/VhT7T/4RG4vssXdvUR77eDuUvWSuyYwQ==`. Licens OFL-1.1 |

npm-tarbollarnas `sha512` kan användas direkt som `hash` i Nix `fetchurl` mot `https://registry.npmjs.org/<paket>/-/<namn>-<version>.tgz`.
CDN-filerna från cdnjs är inte kontrollerade byte för byte mot npm, så `sha384` för dem ska räknas på nytt om de används.
`.min.js`-varianten av htm finns bara på cdnjs, inte i npm-paketet.

## Artifact-specifikt som byts vid flytten

| Fil | Funktion / ställe | Vad som är artifact-specifikt | Byts mot |
| --- | --- | --- | --- |
| `web/env.js` | `loadEnvironment()` | Testar `window.claude.use` först | Ordningen kan stå kvar; på servern finns ingen `window.claude` och `/api/config` tar över |
| `web/adapters/artifact.js` | `createArtifactAdapters()` | `window.claude.use('sample' \| 'db' \| 'assets' \| 'downloads')`, `sample.limits()` | `adapters/server.js` |
| `web/adapters/artifact.js` | `ai.complete()` | `sample(prompt, { modelTier, images, signal, onText })` och `sample.json()`; modellnivåerna `quick`/`default`/`complex` väljs av plattformen | `POST /api/ai` med `{ prompt, tier, json }` + bilder; servern mappar `tier` till modell (plan 1.6: Haiku/Sonnet/Sonnet). Strömning (`onText`) finns inte i serverutkastet |
| `web/adapters/artifact.js` | `dbStore()` | `db.doc(path).get/set/update/delete`, `db.collection(path).limit(1000).get()` | `/api/store/*` |
| `web/adapters/artifact.js` | `assetFiles()` | `assets.upload(blob)` → `{ id, url }`, `urlFor(id) = /_blob/{id}` | `/api/files`, `urlFor(id) = /api/files/{id}` |
| `web/adapters/artifact.js` | `save()` | `downloads.save({ filename, data })` med plattformens bekräftelse; `'declined'` är inget fel | Vanlig nedladdning via `<a download>` (finns i `server.js`) |
| `web/adapters/artifact.js` | `config.libs` | CDN-adresser (cdnjs, jsDelivr) | Pinnade lokala kopior (`fetchurl`) |
| `web/index.html` | `<link>` till Google Fonts, `<script src>` till cdnjs för htm | CDN | Lokala filer, `@fontsource` via `fetchurl` |
| `web/app.js` | `TestSetup` → `readAll` | Sidbilder sparas som `pages[].img = <asset-URL>` (inte id). URL:en gäller bara i artifacten | Importen bör byta URL mot fil-id; se STATUS |
| `web/figures.js` | `getDoc()` | `fetch(files.urlFor(assetId))` (i artifacten `/_blob/{id}`) | Fungerar oförändrat med serverns `urlFor` |
| `web/app.js` | `lsGet`/`lsSet` | `localStorage`-nycklar `pk.theme` och `pk.profile` (bekvämlighet per enhet) | Kan stå kvar |
| `web/repo.js` | `hashPin()` | `crypto.subtle` i webbläsaren för föräldra-PIN | Plan 1.6: hashning i Go på servern |

Inga API-nycklar finns i koden. Inga anrop görs direkt till Anthropics API.
`window.storage` används inte.

## Adapter-gränssnitt

`loadEnvironment()` returnerar `{ config, ai, store, files, save }`. `app.js` lägger till `repo = createRepo(store)`.

```ts
config: {
  env: 'artifact' | 'server' | 'local',
  features: { ai, images, imageMaxCount, maxPromptBytes, persistent, files, save, tts, dictation, pdfViaApi },
  libs: { pdfjs, pdfjsWorker, jszip, jspdf, sri?: { jspdf } }
}

ai: null | {
  complete({ prompt, images?, tier = 'default', json = false, signal?, onText? }):
    Promise<{ text: string, truncated?: boolean } | { json: any }>
  // prompt: string, eller [{ role: 'user'|'assistant', content: string }] som slutar på user
  // images: Blob[] (JPEG), tier: 'quick' | 'default' | 'complex'
  // onText({ text }): hela texten hittills (strömning), bara i artifacten
  // fel: AiError { code, message, partial }  (code: not_granted, rate_limited, invalid_json, prompt_too_large, …)
}

store: {
  get(path): Promise<{ id, ...doc } | null>
  set(path, doc): Promise<void>          // ersätter hela dokumentet
  update(path, patch): Promise<void>     // grund sammanslagning av fält
  delete(path): Promise<void>
  list(collectionPath): Promise<Array<{ id, ...doc }>>   // direkta barn, högst 1000
  // fel: StoreError { code }  (quota_exceeded, unavailable)
}

files: null | {
  put(blob): Promise<{ id, url }>
  delete(id): Promise<void>
  urlFor(id): string                     // adress som fetch() kan läsa
}

save: null | (filename: string, data: string | Blob) => Promise<'saved' | 'declined'>
```

Sökvägar: jämnt antal segment är ett dokument (`tests/t1`), udda är en samling (`tests/t1/goals`).

## Datamodell

Alla dokument som skrivs via `repo.save` får `schemaVersion: 1` och `updatedAt` (ms), `createdAt` sätts för profiler och prov.
`id` är dokumentets sista sökvägssegment och läggs till vid läsning. Id:n skapas med `uid(prefix)` (tid i bas 36 + slump).

| Sökväg | Fält (som de sparas i v15) |
| --- | --- |
| `settings/parent` | `salt`, `pinHash` (SHA-256 av `salt:pin`, hex) |
| `profiles/{id}` | `name`, `grade` (årskurs, tal), `color`, `schedule { trainingDays: number[] (0 = måndag), training: [min, max], free: [min, max] }`, `theme` (`auto`/`light`/`dark`), `kompis { color, accessory, name }`, `createdAt` |
| `tests/{id}` | `profileId`, `subject`, `grade`, `testDate` (`YYYY-MM-DD` eller tom), `description`, `status` (`draft` → `interpreted` → `goals` → `building` → `ready`), `outOfScope: string[]`, `comment`, `offDates: string[]` |
| `tests/{id}/materials/{mid}` | `ref` (`m1`, `m2` …), `name`, `role` (`material` \| `beskrivning`), `kind` (`pdf`/`docx`/`pptx`/`image`/`text`), `order`, `fileAssetId` (originalfilen), `status`, `pages: [{ p, kind (fakta/fragor/arbetsblad/glosor/ovrigt), text (Markdown), img? (asset-URL) }]` |
| `tests/{id}/goals/{gid}` | `text`, `type` (`begrepp`/`fakta`/`samband`/`resonemang`/`glosa`), `weight` 1–3, `order`, `sources: [{ m, p }]`, `enoughMaterial`, `note`, `parentNote`, `approved`, `removed`, `pv` (promptversion); glosor även `term`, `translation`, `langs` |
| `tests/{id}/banks/{gid}` | `items: Item[]` (se nedan) |
| `tests/{id}/mastery/{gid}` | `goalId`, `level`, `levelN`, `history: [{ l, s, t }]` (högst 12), `missStreak`, `box` 0–3, `due` (ms), `passedMax`, `seen: { itemId: ms }`, `lastPracticed`, `jump?`, `jumps: [{ from, to, at, held }]`, `jumpBlock?` |
| `tests/{id}/attempts/{aid}` | `profileId`, `goalId`, `itemId`, `level`, `kind`, `answer` (index, text eller objekt), `score` (0, 0.5, 1), `verdict` (`right`/`almost`/`wrong`), `ts`, `disputed`, `resolved?` (`accepted`/`rejected`/`ai-accepted`), `originalScore?`, `helped?`, `exam?` (exam-id), `coverWrite? { ok, rounds }`, `grading? { tier, escalated, reason, met, feedback, confidence, calls, firstScore? }` |
| `tests/{id}/events/{eid}` | `type: 'jump'`, `goalId`, `ts`, `from`, `to`, `profileId` |
| `tests/{id}/chats/{cid}` | Förklara mer: `profileId`, `goalId`, `itemId`, `q`, `ts`, `messages: [{ role, text, tier }]`. Lär ut det: samma plus `kind: 'teach'`, `stars`, `covered`, `missing`, `wrong` |
| `tests/{id}/exams/{xid}` | `profileId`, `ts`, `endTs`, `points`, `max`, `items: [{ goalId, itemId, level, kind, answer, score, verdict (även skipped/ungraded), met?, feedback? }]` |

`tasks/{id}` (skoluppgifter) och fälten för födelseår, `gradeOffset`, Tailscale och LAN-inloggning finns i plan 1.6 men **inte** i koden.

**Item (fråga i en bank)**: gemensamt `id`, `goalId`, `level` 1–5, `kind`, `q`, `explain`, `src: { m, p } | null`, `quote?`, `pv`.
Per typ:
`mcq` – `options: string[]`, `answer: index`;
`cloze` – `q` med exakt ett `___`, `answer`, `accept: string[]`;
`write` – `answer`, `accept`;
`match` – `pairs: [vänster, höger][]` (3–5);
`sort` – `categories: string[]`, `items: [påstående, kategori][]`;
`short` / `explain` / `sentence` (fritext, AI-rättas) – `answer` (modellsvar), `must: string[]` (bedömningspunkter).

**Mastery räknas fram ur svar och händelser** (`replayMastery`): svar med `helped` eller `exam` påverkar inte nivån.

### Export och import

`print.js → backupJson(data)` skriver ett JSON-objekt:

```json
{ "format": "pluggkompis-backup", "version": 1, "exportedAt": "<ISO-tid>",
  "test": {…}, "profile": { "name", "grade" } | null,
  "goals": [ … ], "banks": { "<goalId>": [ Item… ] }, "mastery": { "<goalId>": {…} },
  "materials": [ … utan pages[].img ], "attempts": [ … ], "events": [ … ], "chats": [ … ], "exams": [ … ] }
```

Ett prov per fil. Sidbilder (`img`) tas bort; `fileAssetId` står kvar men filen följer inte med.
Varje dokument behåller sitt `schemaVersion`. **Import finns inte i koden.** Exempel: `examples/export-exempel.json`.

`attemptsCsv` skriver `Datum;Tid;Mål;Nivå;Frågetyp;Poäng;Bedömning;Läge;Svar` med semikolon, decimalkomma och BOM.

## Prompter

Alla i `web/prompts.js`, version `p2.2`. Varje svar valideras i kod; misslyckas valideringen skickas en rättelse
(`correctionPrompt`) en gång (`pipeline.js → askJson`). Inga automatiska omförsök utöver det.

| Prompt | Används i | Nivå (tier) | Svar som valideras |
| --- | --- | --- | --- |
| `interpretPrompt` | `pipeline.interpretMaterial` (PDF, foton) | `default`, med sidbilder | `validateInterpret`: `{ pages: [{ page, kind, text }] }`, en per skickad sida |
| `goalsPrompt` | `pipeline.proposeGoals` | `complex` | `validateGoals`: `{ goals: [{ text, type, weight, sources[{m,p}], enoughMaterial, note, term, translation, langs }], outOfScope: [], comment }`; mål utan giltig källa tas bort |
| `bankPrompt` | `pipeline.buildBank` (nivå 1–2, glosor 1–3) | `default` | `validateBank`: `{ items: Item[] }` med `goal`, `level`, `kind` och typens fält; kräver giltig källa, unika alternativ, exakt en lucka, inga felstavade alternativ (`hasSpellingLure`) |
| `bankHighPrompt` | `pipeline.buildHighBank` (nivå 3–5, glosor 4) | `default` | `validateHigh`: fritextfrågor med rätt `kind` per nivå, `answer`, `must[]` (nivå 3: 1–2, 4: 2–3, 5: 2–4, glosmening: 2), `quote`, giltig `src` eller förälderns anteckning |
| `sortPrompt` | `pipeline.buildSortBank` (samband) | `default` | `validateSortItems`: `kind: 'sort'`, 2–3 kategorier, 4–8 unika påståenden, varje kategori använd, giltig källa |
| `gradePrompt` | `grading.gradeFree` | `quick`, eskalerar till `default` (nivå 5 direkt `default`) | `validateGrade`: `{ met: boolean[] (en per must), feedback, confidence: 'hög'|'låg' }`; poäng räknas i kod ur `met` |
| (samma) | `grading.regradeOnDispute` | `default` | samma |
| `explainContext` | `explain.js` (Förklara mer) | `quick`; "Förklara på ett annat sätt" `default` | fri text, ingen validering; strömmas |
| `teachPrompt` | `pipeline.teachTurn` (Lär ut det) | `default` | `validateTeach`: `{ covered: [], missing: [], wrong: string|null, reply, question: string|null, stars: 1–3 }` |
| `correctionPrompt` | `askJson` | samma som originalet | – |

Eskalering i `grading.js`: `quick` först; `default` om svaret är på nivå 5, `confidence` är låg, poängen blev 0,5,
svaret är längre än 60 ord, eller 0 poäng med minst 6 ord. Svar som är tomma eller triviala sätts till 0 lokalt utan anrop.
