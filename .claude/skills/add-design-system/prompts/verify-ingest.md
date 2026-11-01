# Verify-ingest brief (second derivation)

Independent check for DesignSystemsIndex (repo /Users/kimba/Projects/design-system-index). Read-only in the repo; write scripts and output only under {scratch}. Never execute package JavaScript (no require/import of package code); reading files as text and parsing CSS/JSON is fine.

We ingested {product} {version} into DTCG under data/native/{product}/{version}/ (manifest.json lists files and themes; each token has $value, literal or {alias}, and $extensions["io.nonoun.dsi"] with nativeName, theme, rawValue). A theme resolves its theme file over the base files; manifest themeExtends falls back to a parent theme. The repo resolver is packages/resolve/src/native.ts (loadNative, resolve); you may use it from a script.

Derive values a second, independent way from the package's OWN shipped consumer output (cached under .cache/npm/): {consumer}. Compare every token in every theme that output covers, by native name. Normalize colors (hex case, rgba vs hex8, hsl), dimensions (rem vs px at 16px) and durations before comparing.

Report under 400 words: tokens compared, matches, mismatches, missing-in-ours, extra-in-ours; then the top mismatch patterns with 2 examples each (token, theme, ours, shipped). Mark anything you could not check.
