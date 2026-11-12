#!/usr/bin/env bash
# Repot är publikt: inget personligt och inga nycklar får checkas in.
# Körs i CI (allmänna mönster) och lokalt före varje push (pre-push-hooken),
# då även med en privat ordlista utanför repot (PK_PRIVATE_WORDS: namn,
# konton, tailnet-namn; en rad per ord, skiftlägesokänsligt).
#
# Två lägen:
#   check-public.sh                 nuvarande version + alla commit-meddelanden
#   check-public.sh --history [rev] dessutom INNEHÅLLET i varje commit (git log -p),
#                                   för rev (t.ex. origin/main..HEAD) eller hela historiken.
#                                   Hooken kör det på de commits som pushas, CI på allt.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
history=""
if [ "${1:-}" = "--history" ]; then history="${2:---all}"; fi
# Tillagda rader i varje commit i intervallet (det som skulle bli publik historik), även i
# merge-commits och binärfiler. Läses en gång till en temporär fil.
# Raderna skrivs som "rad<TAB>[sha]": mönstren använder inte ^ eller $.
hist=""
if [ -n "$history" ]; then
  hist=$(mktemp); trap 'rm -f "$hist"' EXIT
  git log -p --text --diff-merges=first-parent --no-color --format='commit %h' $history -- . ':!go.sum' ':!dev/check-public.sh' \
    | awk '/^commit /{c=$2; next} /^diff --git /{hdr=1; next} /^@@/{hdr=0; next} hdr && /^\+\+\+ /{next} /^\+/{print substr($0,2) "\t[" c "]"}' > "$hist"
fi
added_hits() { # E (mönster) eller F (ord) → träffande rader med sha
  [ -n "$hist" ] && grep -ai"$1" -- "$2" "$hist" | cut -c1-130 || true
}
check() { # beskrivning, ERE-mönster
  local hits
  hits=$(git grep -nIiE "$2" -- . ':!go.sum' ':!dev/check-public.sh' || true)
  if [ -n "$hits" ]; then echo "STOPP – $1:"; echo "$hits"; fail=1; fi
  if [ -n "$history" ]; then
    hits=$(added_hits E "$2" | head -5)
    if [ -n "$hits" ]; then echo "STOPP – $1 i historiken:"; echo "$hits"; fail=1; fi
  fi
}
check "API-nyckel"            'sk-ant-[A-Za-z0-9_-]{8,}|tskey-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY'
check "e-postadress"          '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}' 
check "tailnet-adress"        '[a-z0-9-]+\.ts\.net|\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\b'
check "hemnätets adresser"    '\b(192\.168|10\.[0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}\b'
check "Tailscale stable ID"   '\bn[A-Za-z0-9]{10,}CNTRL\b'
if [ -n "${PK_PRIVATE_WORDS:-}" ]; then
  [ -r "$PK_PRIVATE_WORDS" ] || { echo "STOPP – ordlistan $PK_PRIVATE_WORDS saknas"; exit 1; }
  while IFS= read -r w; do
    [ -z "$w" ] && continue
    hits=$(git grep -nIiF -- "$w" -- . || true)
    [ -n "$hits" ] && { echo "STOPP – privat ord (rad i ordlistan):"; echo "$hits" | cut -c1-120; fail=1; }
    git log --format='%h %B' | grep -iqF -- "$w" && { echo "STOPP – privat ord i ett commit-meddelande"; fail=1; }
    if [ -n "$history" ] && [ -n "$(added_hits F "$w" | head -1)" ]; then echo "STOPP – privat ord i en pushad commits innehåll (rad i ordlistan)"; fail=1; fi
  done < "$PK_PRIVATE_WORDS"
  # Commit-metadata: bara GitHubs noreply-adress.
  if git log --format='%ae%n%ce' | grep -v '@users.noreply.github.com$' | grep -q .; then
    echo "STOPP – commit med annan e-post än noreply"; fail=1
  fi
fi
[ "$fail" = 0 ] && echo "ok: inget personligt eller nycklar hittat"
exit "$fail"
