"""Confusion-matrix orientation, normalisation and evaluation exports."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evaluate
from evaluation_plots import draw_confusion_matrix


class EvaluationPlotTests(unittest.TestCase):
    def test_actual_rows_predicted_columns_and_row_percentages(self):
        figure = Figure()
        counts, normalized = figure.subplots(1, 2)
        matrix = np.array([[12, 6], [3, 40]])
        draw_confusion_matrix(counts, matrix, "cad")
        self.assertEqual(counts.get_xlabel(), "Predicted class")
        self.assertEqual(counts.get_ylabel(), "Actual class")
        self.assertEqual([text.get_text() for text in counts.texts],
                         ["TN\n12", "FP\n6", "FN\n3", "TP\n40"])
        image = draw_confusion_matrix(normalized, matrix, "cad", normalize=True)
        np.testing.assert_allclose(image.get_array(), [[12 / 18, 6 / 18], [3 / 43, 40 / 43]])
        empty = figure.add_axes([0, 0, 0.1, 0.1])
        image = draw_confusion_matrix(empty, [[2, 3], [0, 0]], "lad", normalize=True)
        self.assertTrue(np.isfinite(image.get_array()).all())
        self.assertEqual(empty.texts[3].get_text(), "TP\nN/A")

    def test_evaluation_writes_plots_and_preserves_metric_schema(self):
        saved = json.loads((evaluate.ARTIFACTS_DIR / "metrics.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(evaluate, "ARTIFACTS_DIR", root), \
                    patch.object(evaluate, "METRICS_PATH", root / "metrics.json"), \
                    patch.object(evaluate.pd, "read_csv", return_value=pd.DataFrame()), \
                    patch.object(evaluate, "evaluate_target", side_effect=lambda key, df: saved[key]), \
                    contextlib.redirect_stdout(io.StringIO()):
                evaluate.main()
            self.assertEqual(json.loads((root / "metrics.json").read_text()), saved)
            paths = [root / "confusion_matrices.png"]
            paths.extend(root / key / "confusion_matrix.png" for key in saved)
            for path in paths:
                with Image.open(path) as image:
                    image.verify()


if __name__ == "__main__":
    unittest.main()
