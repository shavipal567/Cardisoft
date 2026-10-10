import itertools

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, fbeta_score, recall_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier

from native_models import CatBoostNative
from preprocessing import native_cat_indices


class VotingClassifier:
    def __init__(self, estimators, weights=None, threshold=0.5):
        self.estimators = estimators
        self.weights = weights
        self.threshold = threshold

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=int)
        self.fitted_estimators_ = []
        for _, est in self.estimators:
            self.fitted_estimators_.append(clone(est).fit(X, y))
        self.classes_ = np.asarray([0, 1])
        return self

    def predict_proba(self, X):
        X = np.asarray(X, dtype=float)
        n = len(self.fitted_estimators_)
        w = self.weights if self.weights is not None else [1.0] * n
        w = np.asarray(w, dtype=float)
        w_sum = w.sum()
        if w_sum <= 0:
            w = np.ones(n, dtype=float)
            w_sum = float(n)
        proba = np.zeros(len(X), dtype=float)
        for wi, est in zip(w, self.fitted_estimators_):
            proba += wi * np.asarray(est.predict_proba(X))[:, 1]
        return proba / w_sum

    def predict(self, X):
        return (self.predict_proba(X) >= self.threshold).astype(int)

    @property
    def feature_importances_(self):
        imps = []
        for est in self.fitted_estimators_:
            v = np.asarray(getattr(est, "feature_importances_", None), dtype=float)
            if v is None or v.shape[0] == 0 or v.sum() <= 0:
                continue
            imps.append(v / v.sum())
        if not imps:
            raise AttributeError("no base importances available")
        return np.mean(imps, axis=0)


def build_voting_estimators(scale_pos):
    return [
        ("rf", RandomForestClassifier(
            n_estimators=400, max_depth=None, min_samples_leaf=1,
            n_jobs=-1, random_state=42, class_weight="balanced",
        )),
        ("xgb", XGBClassifier(
            n_estimators=400, max_depth=4, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
            scale_pos_weight=scale_pos, tree_method="hist",
            eval_metric="logloss", n_jobs=-1, random_state=42,
        )),
        ("hgb", HistGradientBoostingClassifier(
            learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=20,
            class_weight="balanced", random_state=42,
        )),
        ("lgbm", LGBMClassifier(
            n_estimators=300, num_leaves=15, min_child_samples=10,
            learning_rate=0.05, feature_fraction=0.8, verbose=-1,
            force_col_wise=True, n_jobs=-1, random_state=42,
        )),
        ("cat", CatBoostNative(
            iterations=400, depth=4, learning_rate=0.05, l2_leaf_reg=3,
            auto_class_weights="Balanced", verbose=False,
            allow_writing_files=False, random_seed=42,
        )),
        ("en", LogisticRegression(
            penalty="elasticnet", solver="saga", l1_ratio=0.5, C=1.0,
            max_iter=5000, class_weight="balanced", random_state=42,
        )),
    ]


def optimize_voting_weights_and_threshold(estimators, X, y, cv=5, seed=42):
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    skf = StratifiedKFold(n_splits=cv, shuffle=True, random_state=seed)
    oof = np.zeros((len(y), len(estimators)))
    for j, (_, est) in enumerate(estimators):
        oof[:, j] = cross_val_predict(
            clone(est), X, y, cv=skf, method="predict_proba",
        )[:, 1]

    individual_f2 = []
    for j in range(len(estimators)):
        pred = (oof[:, j] >= 0.5).astype(int)
        individual_f2.append(fbeta_score(y, pred, beta=2))
    top_idx = np.argsort(individual_f2)[::-1][:4]

    weight_options = [0.0, 0.5, 1.0, 1.5, 2.0]
    thresholds = np.arange(0.30, 0.71, 0.02)
    best = {"f2": -1.0, "accuracy": -1.0, "recall": -1.0,
            "weights": None, "threshold": 0.5}
    results = []
    for combo in itertools.product(weight_options, repeat=len(top_idx)):
        w_full = np.zeros(len(estimators))
        for i, wi in zip(top_idx, combo):
            w_full[i] = wi
        if w_full.sum() == 0:
            continue
        avg_proba = (oof * w_full).sum(axis=1) / w_full.sum()
        for t in thresholds:
            pred = (avg_proba >= t).astype(int)
            f2 = fbeta_score(y, pred, beta=2)
            acc = accuracy_score(y, pred)
            rec = recall_score(y, pred, zero_division=0)
            results.append({"f2": f2, "accuracy": acc, "recall": rec,
                            "weights": w_full.tolist(), "threshold": float(t)})
            if (f2 > best["f2"]
                    or (f2 == best["f2"] and acc > best["accuracy"])
                    or (f2 == best["f2"] and acc == best["accuracy"]
                        and rec > best["recall"])):
                best = {"f2": float(f2), "accuracy": float(acc),
                        "recall": float(rec),
                        "weights": w_full.tolist(), "threshold": float(t)}
    return best, results
