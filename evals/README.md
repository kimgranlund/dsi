# evals

Evaluation suites in the format of the `context:evaluation-system` skill (suite, cases, graders, gates). Generated run output goes to `.cache/eval/` (gitignored).

## classifier

- **Target:** the naming-term classifier (`packages/classify`), read from `data/classified` by `classifier/target.py`.
- **Cases:** every approved exact or close mapping (`classifier/build.py` writes `cases.jsonl`; 80% dev, 20% holdout by a hash of product and token). Cases change in the same commit as the mappings and terms they come from.
- **Grader:** exact on `concept`.
- **Gates** (`classifier/gates.yaml`): one per product and `all`, on the dev split. Each threshold is the 2026-11-01 baseline pass count less max(1, 2% of n). Action: push and deploy. Owner: kimgranlund.

Run before every push and deploy:

```
sh evals/run.sh        # exit 1 when a gate fails; report in .cache/eval/run/report.md
```

Baseline (dev, 2026-11-01): 447 of 857 pass (0.52, Wilson 0.49 to 0.55). Misses are mostly concepts the classifier does not decide alone: emphasis by contrast rank, and names with words that have no approved term yet. The gate guards against regressions, not this ceiling.

Negative control (2026-11-01): removing Atlassian's approved term `danger` dropped the Atlassian slice from 0.79 to 0.76 and failed its gate.

To re-baseline after an intended change, regenerate `gates.yaml` from a dev run and say why in the commit. Tune terms on dev failures only; holdout runs (`--split holdout`) are logged by the runner.
