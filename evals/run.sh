#!/bin/sh
# Golden-set regression gate (evaluation-system skill). Rebuilds the cases from approved mappings, runs the
# classifier suite on the dev split and exits 1 when a gate fails. Run before push and deploy.
set -e
cd "$(dirname "$0")/.."
EVAL=${EVAL_SKILL:-$HOME/.claude/plugins/cache/nonoun/context/0.6.0/skills/evaluation-system/scripts}
PY=.cache/eval/venv/bin/python
[ -x "$PY" ] || { python3 -m venv .cache/eval/venv && $PY -m pip install -q pyyaml==6.0.2; }
python3 -I evals/classifier/build.py
$PY "$EVAL/validate_suite.py" evals/classifier/suite.yaml --gates evals/classifier/gates.yaml
$PY "$EVAL/run_suite.py" evals/classifier/suite.yaml --target "python3 -I evals/classifier/target.py" --split dev --gates evals/classifier/gates.yaml --out .cache/eval/run --strict
