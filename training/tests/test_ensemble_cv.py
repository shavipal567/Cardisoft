"""Regression checks for inner-fold isolation and ensemble artifact contracts."""

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train
from ensemble_cv import out_of_fold_probabilities
from preprocessing import build_voting_preprocessor, split_features_target
from voting import build_voting_estimators


class AuditedPreprocessor(TransformerMixin, BaseEstimator):
    """Record the rows and learned statistics of each actual preprocessing fit."""

    fits = []

    def fit(self, X, y=None):
        self.transformer_ = ColumnTransformer([
            ("num", Pipeline([
                ("impute", SimpleImputer(strategy="median")),
                ("scale", StandardScaler()),
            ]), ["value"]),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["category"]),
        ]).fit(X, y)
        num = self.transformer_.named_transformers_["num"]
        self.fits.append({
            "rows": tuple(X.index),
            "median": num.named_steps["impute"].statistics_[0],
            "mean": num.named_steps["scale"].mean_[0],
            "categories": set(self.transformer_.named_transformers_["cat"].categories_[0]),
        })
        return self

    def transform(self, X):
        return self.transformer_.transform(X)


class EnsembleCVTests(unittest.TestCase):
    def setUp(self):
        AuditedPreprocessor.fits = []
        self.X = pd.DataFrame({
            "value": [np.nan, 10000, *range(2, 24)],
            "category": ["rare", *(["a", "b"] * 11), "a"],
        }, index=np.arange(100, 148, 2))
        self.y = pd.Series(np.tile([0, 1], 12), index=self.X.index)
        self.estimators = [("tree", DecisionTreeClassifier(max_depth=2, random_state=42))]

    def assert_fitted_rows(self, expected):
        self.assertEqual([fit["rows"] for fit in AuditedPreprocessor.fits],
                         [tuple(rows.index) for rows in expected])
        for fit, rows in zip(AuditedPreprocessor.fits, expected):
            self.assertAlmostEqual(fit["median"], rows["value"].median())
            self.assertAlmostEqual(fit["mean"], rows["value"].fillna(rows["value"].median()).mean())
            self.assertEqual(fit["categories"], set(rows["category"]))

    def inner_rows(self, X, y, cv, seed):
        splitter = StratifiedKFold(n_splits=cv, shuffle=True, random_state=seed)
        return [X.iloc[tr] for tr, _ in splitter.split(X, y)]

    def test_oof_matches_fold_local_pipeline_with_missing_values_and_rare_category(self):
        prep = AuditedPreprocessor()
        estimators = [("linear", LogisticRegression())]
        actual = out_of_fold_probabilities(estimators, self.X, self.y, cv=3,
                                           seed=17, preprocessor=prep)
        self.assert_fitted_rows(self.inner_rows(self.X, self.y, 3, 17))
        self.assertFalse(hasattr(prep, "transformer_"))
        expected = cross_val_predict(
            Pipeline([("prep", clone(prep)), ("model", LogisticRegression())]),
            self.X, self.y,
            cv=StratifiedKFold(n_splits=3, shuffle=True, random_state=17),
            method="predict_proba",
        )[:, 1]
        np.testing.assert_allclose(actual[:, 0], expected)

    def test_outer_cv_isolates_preprocessing_for_both_ensembles(self):
        for kind in ("vote", "stack"):
            with self.subTest(kind=kind):
                AuditedPreprocessor.fits = []
                with patch.object(train, "CV_FOLDS", 2), \
                        patch.object(train, "build_prep", side_effect=lambda *args: AuditedPreprocessor()), \
                        patch.object(train, "build_voting_estimators", return_value=self.estimators), \
                        patch.object(train, "make_stack_bases", return_value=self.estimators):
                    scores = train.repeated_cv_scores(
                        {"model": kind, "prep": "onehot", "params": {}},
                        self.X, self.y, 1.0, [17, 42],
                    )
                expected = []
                for seed in (17, 42):
                    outer = StratifiedKFold(n_splits=2, shuffle=True, random_state=seed)
                    for tr, _ in outer.split(self.X, self.y):
                        X_tr, y_tr = self.X.iloc[tr], self.y.iloc[tr]
                        expected.extend(self.inner_rows(X_tr, y_tr, 3, seed))
                        expected.append(X_tr)
                self.assert_fitted_rows(expected)
                self.assertEqual(scores["n_scores"], 4)
                self.assertTrue(all(np.isfinite(value) for value in scores.values()))

    def test_all_voting_members_accept_fold_local_clinical_preprocessing(self):
        raw = pd.read_csv(train.DATASET)
        X, y = split_features_target(raw, "Cath", "CAD")
        X_train, _, y_train, _ = train.train_test_split(
            X, y, test_size=train.TEST_SIZE, stratify=y, random_state=train.RANDOM_STATE,
        )
        members = build_voting_estimators(1.0)
        for name, member in members:
            if name in ("rf", "xgb", "lgbm"):
                member.set_params(n_estimators=3, n_jobs=1)
            elif name == "hgb":
                member.set_params(max_iter=3)
            elif name == "cat":
                member.set_params(iterations=3, thread_count=1)
        proba = out_of_fold_probabilities(
            members, X_train, y_train, cv=2, preprocessor=build_voting_preprocessor(),
        )
        self.assertEqual(proba.shape, (len(y_train), 6))
        self.assertTrue(np.isfinite(proba).all())
        self.assertTrue(((proba >= 0) & (proba <= 1)).all())

    def test_stability_and_final_refit_use_inner_folds_and_preserve_saved_contract(self):
        for kind, cv in (("vote", 5), ("stack", 3)):
            with self.subTest(kind=kind):
                AuditedPreprocessor.fits = []
                with patch.object(train, "build_prep", side_effect=lambda *args: AuditedPreprocessor()), \
                        patch.object(train, "build_voting_estimators", return_value=self.estimators), \
                        patch.object(train, "make_stack_bases", return_value=self.estimators):
                    stability = train.stability_jaccard(
                        kind, {}, 1.0, "onehot", self.X, self.y, [17, 42],
                    )
                    prep, model = train.fit_with_track(kind, {}, 1.0, "onehot", self.X, self.y)
                expected = []
                for seed in (17, 42, 42):
                    expected.extend(self.inner_rows(self.X, self.y, cv, seed))
                    expected.append(self.X)
                self.assert_fitted_rows(expected)
                self.assertTrue(0 <= stability <= 1)
                predictions = model.predict_proba(prep.transform(self.X))
                self.assertEqual(predictions.shape, (len(self.X), 2))
                np.testing.assert_allclose(predictions.sum(axis=1), 1)
                # Serialize the serving artifacts independently, as train_target does.
                restored = []
                for artifact in (prep, model):
                    buffer = io.BytesIO()
                    joblib.dump(artifact, buffer)
                    buffer.seek(0)
                    restored.append(joblib.load(buffer))
                restored_prep, restored_model = restored
                np.testing.assert_allclose(
                    restored_model.predict_proba(restored_prep.transform(self.X)), predictions,
                )
                np.testing.assert_allclose(
                    restored_model.predict_proba(restored_prep.transform(self.X.iloc[:1])),
                    predictions[:1],
                )


if __name__ == "__main__":
    unittest.main()
