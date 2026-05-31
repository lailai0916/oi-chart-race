"""Load the shared config.json that lives at the repository root.

Both Python and TypeScript code read the same file so the snapshot pipeline
and the Remotion renderer agree on `displayTopN`, `framesPerMonth`, etc.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config.json"


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)
