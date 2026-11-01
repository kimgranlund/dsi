#!/usr/bin/env python3
"""Build the classifier gold suite's cases from approved mappings (the gold set) and an index of the
classifier's current output. Run from the repo root: python3 -I evals/classifier/build.py
Cases change in the same commit as the mappings they come from (evaluation-system: drift is a defect)."""
import hashlib, json, pathlib
R = pathlib.Path(__file__).resolve().parents[2]
E = R / 'evals' / 'classifier'
cases, index = [], {}
for src in sorted((R / 'sources').glob('*/source.json')):
    p = src.parent.name
    v = json.loads(src.read_text())['package']['version']
    mf = R / 'mappings' / p / f'{v}.mappings.json'
    cf = R / 'data' / 'classified' / p / f'{v}.json'
    if not mf.exists() or not cf.exists():
        continue
    for t in json.loads(cf.read_text())['tokens']:
        index[f'{p}|{t["token"]}'] = {'concept': t.get('concept'), 'explained': t.get('explained')}
    for m in json.loads(mf.read_text())['mappings']:
        if m['status'] != 'approved' or m['match'] not in ('exact', 'close'):
            continue
        domain = m['concept'].split('/')[1]
        r = m.get('review') or {}
        h = int(hashlib.sha1(f'{p}|{m["token"]}'.encode()).hexdigest(), 16)
        cases.append({
            'id': f'{p}--{m["token"]}', 'input': {'product': p, 'token': m['token']},
            'expected': {'concept': m['concept']}, 'tags': [p, domain, m['match']], 'source': 'production',
            'added_because': f'approved mapping {m["id"]} ({r.get("by", "?")}, {str(r.get("at", ""))[:10]})',
            'split': 'holdout' if h % 5 == 0 else 'dev', 'added_at': str(r.get('at', ''))[:10] or None,
        })
cases.sort(key=lambda c: c['id'])
(E / 'cases.jsonl').write_text(''.join(json.dumps(c, ensure_ascii=False) + '\n' for c in cases))
cache = R / '.cache' / 'eval'
cache.mkdir(parents=True, exist_ok=True)
(cache / 'classified-index.json').write_text(json.dumps(index))
print(f'{len(cases)} cases, {len(index)} classified tokens indexed')
