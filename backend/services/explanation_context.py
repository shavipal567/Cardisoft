"""Provenance and saved evaluation metadata for the exact inference artifacts.

API validation rejects explicit nulls. Every omitted raw input is filled by
PatientInput before the fitted preprocessing pipeline sees it. These are preset
defaults, not patient measurements or training-fitted imputation statistics.
"""
import hashlib
import json

from inference import artifacts_dir


def input_context(patient):
    values = patient.to_feature_dict()
    supplied = {field.alias or key for key, field in type(patient).model_fields.items()
                if key in patient.model_fields_set}
    defaulted = [key for key in values if key not in supplied]
    provenance = {
        key: {
            "status": "recorded" if key in supplied else "default",
            "method": "explicit_input" if key in supplied else "schema_default",
            "detail": ("Explicitly supplied in this assessment. Measurement acquisition is not verified."
                       if key in supplied else
                       "The input was omitted. A predefined server default was supplied before preprocessing; "
                       "it is not an actual measurement from this patient or a fitted imputation value."),
        } for key in values
    }
    signature = hashlib.sha256(json.dumps(
        {"values": values, "supplied": sorted(supplied)}, sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    return {"effective_inputs": values, "defaulted_inputs": defaulted,
            "feature_provenance": provenance, "input_signature": signature}


def reliability_metadata(target, bundle):
    """Read existing evaluation, without computing metrics from this patient.

Historical evaluate.py used metadata.threshold (or its 0.5 default). Global
importance Jaccard is deliberately not exposed as local attribution stability.
"""
    meta = bundle.get("metadata", {})
    result = {"model_version": bundle["version"],
              "calibration_status": "unavailable",
              "external_validation": "unavailable",
              "attribution_stability": "unavailable"}
    if isinstance(meta.get("calibration"), str):
        result["calibration_method"] = meta["calibration"]
    try:
        scores = json.loads((artifacts_dir() / "metrics.json").read_text())[target]
        if scores.get("n_test") != meta.get("n_test") or not scores.get("n_test"):
            return result
        # Separate experimental/nested artifacts must supply their own evaluation.
        if meta.get("protocol") == "nested_cv":
            return result
        result.update({
            "evaluation": "Saved held-out test split",
            "n_test": scores["n_test"],
            "roc_auc": scores.get("roc_auc"),
            "source": "metrics.json and target metadata.json alongside the loaded artifacts",
        })
        evaluation_threshold = scores.get("threshold", meta.get("threshold", 0.5))
        if evaluation_threshold == bundle["threshold"]:
            result["threshold"] = evaluation_threshold
            result["sensitivity"] = scores.get("recall")
            matrix = scores.get("confusion_matrix", {})
            negatives = matrix.get("tn", 0) + matrix.get("fp", 0)
            if negatives:
                result["specificity"] = matrix["tn"] / negatives
        if "brier" in scores:
            result["brier"] = scores["brier"]
        if "cv_brier" in meta.get("best", {}):
            result["selection_cv_brier"] = meta["best"]["cv_brier"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return result
