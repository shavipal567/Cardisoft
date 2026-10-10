"""Adapters for native-categorical estimators.

CatBoost requires categorical columns to have an integer (non-float) dtype,
but the shared native preprocessor emits a float matrix. :class:`CatBoostNative`
converts on the way in — in both :meth:`fit` and :meth:`predict_proba` — so
the saved ``model.joblib`` keeps the standard contract
(``model.predict_proba(prep.transform(df))``) used by ``inference.py``.
"""

import numpy as np
import pandas as pd


class CatBoostNative:
    """CatBoostClassifier over integer-cast categorical columns."""

    def __init__(self, cat_features=(), **params):
        self.cat_features = cat_features
        self.params = dict(params)
        self.model = None

    def _frame(self, X):
        df = pd.DataFrame(np.asarray(X))
        for j in self.cat_features:
            df[j] = df[j].astype(int)
        return df

    def fit(self, X, y, cat_features=None):
        from catboost import CatBoostClassifier
        if cat_features is not None:
            self.cat_features = list(cat_features)
        elif not isinstance(self.cat_features, list):
            self.cat_features = list(self.cat_features)
        self.model = CatBoostClassifier(**self.params)
        self.model.fit(self._frame(X), np.asarray(y).ravel(),
                       cat_features=self.cat_features)
        self.classes_ = np.asarray(self.model.classes_)
        return self

    def predict_proba(self, X):
        return np.asarray(self.model.predict_proba(self._frame(X)))

    def predict(self, X):
        return np.asarray(self.model.predict(self._frame(X)))

    @property
    def feature_importances_(self):
        return np.asarray(self.model.feature_importances_, dtype=float)

    def get_params(self, deep=True):
        return {"cat_features": self.cat_features, **self.params}

    def set_params(self, **params):
        if "cat_features" in params:
            self.cat_features = list(params.pop("cat_features"))
        if "random_state" in params:
            # Alias to CatBoost's own seed name (both must never coexist).
            self.params["random_seed"] = params.pop("random_state")
        self.params.update(params)
        return self
