#!/usr/bin/env bash
# Fyller libs/ för lokal utveckling (samma filer som flake.nix bäddar in).
# Kontrollerar varje tarboll mot hashen i libs.json innan något packas upp.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
rm -rf "$root/libs"; mkdir -p "$root/libs"
python3 -I - "$root" "$tmp" <<'PY'
import base64, hashlib, json, os, sys, tarfile, urllib.request
root, tmp = sys.argv[1], sys.argv[2]
for p in json.load(open(os.path.join(root, "libs.json")))["packages"]:
    data = urllib.request.urlopen(p["url"]).read()
    algo, want = p["hash"].split("-", 1)
    got = base64.b64encode(hashlib.new(algo, data).digest()).decode()
    if got != want:
        sys.exit(f"{p['name']}: fel hash ({got})")
    with tarfile.open(fileobj=__import__("io").BytesIO(data)) as t:
        for src, dst in p["files"].items():
            out = os.path.join(root, "libs", dst)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with t.extractfile(src) as f, open(out, "wb") as o:
                o.write(f.read())
    print("ok", p["name"])
PY
cp "$root/assets/fonts.css" "$root/libs/fonts.css"
