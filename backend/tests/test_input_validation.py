"""Input-dependent accuracy is measured on masked holdouts, not coverage."""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "training")]
from inference import TARGET_KEYS, get_artifact, predict_patient
from preprocessing import ALL_INPUT_FEATURES
from routes.predict import predict
from schemas import PatientInput
from services import input_validation as validation


class InputValidationTests(unittest.TestCase):
    def test_complete_inputs_reproduce_saved_held_out_accuracy(self):
        measured = validation.input_validation(set(ALL_INPUT_FEATURES))
        saved = json.loads((ROOT / "training/artifacts/metrics.json").read_text())
        self.assertEqual(measured["status"], "available")
        self.assertEqual(measured["supplied_count"], 54)
        for target, score in measured["targets"].items():
            self.assertAlmostEqual(score["accuracy"], saved[target.lower()]["accuracy"])
            self.assertAlmostEqual(score["full_input_accuracy"], score["accuracy"])
            self.assertAlmostEqual(score["recall"], saved[target.lower()]["recall"])
            self.assertEqual(score["n_test"], 61)
            self.assertEqual(score["model_version"], get_artifact(target.lower())["version"])
            self.assertLessEqual(score["accuracy_interval"]["low"], score["accuracy"])
            self.assertGreaterEqual(score["accuracy_interval"]["high"], score["accuracy"])

    def test_no_inputs_matches_constant_default_prediction_not_zero_percent_coverage(self):
        measured = validation.input_validation(set())
        result = predict_patient(PatientInput().to_feature_dict())
        saved = json.loads((ROOT / "training/artifacts/metrics.json").read_text())
        self.assertEqual(measured["supplied_count"], 0)
        for key in TARGET_KEYS:
            positive = result["cad"] if key == "cad" else result["vessels"][key.upper()]
            rate = saved[key]["pos_rate"]
            self.assertAlmostEqual(measured["targets"][key.upper()]["accuracy"],
                                   rate if positive["prediction"] else 1 - rate)

    def test_equal_field_counts_do_not_imply_equal_accuracy(self):
        age = validation.input_validation({"Age"})
        chest_pain = validation.input_validation({"Typical Chest Pain"})
        self.assertEqual(age["supplied_count"], chest_pain["supplied_count"])
        self.assertNotEqual(age["targets"]["CAD"]["accuracy"], chest_pain["targets"]["CAD"]["accuracy"])

    def test_explicit_zero_and_alias_are_supplied_and_values_do_not_change_cohort_score(self):
        first = predict(PatientInput.model_validate({"Age": 70, "DM": 0, "EF-TTE": 50}))
        second = predict(PatientInput.model_validate({"Age": 40, "DM": 1, "EF_TTE": 60}))
        self.assertEqual(first["context"]["input_validation"]["supplied_count"], 3)
        self.assertNotIn("DM", first["context"]["defaulted_inputs"])
        self.assertNotIn("EF-TTE", second["context"]["defaulted_inputs"])
        self.assertEqual(first["context"]["input_validation"], second["context"]["input_validation"])

    def test_masking_preserves_supplied_test_values_and_uses_api_defaults(self):
        validation._evaluate.cache_clear()
        original = validation._predictions
        recorded = []
        def capture(bundle, frame):
            recorded.append(frame.copy())
            return original(bundle, frame)
        # Warm the unmasked reference cohorts before recording masked predictions.
        validation.input_validation(set(ALL_INPUT_FEATURES))
        with patch.object(validation, "_predictions", side_effect=capture):
            result = validation.input_validation({"Age", "Sex"})
        self.assertEqual(result["status"], "available")
        self.assertEqual(len(recorded), 4)
        defaults = PatientInput().to_feature_dict()
        for frame in recorded:
            self.assertGreater(frame["Age"].nunique(), 1)
            self.assertGreater(frame["Sex"].nunique(), 1)
            for key in ALL_INPUT_FEATURES:
                if key not in {"Age", "Sex"}:
                    expected = str(defaults[key]) if key == "Region RWMA" else defaults[key]
                    self.assertTrue((frame[key] == expected).all(), key)

    def test_missing_validation_dataset_does_not_block_prediction(self):
        with patch.object(validation, "DATASET", ROOT / "dataset/missing-validation.csv"), \
                self.assertLogs(validation.logger, level="WARNING"):
            result = predict(PatientInput(Age=58))
        self.assertEqual(result["context"]["input_validation"]["status"], "unavailable")
        self.assertTrue(0 <= result["cad"]["probability"] <= 1)

    def test_intervals_cover_extreme_counts_and_known_half_success_case(self):
        self.assertAlmostEqual(validation.wilson_interval(0, 61)["low"], 0)
        self.assertAlmostEqual(validation.wilson_interval(61, 61)["high"], 1)
        middle = validation.wilson_interval(50, 100)
        np.testing.assert_allclose([middle["low"], middle["high"]], [0.40383153, 0.59616847], atol=1e-8)


if __name__ == "__main__":
    unittest.main()
