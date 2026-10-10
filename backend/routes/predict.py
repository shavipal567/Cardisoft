from fastapi import APIRouter, HTTPException

from schemas import PatientInput
from services.predictor import available, predict_patient
from inference import get_artifact, TARGET_KEYS
from model_info import MODEL_NAMES

router = APIRouter()


@router.post("/predict")
def predict(patient: PatientInput):
    if not available():
        raise HTTPException(status_code=503, detail="Model artifacts not found. Run training/train.py first.")
    try:
        features = patient.to_feature_dict()
        result = predict_patient(features)
        supplied = {field.alias or key for key, field in PatientInput.model_fields.items()
                    if key in patient.model_fields_set}
        result["context"] = {
            "effective_inputs": features,
            "defaulted_inputs": [key for key in features if key not in supplied],
            "models": {key.upper(): {
                "name": MODEL_NAMES.get(get_artifact(key)["model_kind"], type(get_artifact(key)["model"]).__name__),
                "version": get_artifact(key)["version"],
                "training_revision": get_artifact(key)["training_git_hash"],
            } for key in TARGET_KEYS},
        }
        return result
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Inference failed: {e}")
