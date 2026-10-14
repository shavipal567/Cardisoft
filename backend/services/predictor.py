"""Thin wrapper over the backend's self-contained inference runtime."""

from inference import available, predict_patient

__all__ = ["available", "predict_patient"]
