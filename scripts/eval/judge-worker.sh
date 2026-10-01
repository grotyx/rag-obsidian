#!/bin/bash
# usage: judge-worker.sh <list of qids>   (run from repo root) — one opencode call per question.
# Launch each worker in a visible terminal tab (e.g. `orca terminal create … --command`), not in the background.
MODEL=${MODEL:-opencode-go/deepseek-v4.1-flash}
mkdir -p _eval/judge/out
while read -r q <&3; do
  [ -z "$q" ] && continue; [ -s "_eval/judge/out/$q.json" ] && continue
  for t in 1 2 3; do
    opencode run --model "$MODEL" "$(cat _eval/judge/prompts/$q.txt)" < /dev/null 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' > "_eval/judge/out/$q.raw"
    python3 - "$q" <<'PY' && { echo "$(date +%T) ok $q"; break; }
import json,re,sys; q=sys.argv[1]; s=open(f"_eval/judge/out/{q}.raw").read(); m=re.search(r"\{[\s\S]*\}", s)
d=json.loads(m.group(0)); assert all(v in (0,1,2) for v in d.values()); json.dump(d,open(f"_eval/judge/out/{q}.json","w"))
PY
    echo "$(date +%T) retry $t $q"
  done
done 3< "$1"
echo "JUDGE WORKER DONE"
