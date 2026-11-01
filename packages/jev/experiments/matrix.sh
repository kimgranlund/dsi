#!/bin/sh
# Run every experiment in this folder (cached calls are free), then compare them. Usage: matrix.sh [--offline]
cd "$(dirname "$0")/../../.." || exit 1
names=""
for f in packages/jev/experiments/e*.json; do
  node packages/jev/src/lab.ts run "$f" "$@" >/dev/null 2>&1 || echo "failed: $f"
  names="$names $(basename "$f" .json)"
done
node packages/jev/src/lab.ts compare $names 2>/dev/null
