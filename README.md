# Pluggkompis

Instuderingsapp för barn: föräldern laddar upp skolmaterial, AI:n tar fram lärandemål och frågor, och barnet övar
med nivåer som anpassar sig. Det här är källkoden exakt som artifact-version 15 på claude.ai, för flytten till eget
repo och fas 3 (Go-backend och lokal drift) enligt plan 1.6.

- `web/` – appen (statiska filer, ingen byggprocess: Preact + htm som ES-moduler)
- `MANIFEST.md` – filer, bibliotek, artifact-specifika delar, adaptrar, datamodell, prompter
- `STATUS.md` – vad som är provat, vad som saknas, kända buggar
- `examples/` – exportfil och svarstabell med påhittade data
- `dev/` – testmiljö, smoke-skript och verktyg

Innehåller inga API-nycklar och inga riktiga barnnamn. Demodatan i `dev/harness/stub.js` är påhittad.
Typsnitten (Atkinson Hyperlegible, Bricolage Grotesque) har licensen SIL Open Font License 1.1.
