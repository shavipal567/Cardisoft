"""LightGBM must accept transformed NumPy matrices without name warnings."""

import io
import sys
import unittest
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.base import clone
from sklearn.exceptions import NotFittedError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train import build_estimator
from voting import (VotingClassifier, build_voting_estimators,
                    optimize_voting_weights_and_threshold)


class LightGBMTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.RandomState(42)
        self.X = np.column_stack((rng.normal(size=60), np.tile([0, 1, 2], 20)))
        self.y = (self.X[:, 0] + self.X[:, 1] > 1).astype(int)
        self.model = build_estimator("lgbm", {
            "num_leaves": 7, "min_child_samples": 2, "learning_rate": 0.05,
        }, 1.0).set_params(n_estimators=5, n_jobs=1)

    def test_native_probabilities_and_reload_without_warnings(self):
        reference = LGBMClassifier(**self.model.get_params()).fit(
            self.X, self.y, categorical_feature=[1])
        named_X = pd.DataFrame(self.X, columns=reference.feature_name_)
        expected = reference.predict_proba(named_X)
        with warnings.catch_warnings():
            warnings.simplefilter("error", UserWarning)
            model = clone(self.model).fit(self.X, self.y, categorical_feature=[1])
            np.testing.assert_allclose(model.predict_proba(self.X), expected)
            np.testing.assert_array_equal(model.predict(self.X), expected.argmax(axis=1))
            data = io.BytesIO()
            joblib.dump(model, data)
            data.seek(0)
            restored = joblib.load(data)
            np.testing.assert_allclose(restored.predict_proba(self.X[:1]), expected[:1])

    def test_voting_and_oof_predictions_without_warnings(self):
        model = dict(build_voting_estimators(1.0))["lgbm"]
        model.set_params(n_estimators=5, n_jobs=1, min_child_samples=2)
        estimators = [("lgbm", model)]
        with warnings.catch_warnings():
            warnings.simplefilter("error", UserWarning)
            best, _ = optimize_voting_weights_and_threshold(
                estimators, self.X, self.y, cv=2)
            vote = VotingClassifier(estimators, best["weights"], best["threshold"])
            vote.fit(self.X, self.y)
            proba = vote.predict_proba(self.X)
            self.assertEqual(proba.shape, (len(self.X), 2))
            np.testing.assert_allclose(proba.sum(axis=1), 1)

    def test_invalid_inputs_still_rejected(self):
        with self.assertRaises(NotFittedError):
            self.model.predict_proba(self.X)
        self.model.fit(self.X, self.y)
        with self.assertRaises(ValueError):
            self.model.predict_proba(self.X[:, :1])


if __name__ == "__main__":
    unittest.main()
