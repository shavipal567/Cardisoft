"""Train CAD + LAD/LCX/RCA classifiers (RF vs XGBoost, leakage-safe).

For each target: stratified 80/20 split (seed 42) + stratified 5-fold CV on
train; preprocessor fitted on train folds only via Pipeline. Best model by
mean CV ROC-AUC (tie-break F1) is refit on full train and saved with its
preprocessor under training/artifacts/<target>/.
"""

import argparse
import json
import subprocess
from itertools import product
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from preprocessing import TARGETS, build_preprocessor, split_features_target

RANDOM_STATE = 42
TEST_SIZE = 0.2
CV_FOLDS = 5

HERE = Path(__file__).resolve().parent
ARTIFACTS_DIR = HERE / "artifacts"
DATASET = HERE.parent / "dataset" / "dataset.csv"

RF_GRID = {
    "n_estimators": [200, 400],
    "max_depth": [8, None],
    "min_samples_leaf": [1, 2],
}
XGB_GRID = {
    "n_estimators": [200, 400],
    "max_depth": [3, 4],
    "learning_rate": [0.05, 0.1],
}


def make_models(y_train):
    scale_pos = (len(y_train) - y_train.sum()) / max(y_train.sum(), 1)
    rf_configs = [
        {"model": "rf", "params": dict(zip(RF_GRID.keys(), v))}
        for v in product(*RF_GRID.values())
    ]
    xgb_configs = [
        {"model": "xgb", "params": dict(zip(XGB_GRID.keys(), v))}
        for v in product(*XGB_GRID.values())
    ]
    return rf_configs, xgb_configs, float(scale_pos)


def build_estimator(kind, params, scale_pos_weight):
    if kind == "rf":
        return RandomForestClassifier(
            n_jobs=-1, random_state=RANDOM_STATE, class_weight="balanced", **params
        )
    return XGBClassifier(
        n_estimators=params["n_estimators"],
        max_depth=params["max_depth"],
        learning_rate=params["learning_rate"],
        subsample=0.8,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos_weight,
        tree_method="hist",
        eval_metric="logloss",
        n_jobs=-1,
        random_state=RANDOM_STATE,
    )


def cv_score(pipe_params_kind, X, y):
    """Manual CV so the preprocessor is fit inside each fold (no leakage)."""
    kind, params, scale_pos = pipe_params_kind
    skf = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    aucs, f1s = [], []
    for tr_idx, va_idx in skf.split(X, y):
        pipe = Pipeline([
            ("prep", build_preprocessor()),
            ("clf", build_estimator(kind, params, scale_pos)),
        ])
        pipe.fit(X.iloc[tr_idx], y.iloc[tr_idx])
        proba = pipe.predict_proba(X.iloc[va_idx])[:, 1]
        pred = (proba >= 0.5).astype(int)
        aucs.append(roc_auc_score(y.iloc[va_idx], proba))
        f1s.append(f1_score(y.iloc[va_idx], pred))
    return float(np.mean(aucs)), float(np.mean(f1s))


def train_target(key, df):
    cfg = TARGETS[key]
    X, y = split_features_target(df, cfg["column"], cfg["positive"])
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
    )
    rf_configs, xgb_configs, scale_pos = make_models(y_train)

    results = []
    for kind, configs in (("rf", rf_configs), ("xgb", xgb_configs)):
        for c in configs:
            auc, f1 = cv_score((c["model"], c["params"], scale_pos), X_train, y_train)
            results.append({"model": c["model"], "params": c["params"],
                            "cv_roc_auc": auc, "cv_f1": f1})
            print(f"[{key}] {c['model']} {c['params']} -> CV AUC={auc:.4f} F1={f1:.4f}",
                  flush=True)

    best = sorted(results, key=lambda r: (r["cv_roc_auc"], r["cv_f1"]), reverse=True)[0]
    print(f"[{key}] BEST: {best}", flush=True)

    # Refit best on full train (preprocessor fit on train only).
    final = Pipeline([
        ("prep", build_preprocessor()),
        ("clf", build_estimator(best["model"], best["params"], scale_pos)),
    ])
    final.fit(X_train, y_train)

    out_dir = ARTIFACTS_DIR / key
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(final.named_steps["prep"], out_dir / "preprocessor.joblib")
    joblib.dump(final.named_steps["clf"], out_dir / "model.joblib")
    # SHAP background: up to 100 transformed train rows.
    Xt = final.named_steps["prep"].transform(X_train)
    bg = Xt[np.random.RandomState(RANDOM_STATE).choice(
        len(Xt), size=min(100, len(Xt)), replace=False)]
    np.savez_compressed(out_dir / "shap_background.npz", background=bg)
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=HERE.parent, text=True).strip()
    except Exception:
        git_hash = "unknown"
    meta = {
        "target": key, "csv_column": cfg["column"], "positive_label": cfg["positive"],
        "n_train": len(X_train), "n_test": len(X_test),
        "pos_rate_train": float(y_train.mean()), "pos_rate_test": float(y_test.mean()),
        "best": best, "all_cv_results": results,
        "random_state": RANDOM_STATE, "test_size": TEST_SIZE,
        "git_hash": git_hash,
    }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2))
    return best


def main(targets):
    df = pd.read_csv(DATASET)
    print(f"dataset: {df.shape}")
    for key in targets:
        train_target(key, df)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", nargs="*", default=["cad", "lad", "lcx", "rca"])
    args = ap.parse_args()
    main(args.targets)
