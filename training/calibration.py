"""Serializable binary calibration and the existing transformed-input contract.

Only training-side out-of-fold probabilities may be passed to ``fit``.
Sigmoid uses Platt's smoothed binary targets on the model's log odds.
"""

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit
from sklearn.base import BaseEstimator, ClassifierMixin, TransformerMixin
from sklearn.isotonic import IsotonicRegression

from preprocessing import ALL_INPUT_FEATURES, clean_dataframe


class ProbabilityCalibrator:
    def __init__(self, method="raw", epsilon=1e-6):
        self.method = method
        self.epsilon = epsilon

    def fit(self, probabilities, y):
        p = np.clip(np.asarray(probabilities), self.epsilon, 1 - self.epsilon)
        y = np.asarray(y)
        if self.method == "sigmoid":
            positives, negatives = np.sum(y == 1), np.sum(y == 0)
            target = np.where(y == 1, (positives + 1) / (positives + 2),
                              1 / (negatives + 2))
            z = logit(p)

            def objective(ab):
                score = ab[0] * z + ab[1]
                residual = expit(score) - target
                return (np.mean(np.logaddexp(0, score) - target * score),
                        np.array([np.mean(residual * z), np.mean(residual)]))

            result = minimize(objective, [1., 0.], jac=True, method="L-BFGS-B",
                              bounds=[(0., None), (None, None)])
            if not result.success:
                raise RuntimeError(f"Sigmoid calibration failed: {result.message}")
            self.coef_, self.intercept_ = result.x
        elif self.method == "isotonic":
            self.regressor_ = IsotonicRegression(out_of_bounds="clip").fit(p, y)
        elif self.method != "raw":
            raise ValueError(f"Unknown calibration method {self.method}")
        return self

    def predict(self, probabilities):
        p = np.clip(np.asarray(probabilities), self.epsilon, 1 - self.epsilon)
        if self.method == "sigmoid":
            p = expit(self.coef_ * logit(p) + self.intercept_)
        elif self.method == "isotonic":
            p = self.regressor_.predict(p)
        return np.clip(p, self.epsilon, 1 - self.epsilon)


class CalibratedBinaryModel(ClassifierMixin, BaseEstimator):
    """A fitted CatBoostNative plus a training-OOF-fitted calibration mapping."""
    def __init__(self, base_model, calibrator, threshold=0.5):
        self.base_model = base_model
        self.calibrator = calibrator
        self.threshold = threshold
        self.classes_ = np.array([0, 1])

    def fit(self, X, y=None):
        raise RuntimeError("This model is frozen; train/calibrate through the nested training pipeline")

    def __sklearn_is_fitted__(self):
        return self.base_model.model is not None

    def predict_proba(self, X):
        p = self.calibrator.predict(self.base_model.predict_proba(X)[:, 1])
        return np.column_stack((1 - p, p))

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= self.threshold).astype(int)

    @property
    def feature_importances_(self):
        return self.base_model.feature_importances_


class FeatureSchema(TransformerMixin, BaseEstimator):
    """Freeze raw columns/order and reuse the exact training cleaning at inference."""
    def __init__(self, features=None):
        self.features = features

    def fit(self, X, y=None):
        self.feature_names_in_ = np.array(self.features or ALL_INPUT_FEATURES)
        self.transform(X)
        return self

    def transform(self, X):
        columns = list(self.feature_names_in_)
        missing = set(columns) - set(X.columns)
        if missing:
            raise ValueError(f"Missing model inputs: {sorted(missing)}")
        return clean_dataframe(X.loc[:, columns])
