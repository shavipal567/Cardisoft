"""Feature arithmetic, fold boundaries, and saved training/inference contracts."""

import contextlib
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.model_selection import StratifiedKFold
from sklearn.tree import DecisionTreeClassifier

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "training"))
import inference
import train
from ensemble_cv import out_of_fold_probabilities
from preprocessing import (ALL_INPUT_FEATURES, DEFAULT_FEATURE_SETS, ENGINEERED_FEATURES,
    FEATURE_SETS, LEAKAGE_COLUMNS, NATIVE_CAT_FEATURES, NumericFeatureEngineer,
    build_native_preprocessor, build_preprocessor, build_voting_preprocessor,
    clean_dataframe, engineer_features, engineered_feature_names, native_cat_indices,
    numeric_feature_names, resolve_feature_set, split_features_target)


class FeatureEngineeringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = pd.read_csv(ROOT / "dataset/dataset.csv")
        cls.X, cls.y = split_features_target(cls.df, "Cath", "CAD")

    def test_matches_executed_analysis_without_targets(self):
        expected = pd.read_csv(ROOT / "dataset/engineered_feature_analysis/engineered_features.csv",
                               index_col="row_index")
        before = self.X.copy(deep=True)
        actual = engineer_features(self.X)
        pd.testing.assert_frame_equal(actual, expected, check_names=False, check_dtype=False)
        pd.testing.assert_frame_equal(before, self.X)
        altered = self.df.copy()
        altered[LEAKAGE_COLUMNS] = "changed"
        pd.testing.assert_frame_equal(engineer_features(altered), actual)

    def test_invalid_and_missing_operands_are_not_zero_counts_or_infinite_ratios(self):
        raw = self.X.iloc[:4].copy()
        raw.loc[raw.index[0], ["HDL", "Lymph"]] = 0
        raw.loc[raw.index[1], ["DLP", "Q Wave"]] = np.nan
        raw.loc[raw.index[2], ["TG", "DM"]] = -1
        raw["FBS"] = raw["FBS"].astype(float)
        raw.loc[raw.index[3], "FBS"] = np.inf
        features = engineer_features(raw)
        self.assertTrue(features.iloc[0, :3].isna().all())
        self.assertTrue(features.iloc[1][["risk_factor_count", "ecg_finding_count"]].isna().all())
        self.assertTrue(features.iloc[2][["TG_HDL_ratio", "log1p_TG", "risk_factor_count"]].isna().all())
        self.assertTrue(pd.isna(features.iloc[3].log1p_FBS))
        self.assertFalse(np.isinf(features.to_numpy()).any())

    def test_every_track_clones_serializes_and_labels_transformed_columns(self):
        for feature_set in FEATURE_SETS:
            for builder in [build_preprocessor, build_native_preprocessor, build_voting_preprocessor]:
                with self.subTest(feature_set=feature_set, track=builder.__name__):
                    pre = clone(builder(feature_set)).fit(self.X.iloc[:200])
                    values = pre.transform(self.X.iloc[200:])
                    names = pre.get_feature_names_out()
                    self.assertEqual(values.shape[1], len(names))
                    self.assertTrue(np.isfinite(values).all())
                    self.assertFalse(any(name.split("__")[-1] in LEAKAGE_COLUMNS for name in names))
                    for feature in engineered_feature_names(feature_set):
                        self.assertTrue(any(name.endswith("__" + feature) for name in names))
                    if "logs" in feature_set:
                        self.assertNotIn("num__TG", names)
                        self.assertIn("num__log1p_TG", names)
                    buffer = io.BytesIO()
                    joblib.dump(pre, buffer)
                    buffer.seek(0)
                    np.testing.assert_allclose(joblib.load(buffer).transform(self.X.iloc[200:]), values)

    def test_missing_derived_columns_do_not_shift_native_categorical_indices(self):
        raw = self.X.iloc[:60].copy()
        raw["HDL"] = 0
        # Keep the categorical DLP branch populated, while numeric risk_count is
        # entirely missing because DM is absent across this training fold.
        raw["DLP"] = "N"
        raw["DM"] = np.nan
        for feature_set in ["counts", "ratios_counts", "ratios_counts_logs"]:
            pre = build_native_preprocessor(feature_set).fit(raw)
            values = pre.transform(self.X.iloc[60:65])
            start = len(numeric_feature_names(feature_set))
            self.assertEqual(native_cat_indices(feature_set), list(range(start, start + 21)))
            self.assertEqual(values.shape[1], start + len(NATIVE_CAT_FEATURES))
            np.testing.assert_array_equal(values[:, start:], np.floor(values[:, start:]))
            self.assertTrue(np.isfinite(values).all())

    def test_inner_ensemble_folds_fit_engineering_and_imputation_on_training_rows(self):
        X, y = self.X.iloc[:90], self.y.iloc[:90]
        seen = []
        original = NumericFeatureEngineer.fit

        def record(engineer, raw, labels=None):
            seen.append(tuple(raw.index))
            return original(engineer, raw, labels)

        pre = build_voting_preprocessor("ratios_counts_logs")
        with patch.object(NumericFeatureEngineer, "fit", record):
            result = out_of_fold_probabilities(
                [("tree", DecisionTreeClassifier(max_depth=2, random_state=42))],
                X, y, cv=3, seed=42, preprocessor=pre)
        expected = [tuple(X.index[tr]) for tr, _ in StratifiedKFold(3, shuffle=True,
                    random_state=42).split(X, y)]
        self.assertEqual(seen, expected)
        self.assertEqual(result.shape, (90, 1))
        self.assertFalse(hasattr(pre.named_steps["onehot"], "transformers_"))
        fitted = build_native_preprocessor("ratios_counts").fit(X)
        stats = fitted.named_transformers_["num"].named_steps["imputer"].statistics_
        expected_count = engineer_features(X, "counts").risk_factor_count.median()
        self.assertEqual(stats[numeric_feature_names("ratios_counts").index("risk_factor_count")], expected_count)
        held = self.X.iloc[90:95].copy()
        held["DM"] = held["HTN"] = held["FH"] = held["Current Smoker"] = 1
        held["DLP"] = "Y"
        fitted.transform(held)
        self.assertEqual(stats[numeric_feature_names("ratios_counts").index("risk_factor_count")], expected_count)

    def test_all_native_fits_receive_shifted_categorical_indices(self):
        original = train.build_estimator

        def small(kind, params, scale_pos):
            model = original(kind, params, scale_pos)
            if kind == "cat":
                model.set_params(iterations=4, thread_count=1)
            else:
                model.set_params(n_estimators=4, n_jobs=1)
            return model

        cases = [("cat", {"depth": 2, "learning_rate": .05, "l2_leaf_reg": 3}),
                 ("lgbm", {"num_leaves": 7, "min_child_samples": 2, "learning_rate": .05})]
        with patch.object(train, "build_estimator", side_effect=small):
            for kind, params in cases:
                pre, model = train.fit_with_track(kind, params, 1., "native", self.X.iloc[:160],
                                                  self.y.iloc[:160], feature_set="ratios_counts")
                pred = model.predict_proba(pre.transform(self.X.iloc[160:]))
                self.assertTrue(np.isfinite(pred).all())
                self.assertEqual(pred.shape, (143, 2))
                if kind == "cat":
                    self.assertEqual(model.model.get_cat_feature_indices(), native_cat_indices("ratios_counts"))

    def test_nested_candidate_configuration_uses_engineered_preprocessing(self):
        config = {"thread_count": 1, "feature_set": "ratios_counts"}
        pre, model = train.fit_base(self.X.iloc[:100], self.y.iloc[:100],
                        {"iterations": 3, "depth": 2}, config, 42)
        self.assertIn("num__risk_factor_count", pre.get_feature_names_out())
        self.assertEqual(model.model.get_cat_feature_indices(), native_cat_indices("ratios_counts"))
        legacy_pre, legacy = train.fit_base(self.X.iloc[:100], self.y.iloc[:100],
                        {"iterations": 3, "depth": 2}, {**config, "feature_set": "baseline"}, 42)
        self.assertEqual(legacy_pre.transform(self.X.iloc[:1]).shape[1], 54)
        self.assertEqual(legacy.model.get_cat_feature_indices(), native_cat_indices())

    def test_target_defaults_and_overrides(self):
        self.assertEqual({t: resolve_feature_set("auto", t) for t in DEFAULT_FEATURE_SETS},
                         {"cad": "logs", "lad": "counts", "lcx": "ratios_counts", "rca": "baseline"})
        self.assertEqual(resolve_feature_set("baseline", "cad"), "baseline")
        with self.assertRaises(ValueError):
            build_preprocessor("unknown")
        with self.assertRaises(ValueError):
            resolve_feature_set("auto")

    def test_final_training_artifacts_and_inference_use_the_same_target_features(self):
        original = train.build_estimator

        def small(kind, params, scale_pos):
            return original(kind, params, scale_pos).set_params(n_estimators=5, n_jobs=1)

        candidate = {"model": "rf", "prep": "onehot", "params": {
            "n_estimators": 5, "max_depth": 2, "min_samples_leaf": 2}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(train, "ARTIFACTS_DIR", root), \
                    patch.object(train, "EXPERIMENTS_CSV", root / "experiments.csv"), \
                    patch.object(train, "make_configs", return_value=([candidate], 1.)), \
                    patch.object(train, "build_estimator", side_effect=small), \
                    patch.object(train, "CV_FOLDS", 2), contextlib.redirect_stdout(io.StringIO()):
                for target in DEFAULT_FEATURE_SETS:
                    train.train_target(target, self.df, 2, learning_curves="none")
            bundles = {}
            for target, feature_set in DEFAULT_FEATURE_SETS.items():
                path = root / target
                metadata = json.loads((path / "metadata.json").read_text())
                schema = json.loads((path / "feature_schema.json").read_text())
                self.assertEqual(metadata["feature_set"], feature_set)
                self.assertEqual(metadata["best"]["feature_set"], feature_set)
                self.assertEqual(schema["input_features"], ALL_INPUT_FEATURES)
                self.assertEqual(schema["engineered_features"], engineered_feature_names(feature_set))
                background = joblib.load(path / "shap_raw_background.joblib")
                self.assertEqual(list(background.columns), ALL_INPUT_FEATURES)
                X, y = split_features_target(self.df, metadata["csv_column"], metadata["positive_label"])
                dev, held, _, _ = train.train_test_split(X, y, test_size=.2, stratify=y, random_state=42)
                self.assertTrue(set(background.index) <= set(dev.index))
                self.assertFalse(set(background.index) & set(held.index))
                bundles[target] = {"prep": joblib.load(path / "preprocessor.joblib"),
                                   "model": joblib.load(path / "model.joblib"), "threshold": .5}
            with patch.object(inference, "_load_all", return_value=bundles):
                result = inference.predict_patient(self.X.iloc[0].to_dict())
                for target, bundle in bundles.items():
                    p = bundle["model"].predict_proba(bundle["prep"].transform(self.X.iloc[:1]))[0, 1]
                    actual = result["cad"] if target == "cad" else result["vessels"][target.upper()]
                    self.assertAlmostEqual(p, actual["probability"], places=12)

    def test_experiment_csv_preserves_old_rows_and_identifies_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "experiments.csv"
            path.write_text('target,params\ncad,"{}"\n')
            with patch.object(train, "ARTIFACTS_DIR", root), patch.object(train, "EXPERIMENTS_CSV", path):
                train.append_experiment({"target": "lad", "params": "{}", "feature_set": "counts"})
                train.append_experiment({"target": "lcx", "params": "{}", "feature_set": "ratios_counts"})
            with path.open() as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([r["feature_set"] for r in rows], ["baseline", "counts", "ratios_counts"])
            self.assertTrue(all(row["params"] == "{}" for row in rows))


if __name__ == "__main__":
    unittest.main()
