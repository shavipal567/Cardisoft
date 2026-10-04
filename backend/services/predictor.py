"""Thin wrapper over training/inference.py (frozen artifacts, no fitting)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "training"))

from inference import available, predict_patient  # noqa: E402

__all__ = ["available", "predict_patient"]
