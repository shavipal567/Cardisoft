"""Report evaluation metadata for the configured saved artifacts."""
from fastapi import APIRouter, HTTPException
from services.predictor import available
from model_info import model_info

router = APIRouter()


@router.get("/model-info")
def get_model_info():
    if not available():
        raise HTTPException(status_code=503, detail="Model artifacts are unavailable.")
    try:
        return model_info()
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Model evaluation metadata is unavailable.") from exc
