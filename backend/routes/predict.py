from fastapi import APIRouter, HTTPException

from schemas import PatientInput
from services.predictor import available, predict_patient

router = APIRouter()


@router.post("/predict")
def predict(patient: PatientInput):
    if not available():
        raise HTTPException(status_code=503, detail="Model artifacts not found. Run training/train.py first.")
    try:
        return predict_patient(patient.to_feature_dict())
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Inference failed: {e}")
