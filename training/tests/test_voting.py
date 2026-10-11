"""Voting regressions: python3 -m unittest discover -s training/tests -v."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evaluate
import inference
import train
from voting import VotingClassifier


class VotingTests(unittest.TestCase):
    def setUp(self):
        self.X = np.array([[0, 0], [1, 0], [0, 1], [1, 1]])
        self.y = np.array([0, 0, 1, 1])
        self.estimators = [
            ("negative", DummyClassifier(strategy="constant", constant=0)),
            ("positive", DummyClassifier(strategy="constant", constant=1)),
        ]

    def test_binary_probabilities_and_threshold(self):
        for weights, positive in [([3, 2], 0.4), (None, 0.5), ([0, 0], 0.5)]:
            with self.subTest(weights=weights):
                model = VotingClassifier(self.estimators, weights, threshold=0.4)
                model.fit(self.X, self.y)
                for X in (self.X, self.X[:1]):
                    proba = model.predict_proba(X)
                    self.assertEqual(proba.shape, (len(X), 2))
                    np.testing.assert_allclose(proba[:, 1], positive)
                    np.testing.assert_allclose(proba[:, 0], 1 - positive)
                    np.testing.assert_allclose(proba.sum(axis=1), 1)
                    np.testing.assert_array_equal(model.predict(X), np.ones(len(X)))
                model.threshold = 0.6
                np.testing.assert_array_equal(model.predict(self.X), np.zeros(len(self.X)))

    def test_importances_skip_members_without_importances(self):
        estimators = [
            ("tree", DecisionTreeClassifier(random_state=42)),
            ("linear", LogisticRegression()),
        ]
        model = VotingClassifier(estimators).fit(self.X, self.y)
        np.testing.assert_allclose(model.feature_importances_, [0, 1])
        model = VotingClassifier(estimators[1:]).fit(self.X, self.y)
        with self.assertRaises(AttributeError):
            _ = model.feature_importances_

    def test_cv_uses_tuned_threshold(self):
        from sklearn.preprocessing import FunctionTransformer

        best = {"weights": [3, 2], "threshold": 0.35}
        with patch.object(train, "CV_FOLDS", 2), \
                patch.object(train, "build_prep", return_value=FunctionTransformer()), \
                patch.object(train, "build_voting_estimators", return_value=self.estimators), \
                patch.object(train, "optimize_voting_weights_and_threshold", return_value=(best, [])):
            scores = train.repeated_cv_scores(
                {"model": "vote", "prep": "voting", "params": {}},
                pd.DataFrame(np.tile(self.X, (4, 1))),
                pd.Series(np.tile(self.y, 4)), 1.0, [42, 43],
            )
        self.assertEqual(scores["n_scores"], 4)
        self.assertAlmostEqual(scores["cv_f1"], 2 / 3)
        self.assertAlmostEqual(scores["cv_roc_auc"], 0.5)
        self.assertAlmostEqual(scores["cv_pr_auc"], 0.5)
        self.assertAlmostEqual(scores["cv_brier"], 0.26)

    def test_voting_winner_saves_evaluates_and_predicts(self):
        df = pd.read_csv(train.DATASET)
        estimators = [
            ("tree", DecisionTreeClassifier(max_depth=2, random_state=42)),
            ("linear", LogisticRegression(max_iter=1000, random_state=42)),
        ]
        best = {"weights": [1, 1], "threshold": 0.35}
        with tempfile.TemporaryDirectory() as tmp:
            artifacts = Path(tmp)
            with patch.object(train, "ARTIFACTS_DIR", artifacts), \
                    patch.object(train, "EXPERIMENTS_CSV", artifacts / "experiments.csv"), \
                    patch.object(train, "CV_FOLDS", 2), \
                    patch.object(train, "make_configs", return_value=(
                        [{"model": "vote", "prep": "voting", "params": {}}], 1.0)), \
                    patch.object(train, "build_voting_estimators", return_value=estimators), \
                    patch.object(train, "optimize_voting_weights_and_threshold", return_value=(best, [])), \
                    contextlib.redirect_stdout(io.StringIO()):
                winner = train.train_target("cad", df, repeats=2)
            self.assertEqual(winner["model"], "vote")
            meta = json.loads((artifacts / "cad/metadata.json").read_text())
            self.assertTrue(0 <= meta["stability_top10_jaccard"] <= 1)
            self.assertEqual(meta["threshold"], 0.35)
            self.assertEqual(meta["voting_weights"], {"tree": 1.0, "linear": 1.0})
            with patch.object(evaluate, "ARTIFACTS_DIR", artifacts):
                metrics = evaluate.evaluate_target("cad", df)
            self.assertTrue(0 <= metrics["roc_auc"] <= 1)
            bundle = {
                "prep": joblib.load(artifacts / "cad/preprocessor.joblib"),
                "model": joblib.load(artifacts / "cad/model.joblib"),
                "threshold": meta["threshold"],
            }
            with patch.object(inference, "_load_all", return_value={
                    key: bundle for key in inference.TARGET_KEYS}):
                result = inference.predict_patient(df.iloc[0].to_dict())
            self.assertTrue(0 <= result["cad"]["probability"] <= 1)
            self.assertEqual(result["cad"]["prediction"],
                             int(result["cad"]["probability"] >= 0.35))


if __name__ == "__main__":
    unittest.main()
