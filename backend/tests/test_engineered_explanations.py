"""Derived features must be recomputed when explaining a raw input change."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "training")]
import inference
from preprocessing import ALL_INPUT_FEATURES, build_preprocessor, split_features_target
from services import explainer


class EngineeredExplanationTests(unittest.TestCase):
    def test_raw_paths_recompute_composites_and_preserve_prediction_and_additivity(self):
        df = pd.read_csv(ROOT / "dataset/dataset.csv")
        X, y = split_features_target(df, "Cath", "CAD")
        pre = build_preprocessor("ratios_counts_logs").fit(X.iloc[:200])
        model = RandomForestClassifier(n_estimators=8, max_depth=3, random_state=42).fit(
            pre.transform(X.iloc[:200]), y.iloc[:200])
        bundle = {"prep": pre, "model": model, "threshold": .5}
        patient = X.iloc[210].to_dict()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "cad").mkdir()
            joblib.dump(X.iloc[:8], root / "cad/shap_raw_background.joblib")
            with patch.object(explainer, "artifacts_dir", return_value=root), \
                    patch.object(explainer, "get_artifact", return_value=bundle), \
                    patch.object(inference, "_load_all", return_value={k: bundle for k in inference.TARGET_KEYS}), \
                    patch.object(explainer, "BACKGROUND_ROWS", 4), patch.object(explainer, "ORDER_PAIRS", 2):
                result = explainer.explain_patient(patient, "cad", 60)
                prediction = inference.predict_patient(patient)["cad"]["probability"]
                self.assertAlmostEqual(result["probability"], prediction, places=12)
                self.assertAlmostEqual(result["base_value"] + sum(r["contribution"] for r in result["features"]),
                                       prediction, places=12)
                self.assertEqual({r["name"] for r in result["features"]}, set(ALL_INPUT_FEATURES))
                for row in result["features"]:
                    self.assertEqual(row["raw_value"], patient[row["name"]])
                again = explainer.explain_patient(patient, "cad", 3)
                self.assertAlmostEqual(again["base_value"] + again["remaining_contribution"]
                    + sum(r["contribution"] for r in again["features"]), prediction, places=12)

        class RecordingModel:
            def predict_proba(self, values):
                self.values = values
                return np.tile([.5, .5], (len(values), 1))

        recording = RecordingModel()
        adapter = explainer.RawPredictionModel(pre, recording)
        changed = X.iloc[:2].copy()
        changed.iloc[1] = changed.iloc[0]
        changed.loc[changed.index[1], "TG"] *= 2
        adapter.predict_proba(changed.to_numpy())
        names = pre.get_feature_names_out().tolist()
        for feature in ["num__TG_HDL_ratio", "num__log1p_TG"]:
            position = names.index(feature)
            self.assertNotEqual(recording.values[0, position], recording.values[1, position])


if __name__ == "__main__":
    unittest.main()
