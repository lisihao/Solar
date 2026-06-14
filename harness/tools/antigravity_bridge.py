#!/usr/bin/env python3
"""CLI wrapper for the Antigravity desktop bridge adapter."""
from __future__ import annotations

import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from antigravity_bridge import main


if __name__ == "__main__":
    raise SystemExit(main())
