# OI School Rank — pipeline entry points.
#
# Quick reference:
#   make install        ← one-time: deps + submodule
#   make video          ← full pipeline: update → snapshot → JSON → render (4K)
#   make final          ← post-produce: wrap render with title cards + music bed
#   make studio         ← Remotion live preview
#   make snapshot       ← compute snapshots only (no render)
#   make json           ← export snapshots → JSON only
#   make doctor         ← pre-flight checks (unknown contest types/provinces)
#   make update-data    ← pull upstream OIerDb data submodule
#   make compare        ← Top-100 diff between legacy & v2 formulas
#   make clean          ← remove generated artifacts
#
# Edit config.json (formula, fps, displayTopN, …) to change pipeline behaviour.

PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)
SHELL := /usr/bin/env bash

.PHONY: help install snapshot json doctor video update-data \
        studio compare clean cards final

# ─── help ────────────────────────────────────────────────────────────────────
help:  ## Show this help.
	@awk 'BEGIN {FS = ":.*##"; printf "make targets:\n"} \
	  /^[a-zA-Z][a-zA-Z0-9_-]+:.*##/ \
	  {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ─── one-time setup ──────────────────────────────────────────────────────────
install:  ## Install Python + Node deps and init the upstream submodule.
	@if [ ! -x .venv/bin/python ]; then \
	  echo "▶ creating .venv ..."; python3 -m venv .venv; \
	fi
	.venv/bin/pip install --quiet -r requirements.txt
	cd remotion && npm install --silent
	git submodule update --init data_sources/OIerDb-data-generator

# ─── pipeline atoms ──────────────────────────────────────────────────────────
update-data:  ## Pull the latest OIerDb data submodule.
	git submodule update --remote data_sources/OIerDb-data-generator

doctor:  ## Pre-flight: warn about contest types missing from month_mapping.
	@$(PY) -c "$$DOCTOR_PY"

snapshot: doctor  ## Recompute snapshots (formula = config.json default).
	$(PY) src/snapshot.py

json:  ## Convert snapshots.parquet → snapshots.json for Remotion.
	$(PY) src/export_json.py

# ─── full pipeline ───────────────────────────────────────────────────────────
video: snapshot json  ## Full pipeline → output/ranking_race.mp4 (3840×2160).
	cd remotion && npm run render

# ─── post-production (title cards + music bed) ───────────────────────────────
cards:  ## Regenerate intro/outro title cards → output/{title,end}_card.png.
	$(PY) tools/make_cards.py

final:  ## Wrap render with title cards + music bed → output/ranking_race_final.mp4.
	tools/compose.sh

# ─── studio / tools ──────────────────────────────────────────────────────────
studio:  ## Open Remotion Studio for live preview.
	cd remotion && npm run studio

compare:  ## Run the legacy ↔ v2 Top-100 diff tool.
	$(PY) tools/compare_formulas.py

# ─── cleanup ─────────────────────────────────────────────────────────────────
clean:  ## Remove rendered artifacts.
	rm -f output/ranking_race.mp4 output/snapshots.parquet
	rm -f remotion/public/snapshots.json
	rm -rf remotion/.remotion-cache

# ─── doctor implementation (kept inline to avoid an extra file) ─────────────
define DOCTOR_PY
import json, sys
from pathlib import Path
ROOT = Path(".").resolve()
sys.path.insert(0, str(ROOT / "src"))
from month_mapping import CONTEST_MONTH
contests_json = ROOT / "data_sources" / "OIerDb-data-generator" / "static" / "contests.json"
if not contests_json.exists():
    print("\033[33m⚠ data submodule not initialised — run `make install` first.\033[0m",
          file=sys.stderr); sys.exit(0)
with open(contests_json, encoding="utf-8") as f: contests = json.load(f)
unknown = sorted({c["type"] for c in contests if c["type"] not in CONTEST_MONTH})
if unknown:
    print(f"\033[33m⚠ contest types not in src/month_mapping.py: {unknown}\033[0m",
          file=sys.stderr)
    print("  add them to CONTEST_MONTH and to V2_TYPE_WEIGHTS in src/snapshot.py",
          file=sys.stderr)
else:
    print("\033[32m✓ doctor: all contest types mapped\033[0m", file=sys.stderr)
endef
export DOCTOR_PY
