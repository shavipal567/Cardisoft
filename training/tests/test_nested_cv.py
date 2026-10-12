"""Leakage boundaries, grouped sampling, calibration and frozen inference contracts."""

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import log_loss
from sklearn.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inference
import train as nested
from calibration import CalibratedBinaryModel, FeatureSchema, ProbabilityCalibrator
from clinical_metrics import binary_metrics, calibration_metrics, operating_thresholds
from experiment_report import fast_repeat_metrics, paired_bootstrap
from preprocessing import NUMERIC_FEATURES, split_features_target


class NestedCVTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = pd.read_csv(nested.HERE.parent / "dataset/dataset.csv")
        cls.X, cls.y = split_features_target(cls.df, "Cath", "CAD")
        cls.config = json.loads(nested.NESTED_DEFAULT_CONFIG.read_text())
        cls.config.update(seeds=[42], outer_folds=2, inner_folds=2, calibration_folds=2,
                          max_iterations=8, iteration_candidates=[2, 4, 6],
                          early_stopping_rounds=2, thread_count=1, search_jobs=1,
                          bootstrap_samples=5, permutation_repeats=1)
        cls.config["baseline"]["iterations"] = 8
        cls.config["candidates"] = cls.config["candidates"][:2]

    def test_metric_math_threshold_ties_and_prevalence_comparator(self):
        y = np.array([0, 0, 1, 1, 1])
        p = np.array([.1, .6, .2, .5, .9])
        result = binary_metrics(y, p, .5)
        self.assertEqual([result[k] for k in ["tn", "fp", "fn", "tp"]], [1, 1, 1, 2])
        self.assertAlmostEqual(result["f2"], 10 / 15)
        self.assertAlmostEqual(result["specificity"], .5)
        self.assertAlmostEqual(result["log_loss"], log_loss(y, p))
        all_positive = binary_metrics(y, np.repeat(y.mean(), len(y)))
        self.assertAlmostEqual(all_positive["f2"], 15 / 17)
        self.assertEqual(all_positive["specificity"], 0)
        self.assertIsNone(all_positive["calibration_slope"])
        thresholds = operating_thresholds(y, p, [.95], [.9])
        self.assertGreaterEqual(binary_metrics(y, p, thresholds["sensitivity_0.95"])["sensitivity"], .95)
        self.assertGreaterEqual(binary_metrics(y, p, thresholds["specificity_0.9"])["specificity"], .9)

    def test_grouping_preserves_patients_and_duplicates_and_rejects_unknown_targets(self):
        df = pd.concat([self.df, self.df.iloc[[0]]], ignore_index=True)
        df["patient_id"] = np.arange(len(df)) // 2
        X, y = split_features_target(df, "Cath", "CAD")
        groups, audit = nested.audit_and_groups(df, X, y)
        self.assertEqual(groups[0], groups[-1])
        self.assertTrue(audit["grouped_splits"])
        for tr, va in nested.cv_splits(y, groups, 5, 42):
            self.assertFalse(set(groups[tr]) & set(groups[va]))
        df.loc[0, "Cath"] = "Unknown"
        with self.assertRaisesRegex(ValueError, "implicit relabeling"):
            nested.audit_and_groups(df, X, y)

    def test_quasi_separated_calibration_reports_undefined_slope(self):
        result = calibration_metrics(np.array([0, 0, 1, 1]), np.array([.1, .5, .5, .9]))
        self.assertIsNone(result["calibration_slope"])
        self.assertIsNone(result["calibration_intercept"])
        self.assertAlmostEqual(result["calibration_in_large"], 0., places=10)

    def test_inner_preprocessing_calibration_and_stopping_never_see_outer_rows(self):
        outer_train, outer_test = nested.cv_splits(self.y, None, 5, 42)[0]
        X, y = self.X.iloc[outer_train], self.y.iloc[outer_train]
        forbidden = set(self.X.index[outer_test])
        calls = []
        original = nested.fit_base

        def checked_fit(Xfit, yfit, *args, **kwargs):
            self.assertFalse(set(Xfit.index) & forbidden)
            if kwargs.get("validation") is not None:
                Xvalid = kwargs["validation"][0]
                self.assertFalse(set(Xvalid.index) & forbidden)
                self.assertFalse(set(Xfit.index) & set(Xvalid.index))
            pre, model = original(Xfit, yfit, *args, **kwargs)
            np.testing.assert_allclose(pre.named_transformers_["num"].named_steps["imputer"].statistics_,
                                       Xfit[NUMERIC_FEATURES].median().to_numpy())
            self.assertEqual(model.params["counter_calc_method"], "SkipTest")
            calls.append(set(Xfit.index))
            return pre, model

        with tempfile.TemporaryDirectory() as tmp, patch.object(nested, "fit_base", side_effect=checked_fit):
            selection = nested.select_inner(X, y, None, self.config, 42, tmp)
            method, calibrators, thresholds = nested.select_calibration(
                X, y, None, selection, self.config, 42, tmp)
            manifest = json.loads((Path(tmp) / "calibration_splits.json").read_text())
            for fold in manifest:
                valid = set(fold["validation_rows"])
                self.assertFalse(valid & set(fold["calibrator_rows"]))
                for sub in fold["subfolds"]:
                    self.assertFalse(valid & (set(sub["train_rows"]) | set(sub["validation_rows"])))
                    self.assertFalse(set(sub["train_rows"]) & set(sub["validation_rows"]))
            self.assertEqual(len(selection.raw_oof), len(X))
            self.assertTrue(np.isfinite(selection.raw_oof).all())
            self.assertIn(method, calibrators)
            self.assertEqual(thresholds["fixed_0.5"], .5)
            self.assertGreaterEqual(len(calls), 10)

    def test_iteration_search_scores_actual_refits_not_long_model_prefixes(self):
        X, y = self.X.iloc[:160], self.y.iloc[:160]
        with tempfile.TemporaryDirectory() as tmp:
            selection = nested.select_inner(X, y, None, self.config, 42, tmp)
            scores = pd.read_csv(Path(tmp) / "inner_search.csv")
            for candidate in self.config["candidates"]:
                losses = []
                for tr, va in nested.cv_splits(y, None, self.config["inner_folds"], 42):
                    pre, model = nested.fit_base(X.iloc[tr], y.iloc[tr],
                        {**candidate["params"], "iterations": 4}, self.config, 42)
                    losses.append(log_loss(y.iloc[va], model.predict_proba(pre.transform(X.iloc[va]))[:, 1]))
                stored = scores[(scores.candidate == candidate["name"]) & (scores.iterations == 4)].iloc[0]
                self.assertAlmostEqual(stored.inner_validation_log_loss_mean, np.mean(losses), places=12)
            expected, _ = nested.fixed_oof(X, y, None,
                {**selection.params, "iterations": selection.iterations}, self.config, 42, self.config["inner_folds"])
            np.testing.assert_allclose(selection.raw_oof, expected, atol=1e-12, rtol=1e-12)

    def test_calibration_serialization_schema_and_existing_inference_match(self):
        params = {"iterations": 6, "depth": 2, "learning_rate": .05}
        pre, base = nested.fit_base(self.X, self.y, params, self.config, 42)
        # Independent synthetic calibration scores; this test concerns persistence, not performance.
        p = np.linspace(.1, .9, 60)
        labels = (np.arange(60) % 3 != 0).astype(int)
        for method in ["raw", "sigmoid", "isotonic"]:
            cal = ProbabilityCalibrator(method).fit(p, labels)
            model = CalibratedBinaryModel(base, cal, threshold=.37)
            pipeline = Pipeline([("schema", FeatureSchema().fit(self.X)),
                                 ("preprocessor", pre), ("classifier", model)])
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "pipeline.joblib"
                joblib.dump(pipeline, path)
                restored = joblib.load(path)
                expected = model.predict_proba(pre.transform(self.X.iloc[:4]))
                np.testing.assert_allclose(restored.predict_proba(self.X.iloc[:4, ::-1]), expected)
                np.testing.assert_allclose(expected.sum(axis=1), 1.)
                with self.assertRaisesRegex(ValueError, "Missing model inputs"):
                    restored.predict_proba(self.X.drop(columns="Age"))
                bundle = {key: {"prep": pre, "model": model, "threshold": .37} for key in inference.TARGET_KEYS}
                with patch.object(inference, "_load_all", return_value=bundle):
                    actual = inference.predict_patient(self.X.iloc[0].to_dict())
                self.assertAlmostEqual(actual["cad"]["probability"], expected[0, 1])
                self.assertEqual(actual["cad"]["prediction"], int(expected[0, 1] >= .37))

    def test_bootstrap_keeps_repeats_paired_and_matches_metric_definitions(self):
        y = np.array([0, 1, 0, 1, 1, 0])
        p = np.array([.2, .8, .3, .5, .7, .9])
        fast = fast_repeat_metrics(y, np.array([p, p]), np.full((2, len(y)), .5))
        normal = binary_metrics(y, p)
        for metric in fast:
            self.assertAlmostEqual(fast[metric], normal[metric])
        rows = [{"variant": variant, "seed": seed, "row_index": i, "group": i,
                 "y": int(label), "probability": prob, "threshold": .5}
                for variant in ["baseline", "raw", "selected"] for seed in [42, 43]
                for i, (label, prob) in enumerate(zip(y, p))]
        result = paired_bootstrap(pd.DataFrame(rows), 20, 42)
        for metric, value in result["paired_differences"]["selected_minus_baseline"].items():
            self.assertEqual(value["estimate"], 0.)
            self.assertEqual(value["ci95"], [0., 0.])


if __name__ == "__main__":
    unittest.main()
