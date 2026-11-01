#!/usr/bin/env python3
"""Target adapter: one case input ({product, token}) on stdin, the classifier's concept on stdout.
Reads the index build.py writes from data/classified (the classifier's committed output)."""
import json, pathlib, sys
idx = json.loads((pathlib.Path(__file__).resolve().parents[2] / '.cache' / 'eval' / 'classified-index.json').read_text())
case = json.load(sys.stdin)
inp = case.get('input', case)
hit = idx.get(f'{inp["product"]}|{inp["token"]}') or {}
# Only a whole-name explanation counts as the classifier's answer (packages/classify: explained = 1).
json.dump({'concept': hit.get('concept') if hit.get('explained') == 1 else None}, sys.stdout)
