#!/usr/bin/env bash
# The whole build, in order. Needs: an Al-Heb checkout (APP), the models (scripts/fetch_models.py), Python deps
# (requirements.txt) and Node 22. Everything is resumable: a step that already wrote its result is skipped.
#   APP=../../../Al-Heb UNITS="pu-greetings pu-cafe pu-family" bash scripts/run_all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${APP:?set APP to an Al-Heb checkout}"
UNITS="${UNITS:-pu-greetings pu-cafe pu-family}"
LIMIT="${LIMIT:-25}"
GEN="${GEN:-gen-1.7b}"
JUDGES="${JUDGES:-judge:judge-1.7b-thinking judge:judge-dictalm2}"
W=work
CAN=tests/judge_canaries.json

echo "== 1. example sentences"
python scripts/gen_examples.py --app "$APP" --units $UNITS --limit "$LIMIT" --model "$GEN" --out $W/examples.jsonl
python scripts/judge.py --in $W/examples.jsonl --type example --canaries $CAN --stop-early --stages morph roundtrip $JUDGES offensive
python scripts/gate.py --app "$APP" --work $W

echo "== 2. quiz items"
python scripts/gen_quiz.py --app "$APP" --from-examples src/examples --lines --out $W/quiz.jsonl
python scripts/judge.py --in $W/quiz.jsonl --type quiz --stop-early --stages $JUDGES offensive

echo "== 3. Ask the Torah: Hebrew wordings of checked questions, and new answers"
python scripts/gen_ask.py --app "$APP" --hebrew-wordings --model "$GEN" --out $W/ask-wordings.jsonl
python scripts/judge.py --in $W/ask-wordings.jsonl --type ask-wording --stop-early --stages $JUDGES offensive
node scripts/unanswered.mjs --app "$APP" --in prompts/ask_seeds.json --out $W/ask_seeds.todo.json
python scripts/gen_ask.py --app "$APP" --new-answers $W/ask_seeds.todo.json --out $W/ask.jsonl
python scripts/judge.py --in $W/ask.jsonl --type ask --stages $JUDGES
python scripts/gate.py --app "$APP" --work $W

echo "== 4. search index and its eval"
python scripts/embed.py --app "$APP" --dist src --out $W/search.docs.json
node scripts/build_search.mjs --work $W --out src/search --version 1
node scripts/eval_search.mjs --index src/search --json $W/search-eval.json

echo "== 5. dist/ (from the repo root)"
(cd ../.. && node scripts/build-dist.mjs)
