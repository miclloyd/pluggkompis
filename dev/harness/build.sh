#!/usr/bin/env bash
# Bygger en lokal testkopia av web/ med påhittad data (stub.js) och lokala bibliotek,
# för skärmbilder och flödestester med Playwright. Kräver npm (för att hämta biblioteken).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../../web"
SITE="$HERE/site"
CACHE="$HERE/.vendor"
mkdir -p "$CACHE"
fetch() { # paket@version → uppackat i $CACHE/<namn>
  local spec="$1" dir="$CACHE/$2"
  [ -d "$dir" ] && return
  (cd "$CACHE" && npm pack "$spec" >/dev/null 2>&1 && mkdir -p "$dir" && tar xzf "$(ls -t *.tgz | head -1)" -C "$dir" && rm -f *.tgz)
}
fetch htm@3.1.1 htm
fetch pdfjs-dist@3.11.174 pdfjs
fetch jspdf@4.2.1 jspdf
fetch @fontsource/atkinson-hyperlegible@5.1.0 atkinson
fetch @fontsource-variable/bricolage-grotesque@5.1.0 bricolage

rm -rf "$SITE" && mkdir -p "$SITE/vendor/cdn/pdf.js/3.11.174" "$SITE/vendor/jsd/jspdf@4.2.1/dist" "$SITE/fonts"
cp -r "$WEB"/* "$SITE/"
cp "$CACHE/htm/package/preact/standalone.umd.js" "$SITE/vendor/htm-preact.js"
cp "$CACHE/pdfjs/package/build/pdf.min.js" "$CACHE/pdfjs/package/build/pdf.worker.min.js" "$SITE/vendor/cdn/pdf.js/3.11.174/"
cp "$CACHE/jspdf/package/dist/jspdf.umd.min.js" "$SITE/vendor/jsd/jspdf@4.2.1/dist/"
cp "$CACHE"/atkinson/package/files/atkinson-hyperlegible-latin-{400,700}-normal.woff2 "$SITE/fonts/"
cp "$CACHE"/bricolage/package/files/bricolage-grotesque-latin-opsz-normal.woff2 "$SITE/fonts/"
cat > "$SITE/fonts/fonts.css" <<'CSS'
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 400; src: url(atkinson-hyperlegible-latin-400-normal.woff2) format('woff2'); }
@font-face { font-family: 'Atkinson Hyperlegible'; font-weight: 700; src: url(atkinson-hyperlegible-latin-700-normal.woff2) format('woff2'); }
@font-face { font-family: 'Bricolage Grotesque'; font-weight: 200 800; src: url(bricolage-grotesque-latin-opsz-normal.woff2) format('woff2'); }
CSS
cp "$HERE/stub.js" "$SITE/stub.js"
sed -i "s#https://cdnjs.cloudflare.com/ajax/libs#/vendor/cdn#; s#https://cdn.jsdelivr.net/npm#/vendor/jsd#" "$SITE/adapters/artifact.js"
python3 - "$SITE/index.html" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>', '<link rel="stylesheet" href="fonts/fonts.css">', s)
s = s.replace('https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/preact/standalone.umd.min.js', 'vendor/htm-preact.js')
s = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="stub.js"></script></head><body>' + s + '</body></html>'
open(p, 'w').write(s)
PY
echo "Byggt: $SITE (servera katalogen och öppna index.html)"
