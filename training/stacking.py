"""LogReg stacking over one-hot-track base models.

Operates on the TRANSFORMED (one-hot) matrix so the saved artifact stays
compatible with the ``preprocessor.joblib + model.joblib`` contract in
``inference.py``: ``model.predict_proba(prep.transform(df))``.

Out-of-fold base predictions are computed inside :meth:`StackedModel.fit`
(train folds only), so no held-out information leaks into the meta-learner.
"""

import numpy as np
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict


class StackedModel:
    """Stacked binary classifier with predict_proba + importances.

    Parameters
    ----------
    estimators:
        List of ``(name, unfitted sklearn classifier)`` base models, each
        accepting a dense numeric matrix.
    meta:
        Meta-learner (default: ``LogisticRegression(max_iter=1000)``).
    cv:
        Inner folds for out-of-fold base predictions (default 3: inner folds
        only feed the meta-learner, so 3 is sufficient and much cheaper).
    random_state:
        Seed for the inner split.
    """

    def __init__(self, estimators, meta=None, cv=3, random_state=42):
        self.estimators = estimators
        self.meta = meta if meta is not None else LogisticRegression(max_iter=1000)
        self.cv = cv
        self.random_state = random_state

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=int)
        skf = StratifiedKFold(n_splits=self.cv, shuffle=True,
                              random_state=self.random_state)
        oof = np.zeros((len(y), len(self.estimators)))
        self.fitted_estimators_ = []
        for j, (_, est) in enumerate(self.estimators):
            oof[:, j] = cross_val_predict(clone(est), X, y, cv=skf,
                                          method="predict_proba")[:, 1]
            fitted = clone(est).fit(X, y)
            self.fitted_estimators_.append(fitted)
        self.meta_ = clone(self.meta).fit(oof, y)
        classes = np.unique(y)
        self.classes_ = classes
        return self

    def _meta_features(self, X):
        X = np.asarray(X, dtype=float)
        return np.column_stack([
            est.predict_proba(X)[:, 1] for est in self.fitted_estimators_
        ])

    def predict_proba(self, X):
        return self.meta_.predict_proba(self._meta_features(X))

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)

    @property
    def feature_importances_(self):
        """Mean of normalized base importances (for the gain fallback)."""
        imps = []
        for est in self.fitted_estimators_:
            v = np.asarray(getattr(est, "feature_importances_", None), dtype=float)
            if v is None or v.shape[0] == 0 or v.sum() <= 0:
                continue
            imps.append(v / v.sum())
        if not imps:
            raise AttributeError("no base importances available")
        return np.mean(imps, axis=0)
