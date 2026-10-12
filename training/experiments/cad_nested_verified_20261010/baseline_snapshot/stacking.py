"""LogReg stacking over one-hot-track base models.

Training accepts raw features plus a preprocessor, cloned within each inner
fold for the meta-learner's out-of-fold predictions. The supplied preprocessor
is then fitted on all training rows, and base models are refitted on its output.
Prediction still accepts a transformed matrix, preserving the separate
``preprocessor.joblib + model.joblib`` serving contract.
"""

import numpy as np
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression

from ensemble_cv import out_of_fold_probabilities


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

    def fit(self, X, y, *, preprocessor=None):
        """Fit inner-fold transforms and then refit the supplied preprocessor.

        The caller owns/saves the fitted preprocessor; it is not embedded in
        this model. Omit it only for numeric inputs needing no learned transform.
        """
        y = np.asarray(y, dtype=int)
        oof = out_of_fold_probabilities(
            self.estimators, X, y, cv=self.cv, seed=self.random_state,
            preprocessor=preprocessor,
        )
        if preprocessor is not None:
            X = preprocessor.fit_transform(X, y)
        X = np.asarray(X, dtype=float)
        self.fitted_estimators_ = []
        for _, est in self.estimators:
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
