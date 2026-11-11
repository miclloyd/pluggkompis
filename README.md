# Pluggkompis

Instuderingsapp för barn: föräldern laddar upp skolmaterial, AI:n tar fram lärandemål och frågor, och barnet övar
med nivåer som anpassar sig. Plan 1.6; fas 1–2 byggdes som artifact på claude.ai (v15), fas 3 körs här som egen
tjänst på hemservern.

- `web/` – frontenden, orörd från artifact v15 (Preact + htm som ES-moduler, ingen byggprocess)
- `*.go` – backenden: lagring (`/api/store`), filer (`/api/files`), `/api/config`, tsnet och WhoIs
- `libs.json` – pinnade bibliotek (npm-tarbollar med hash); `flake.nix` bäddar in dem, inga CDN:er
- `MANIFEST.md`, `STATUS.md` – artifactens filer, datamodell, prompter och kända buggar (v15)
- `examples/` – exportfil och svarstabell med påhittade data (exportfilen används också av demoläget)
- `dev/` – testmiljö och smoke-skript från artifacten, plus `libs.sh`

Innehåller inga API-nycklar och inga riktiga barnnamn. Typsnitten (Atkinson Hyperlegible, Bricolage Grotesque) har
licensen SIL Open Font License 1.1; licenserna följer med i `libs/licenses/`.

## Köra lokalt

```bash
nix develop            # go, gopls, sqlite
./dev/libs.sh          # hämtar biblioteken till libs/ (kontrollerar hasharna)
go test ./...
go run . -dev 127.0.0.1:8095 -demo -db /tmp/pk.db   # demoläge, föräldra-PIN 1234
```

`nix build` bygger binären med biblioteken inbäddade och kör testerna.

## Drift

Tjänsten slås på i nixos-config (`modules/nixos/server/pluggkompis.nix`), som har repot som flake-input låst på en
commit. Ny version i drift = uppdatera låsningen där. Nätet är en egen tailnet-nod (`tag:pluggkompis`) med HTTPS från
Tailscale; varje anrop kontrolleras med WhoIs mot listan över familjens konton, och okända konton nekas.

## Status för grunden (0.1.0)

Klart: lagring och filer i SQLite, inbäddad frontend med egna kopior av biblioteken, CSP, WhoIs-kontroll, demoläge.
Inte än: `/api/ai` med tak och nyckel, roller (barn mot förälder) och PIN-hashning på servern, import av
säkerhetskopia, skoluppgifter och materialprofiler.
