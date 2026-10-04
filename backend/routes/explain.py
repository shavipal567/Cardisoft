from fastapi import APIRouter, HTTPException

from schemas import ExplainRequest
from services.explainer import explain_patient
from services.predictor import available

router = APIRouter()


@router.post("/explain")
def explain(req: ExplainRequest):
    if not available():
        raise HTTPException(status_code=503, detail="Model artifacts not found. Run training/train.py first.")
    try:
        return explain_patient(req.features.to_feature_dict(), req.target, req.top_k)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Explanation failed: {e}")
