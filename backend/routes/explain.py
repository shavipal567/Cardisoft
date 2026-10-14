from fastapi import APIRouter, HTTPException

from schemas import ExplainRequest
from services.explainer import explain_patient
from services.predictor import available
from inference import get_artifact
from services.explanation_context import input_context, reliability_metadata

router = APIRouter()


@router.post("/explain")
def explain(req: ExplainRequest):
    if not available():
        raise HTTPException(status_code=503, detail="Prediction model artifacts are unavailable.")
    try:
        result = explain_patient(req.features.to_feature_dict(), req.target, req.top_k)
        bundle = get_artifact(req.target)
        context = input_context(req.features)
        result["model_version"] = bundle["version"]
        result["input_signature"] = context["input_signature"]
        result["reliability"] = reliability_metadata(req.target, bundle)
        for feature in result["features"]:
            feature["provenance"] = context["feature_provenance"].get(feature["name"])
        return result
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Explanation failed: {e}")
