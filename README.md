# Pluggkompis

Instuderingsapp för barn: föräldern laddar upp skolmaterial, AI:n tar fram lärandemål och frågor, och barnet övar
med nivåer som anpassar sig. Plan 1.6; fas 1–2 byggdes som artifact på claude.ai (v15), fas 3 körs här som egen
tjänst på hemservern.

- `web/` – frontenden från artifact v15 (Preact + htm som ES-moduler, ingen byggprocess); ändringar sedan dess syns i historiken
- `*.go` – backenden: lagring (`/api/store`), filer (`/api/files`), föräldraläge och roller (`/api/auth`), `/api/config`, tsnet och WhoIs
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
go run . -dev 127.0.0.1:8095 -demo -db /tmp/pk.db   # demoläge, föräldra-PIN 1234 (-dev-as child = barnets vy)
```

`nix build` bygger binären med biblioteken inbäddade och kör testerna.

## Drift

Tjänsten slås på i nixos-config (`modules/nixos/server/pluggkompis.nix`), som har repot som flake-input låst på en
commit. Ny version i drift = uppdatera låsningen där. Nätet är en egen tailnet-nod (`tag:pluggkompis`) med HTTPS från
Tailscale; varje anrop kontrolleras med WhoIs mot listan över familjens konton, och okända konton nekas.

## Roller

Rollen kommer från Tailscale-kontot. Ett barnkonto ser bara profilerna som är kopplade till kontot (`account`) och
deras prov, och skriver bara svar, nivåer, hopp, samtal, provlägen samt tema och kompis på sin profil. Ett
föräldrakonto övar som barn tills föräldraläget låses upp med PIN (en lånad iPad). PIN:en hashas med argon2id på
servern och lämnar den aldrig; fem fel ger en spärr som fördubblas. Upplåst läge gäller i 30 minuter utan aktivitet.
Detaljer i `access.go` och `auth.go`.

## Status (0.2.0)

Klart: lagring och filer i SQLite, inbäddad frontend med egna kopior av biblioteken, CSP, WhoIs-kontroll, roller och
PIN på servern, demoläge (`-dev-as child` visar barnets vy).
Inte än: `/api/ai` med tak och nyckel, import av säkerhetskopia, skoluppgifter och materialprofiler.
