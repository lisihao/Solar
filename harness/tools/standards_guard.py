#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


HARNESS_DIR = Path(__file__).resolve().parents[1]
if str(HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR))

from verifier.standards.standards_guard import main


if __name__ == "__main__":
    raise SystemExit(main())
