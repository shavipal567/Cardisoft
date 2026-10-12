"""Dashboard metadata must support every model family training can select."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inference import TARGET_KEYS
from model_info import model_info


class ModelInfoTests(unittest.TestCase):
    def test_voting_winner_in_dashboard_metadata(self):
        source = Path(__file__).resolve().parents[1] / "artifacts"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "metrics.json").write_text((source / "metrics.json").read_text())
            for key in TARGET_KEYS:
                metadata = json.loads((source / key / "metadata.json").read_text())
                metadata["best"]["model"] = "vote"
                if key == "cad":
                    metadata.update(feature_set="logs", engineered_features=["log1p_TG", "log1p_FBS", "log1p_ESR"])
                (root / key).mkdir()
                (root / key / "metadata.json").write_text(json.dumps(metadata))
            info = model_info(root)
        metrics = json.loads((source / "metrics.json").read_text())
        for target, row in info["targets"].items():
            self.assertEqual(row["model_name"], "Voting ensemble")
            self.assertIn(f"{target}: Voting ensemble", info["model_name"])
            self.assertEqual(row["roc_auc"], metrics[target.lower()]["roc_auc"])
            if target == "CAD":
                self.assertEqual(row["feature_set"], "logs")
                self.assertEqual(row["engineered_features"], ["log1p_TG", "log1p_FBS", "log1p_ESR"])
            else:
                self.assertNotIn("feature_set", row)


if __name__ == "__main__":
    unittest.main()
