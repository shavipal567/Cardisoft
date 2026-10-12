"""Build dashboard metadata from the metrics and metadata beside saved models.

Export an offline snapshot with:
python training/model_info.py --output frontend/public/model-info.json
"""
import argparse
import json
from pathlib import Path

from inference import TARGET_KEYS, artifacts_dir
from preprocessing import ALL_INPUT_FEATURES

MODEL_NAMES = {"cat": "CatBoost", "rf": "Random Forest", "xgb": "XGBoost",
               "hgb": "HistGradientBoosting", "lgbm": "LightGBM",
               "stack": "Stacked ensemble", "vote": "Voting ensemble"}


def model_info(directory: Path | None = None) -> dict:
    root = directory or artifacts_dir()
    metrics = json.loads((root / "metrics.json").read_text())
    metadata = {key: json.loads((root / key / "metadata.json").read_text()) for key in TARGET_KEYS}
    first = metadata["cad"]
    targets = {}
    for key in TARGET_KEYS:
        meta, score = metadata[key], metrics[key]
        if score["n_test"] != meta["n_test"]:
            raise ValueError(f"Metrics and model metadata disagree for {key}")
        targets[key.upper()] = {
            **score,
            "model_name": MODEL_NAMES[meta["best"]["model"]],
            "positive_rate": score["pos_rate"],
            "cv_roc_auc": meta["best"]["cv_roc_auc"],
            "cv_roc_auc_std": meta["best"]["cv_roc_auc_std"],
            "repeats": meta["repeats"],
            "training_git_hash": meta["git_hash"],
        }
    return {
        "model_name": "; ".join(f"{key}: {value['model_name']}" for key, value in targets.items()),
        "status": "Saved models; held-out test results. Probabilities are not calibrated.",
        "evaluation": (f"Selection used {first['repeats']} repeats of 5-fold cross-validation on "
                       f"{first['n_train']} training patients. These metrics use the separate "
                       f"{first['n_test']}-patient test split (seed {first['random_state']})."),
        "dataset": {"patients": first["n_train"] + first["n_test"],
                    "features": len(ALL_INPUT_FEATURES), "train": first["n_train"], "test": first["n_test"]},
        "targets": targets,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(model_info(), indent=2) + "\n")
