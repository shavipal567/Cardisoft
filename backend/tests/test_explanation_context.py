"""Explainability contracts: identity, provenance, threshold and real evaluation."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "training")]
import inference
from routes.explain import explain
from routes.predict import predict
from schemas import ExplainRequest, PatientInput
from services.explanation_context import input_context, reliability_metadata


class ExplanationContextTests(unittest.TestCase):
    def test_provenance_tracks_explicit_zero_and_aliases_not_value_equality(self):
        defaults = input_context(PatientInput())
        recorded = input_context(PatientInput(DM=0, EF_TTE=50, Sex="Female"))
        self.assertEqual(recorded["feature_provenance"]["DM"]["status"], "recorded")
        self.assertEqual(recorded["feature_provenance"]["EF-TTE"]["status"], "recorded")
        self.assertEqual(recorded["feature_provenance"]["ESR"]["status"], "default")
        self.assertEqual(recorded["feature_provenance"]["ESR"]["method"], "schema_default")
        self.assertEqual(defaults["effective_inputs"]["DM"], recorded["effective_inputs"]["DM"])
        self.assertNotEqual(defaults["input_signature"], input_context(PatientInput(DM=0))["input_signature"])
        self.assertEqual(recorded["input_signature"], input_context(PatientInput(**{"Sex": "Female", "EF-TTE": 50, "DM": 0}))["input_signature"])

    def test_prediction_and_explanation_share_identity_values_and_actual_threshold(self):
        patient = PatientInput(Age=65, DM=0, Sex="Female")
        prediction = predict(patient)
        for target in inference.TARGET_KEYS:
            with self.subTest(target=target):
                e = explain(ExplainRequest(features=patient, target=target, top_k=60))
                p = prediction["cad"] if target == "cad" else prediction["vessels"][target.upper()]
                bundle = inference.get_artifact(target)
                self.assertEqual(p["threshold"], bundle["threshold"])
                self.assertEqual(p["prediction"], int(p["probability"] >= p["threshold"]))
                self.assertEqual(e["input_signature"], prediction["context"]["input_signature"])
                self.assertEqual(e["model_version"], prediction["context"]["models"][target.upper()]["version"])
                self.assertEqual(e["output_space"], "probability")
                self.assertAlmostEqual(e["output_value"], p["probability"], places=10)
                self.assertAlmostEqual(e["base_value"] + sum(f["contribution"] for f in e["features"])
                                       + e["remaining_contribution"], p["probability"], places=10)
                for f in e["features"]:
                    self.assertEqual(f["raw_value"], prediction["context"]["effective_inputs"][f["name"]])
                    self.assertEqual(f["provenance"], prediction["context"]["feature_provenance"][f["name"]])

    def test_nonstandard_threshold_is_the_same_one_used_to_classify(self):
        bundles = {k: {**inference.get_artifact(k), "threshold": .97} for k in inference.TARGET_KEYS}
        with patch.object(inference, "_load_all", return_value=bundles):
            output = inference.predict_patient(PatientInput().to_feature_dict())
        for p in [output["cad"], *output["vessels"].values()]:
            self.assertEqual(p["threshold"], .97)
            self.assertEqual(p["prediction"], int(p["probability"] >= .97))

    def test_reliability_uses_saved_cohort_metrics_and_not_global_stability(self):
        bundle = inference.get_artifact("rca")
        result = reliability_metadata("rca", bundle)
        saved = json.loads((inference.artifacts_dir() / "metrics.json").read_text())["rca"]
        self.assertEqual(result["roc_auc"], saved["roc_auc"])
        self.assertEqual(result["n_test"], saved["n_test"])
        self.assertEqual(result["sensitivity"], saved["recall"])
        matrix = saved["confusion_matrix"]
        self.assertEqual(result["specificity"], matrix["tn"] / (matrix["tn"] + matrix["fp"]))
        self.assertEqual(result["selection_cv_brier"], bundle["metadata"]["best"]["cv_brier"])
        self.assertEqual(result["attribution_stability"], "unavailable")
        self.assertEqual(result["calibration_status"], "unavailable")
        self.assertNotIn("brier", result)

    def test_missing_or_unrelated_evaluation_stays_unavailable(self):
        bundle = inference.get_artifact("rca")
        with tempfile.TemporaryDirectory() as tmp, patch("services.explanation_context.artifacts_dir", return_value=Path(tmp)):
            self.assertNotIn("roc_auc", reliability_metadata("rca", bundle))
            (Path(tmp) / "metrics.json").write_text(json.dumps({"rca": {"n_test": 999, "roc_auc": .99}}))
            self.assertNotIn("roc_auc", reliability_metadata("rca", bundle))


if __name__ == "__main__":
    unittest.main()
