"""Per-stage probabilities, stored plots and held-out-test isolation."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from PIL import Image
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import FunctionTransformer
from xgboost import XGBClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train
from learning_curves import probability_metrics, save_learning_curves, staged_probabilities
from native_models import CatBoostNative, LGBMArrayClassifier
from preprocessing import split_features_target
from voting import VotingClassifier


class LearningCurveTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.RandomState(42)
        self.X = pd.DataFrame(rng.normal(size=(80, 3)))
        self.X[2] = np.tile([0, 1], 40)
        self.y = pd.Series((self.X[0] + self.X[1] > 0).astype(int))
        self.members = {
            "rf": RandomForestClassifier(n_estimators=4, max_depth=2,
                                           n_jobs=1, random_state=42),
            "xgb": XGBClassifier(n_estimators=4, max_depth=2, n_jobs=1,
                                  random_state=42),
            "hgb": HistGradientBoostingClassifier(max_iter=4, max_leaf_nodes=3,
                                                   early_stopping=False, random_state=42),
            "lgbm": LGBMArrayClassifier(n_estimators=4, num_leaves=3,
                                         min_child_samples=2, n_jobs=1, verbose=-1,
                                         random_state=42),
            "cat": CatBoostNative(iterations=4, depth=2, cat_features=[2],
                                    thread_count=1, verbose=False,
                                    allow_writing_files=False, random_seed=42),
        }

    def test_f2_weights_recall_and_uses_the_selected_threshold(self):
        y = np.array([1, 1, 1, 0, 0])
        proba = np.array([0.9, 0.6, 0.4, 0.7, 0.65])
        # At 0.5: TP=2, FP=2, FN=1; F2 = 5TP / (5TP + FP + 4FN).
        self.assertAlmostEqual(probability_metrics(y, proba)["f2"], 10 / 16)
        # At 0.35: TP=3, FP=2, FN=0.
        self.assertAlmostEqual(probability_metrics(y, proba, 0.35)["f2"], 15 / 17)
        self.assertEqual(probability_metrics(y, proba, 1.0)["f2"], 0)

    def test_every_fitted_stage_and_final_probabilities_match(self):
        X = self.X.to_numpy()
        for name, model in self.members.items():
            with self.subTest(model=name):
                model.fit(X, self.y)
                expected = model.predict_proba(X)[:, 1]
                stages = list(staged_probabilities(model, X))
                self.assertEqual([step for _, step, _ in stages], [1, 2, 3, 4])
                self.assertEqual(stages[0][0],
                                 "tree_count" if name == "rf" else "boosting_iteration")
                np.testing.assert_allclose(stages[-1][2], expected, atol=1e-7)
                np.testing.assert_allclose(model.predict_proba(X)[:, 1], expected)
                self.assertFalse(np.allclose(stages[0][2], stages[-1][2]))

    def test_ensemble_saves_member_curves_and_final_scores(self):
        X_tr, X_va, y_tr, y_va = train.train_test_split(
            self.X, self.y, test_size=0.25, stratify=self.y, random_state=42)
        pre = FunctionTransformer().fit(X_tr)
        model = VotingClassifier([
            ("rf", self.members["rf"]), ("linear", LogisticRegression()),
        ], weights=[1, 2], threshold=0.35).fit(X_tr, y_tr)
        with tempfile.TemporaryDirectory() as tmp:
            result = save_learning_curves(
                tmp, model=model, preprocessor=pre, X_train=X_tr, y_train=y_tr,
                X_valid=X_va, y_valid=y_va,
                context={"target": "cad", "model": "vote", "fold": 1, "seed": 42},
            )
            directory = Path(tmp)
            rows = pd.read_csv(directory / "metrics.csv")
            self.assertIn("f2", rows.columns)
            self.assertEqual(set(rows["component"]), {"model", "rf", "linear"})
            self.assertEqual(len(rows[rows.component == "rf"]), 8)
            self.assertEqual(set(rows[rows.component == "linear"].step_type), {"final_fit"})
            final = rows[(rows.component == "model") & (rows.split == "validation")].iloc[0]
            expected = probability_metrics(y_va, model.predict_proba(X_va)[:, 1], 0.35)
            for metric, value in expected.items():
                self.assertAlmostEqual(final[metric], value)
            self.assertFalse(result["held_out_test_used"])
            self.assertEqual(result, json.loads((directory / "metadata.json").read_text()))
            for name in result["plots"]:
                with Image.open(directory / name) as image:
                    image.verify()

    def test_training_persists_requested_curves_and_excludes_test_rows(self):
        df = pd.read_csv(train.DATASET)
        configs = [
            {"model": "rf", "prep": "onehot", "params": {
                "n_estimators": 3, "max_depth": depth, "min_samples_leaf": 1,
            }} for depth in (1, 2)
        ]
        X, y = split_features_target(df, "Cath", "CAD")
        _, X_test, _, _ = train.train_test_split(
            X, y, test_size=train.TEST_SIZE, stratify=y, random_state=train.RANDOM_STATE)
        for mode, count in (("best", 1), ("all", 2), ("none", 0)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                artifacts = Path(tmp)
                with patch.object(train, "ARTIFACTS_DIR", artifacts), \
                        patch.object(train, "EXPERIMENTS_CSV", artifacts / "experiments.csv"), \
                        patch.object(train, "CV_FOLDS", 2), \
                        patch.object(train, "make_configs", return_value=(configs, 1.0)), \
                        contextlib.redirect_stdout(io.StringIO()):
                    winner = train.train_target("cad", df, repeats=2, learning_curves=mode)
                target = artifacts / "cad"
                files = list(target.glob("learning_curves/*/*/metadata.json"))
                self.assertEqual(len(files), count)
                metadata = json.loads((target / "metadata.json").read_text())
                self.assertEqual(metadata["learning_curves_mode"], mode)
                if count:
                    self.assertTrue((target / winner["learning_curves"] / "model.png").exists())
                    self.assertEqual(metadata["best"]["learning_curves"], winner["learning_curves"])
                for path in files:
                    curve = json.loads(path.read_text())
                    curve_train = set(curve["train_row_indices"])
                    curve_valid = set(curve["validation_row_indices"])
                    self.assertFalse(curve_train & curve_valid)
                    self.assertFalse((curve_train | curve_valid) & set(X_test.index))
                    self.assertEqual(len(curve_train | curve_valid), metadata["n_train"])
                if mode == "best":
                    originals = {p.name: p.read_bytes() for p in target.iterdir() if p.is_file()}
                    with patch.object(train, "ARTIFACTS_DIR", artifacts), \
                            patch.object(train, "CV_FOLDS", 2), \
                            contextlib.redirect_stdout(io.StringIO()):
                        regenerated = train.save_curves_for_saved_target("cad", df)
                    self.assertTrue((regenerated / "model.png").exists())
                    context = json.loads((regenerated / "metadata.json").read_text())
                    self.assertTrue(context["regenerated_from_saved_config"])
                    self.assertEqual(originals, {
                        p.name: p.read_bytes() for p in target.iterdir() if p.is_file()})
                    self.assertEqual(len(list(target.glob("learning_curves/*/*/metadata.json"))), 2)


if __name__ == "__main__":
    unittest.main()
