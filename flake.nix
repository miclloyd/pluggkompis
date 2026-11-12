{
  description = "Pluggkompis — barnens pluggapp (Go-backend + artifactens frontend, tsnet)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    inherit (pkgs) lib;

    # Biblioteken till frontenden: npm-tarbollar med hash (libs.json, samma
    # hashar som MANIFEST.md). Packas upp till libs/ och bäddas in i binären.
    pins = (lib.importJSON ./libs.json).packages;
    libs = pkgs.runCommand "pluggkompis-libs" {} (
      lib.concatMapStrings (p: let
        tgz = pkgs.fetchurl {inherit (p) url hash;};
      in ''
        mkdir -p src/${p.name}
        tar xzf ${tgz} -C src/${p.name}
        ${lib.concatStrings (lib.mapAttrsToList (from: to: ''
            install -Dm644 src/${p.name}/${from} $out/${to}
          '')
          p.files)}
      '')
      pins
      + ''
        install -Dm644 ${./assets/fonts.css} $out/fonts.css
      ''
    );

    pluggkompis = pkgs.buildGoModule {
      pname = "pluggkompis";
      version = "0.16.1";
      src = lib.cleanSource ./.;
      # Ändras go.mod: sätt lib.fakeHash, kör `nix build`, klistra in värdet.
      vendorHash = "sha256-MXye7VFLRqXHCbq8ZUJrSJQGRAiCqTqod7z2tLgy0eg=";
      postPatch = ''
        rm -rf libs
        cp -r ${libs} libs
        chmod -R u+w libs
      '';
      env.CGO_ENABLED = "0";
      ldflags = ["-s" "-w"];
      meta = {
        description = "Pluggkompis — barnens pluggapp";
        mainProgram = "pluggkompis";
      };
    };
  in {
    packages.${system} = {
      default = pluggkompis;
      inherit pluggkompis libs;
    };
    # Go-testerna körs i bygget (checkPhase); JS-logiken (web/grade.js, senare
    # matematiken i engine) med Node — bara vid bygget, ingen Node i drift.
    checks.${system} = {
      default = pluggkompis;
      js = pkgs.runCommand "pluggkompis-js-tester" {nativeBuildInputs = [pkgs.nodejs];} ''
        cp -r ${./web} web && cp -r ${./test} test
        node --test test/*.test.mjs && touch $out
      '';
    };
    devShells.${system}.default = pkgs.mkShell {
      packages = [pkgs.go pkgs.gopls pkgs.sqlite];
      env.CGO_ENABLED = "0";
    };
  };
}
