import hashlib
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path.cwd() / 'training'))
from clinical_metrics import binary_metrics
from preprocessing import split_features_target

root = Path(sys.argv[1])
config = json.loads((root / 'config.json').read_text())
partitions = json.loads((root / 'partitions.json').read_text())
outer = json.loads((root / 'outer_splits.json').read_text())
development = set(partitions['development_rows'])
holdout = set(partitions['historical_holdout_rows'])
assert not development & holdout
predictions = pd.read_csv(root / 'outer_predictions.csv')
metrics = pd.read_csv(root / 'outer_fold_metrics.csv')
assert len(outer) == len(config['seeds'])
assert set(predictions.row_index) == development
assert np.isfinite(predictions.probability).all()
assert predictions.probability.between(0, 1).all()
assert np.array_equal(predictions.prediction, (predictions.probability >= predictions.threshold).astype(int))
for (seed, variant), rows in predictions.groupby(['seed', 'variant']):
    assert len(rows) == len(development)
    assert len(rows.row_index.unique()) == len(development)
for repeat in outer:
    evaluated = []
    for fold in repeat['folds']:
        train = set(fold['train_rows'])
        test = set(fold['validation_rows'])
        assert not train & test
        assert train | test == development
        evaluated.extend(test)
        fold_dir = root / 'folds' / f"seed_{repeat['seed']}_fold_{fold['fold']}"
        inner = json.loads((fold_dir / 'inner_splits.json').read_text())
        for split in inner:
            a, b = set(split['train_rows']), set(split['validation_rows'])
            assert not a & b
            assert a | b == train
            assert not (a | b) & (test | holdout)
        calibration = json.loads((fold_dir / 'calibration_splits.json').read_text())
        for split in calibration:
            a, b = set(split['calibrator_rows']), set(split['validation_rows'])
            assert not a & b
            assert a | b == train
            for sub in split['subfolds']:
                c, d = set(sub['train_rows']), set(sub['validation_rows'])
                assert not c & d
                assert c | d == a
                assert not (c | d) & b
        inner_predictions = pd.read_csv(fold_dir / 'inner_predictions.csv')
        np.testing.assert_allclose(np.clip(inner_predictions.base_oof, 1e-6, 1 - 1e-6),
                                   inner_predictions.cross_calibrated_raw, atol=1e-10, rtol=1e-10)
        score = json.loads((fold_dir / 'selection.json').read_text())
        cal = json.loads((fold_dir / 'calibration_selection.json').read_text())
        assert abs(score['inner_validation_log_loss'] - cal['inner_mean_log_loss']['raw']) < 1e-10
        for curve_path in fold_dir.glob('learning_curves/*/metadata.json'):
            curve = json.loads(curve_path.read_text())
            assert curve['source'] in {'inner_cv_diagnostic', 'inner_cv_selected_count'}
            assert set(curve['train_row_indices']) | set(curve['validation_row_indices']) <= train
            rows = pd.read_csv(curve_path.parent / 'metrics.csv')
            assert 'f2' in rows and np.isfinite(rows.f2).all()
    assert set(evaluated) == development and len(evaluated) == len(development)
for (seed, fold, variant), rows in predictions.groupby(['seed', 'fold', 'variant']):
    expected = binary_metrics(rows.y, rows.probability, rows.threshold, calibration=False)
    saved = metrics[(metrics.seed == seed) & (metrics.fold == fold) & (metrics.variant == variant)].iloc[0]
    for key in expected:
        assert abs(expected[key] - saved[key]) < 1e-10, (seed, fold, variant, key)

source = json.loads((root / 'provenance.json').read_text())
data_path = Path(source['dataset'])
assert hashlib.sha256(data_path.read_bytes()).hexdigest() == source['dataset_sha256']
X, y = split_features_target(pd.read_csv(data_path), 'Cath', 'CAD')
pipeline = joblib.load(root / 'model/cad/pipeline.joblib')
pre = joblib.load(root / 'model/cad/preprocessor.joblib')
model = joblib.load(root / 'model/cad/model.joblib')
metadata = json.loads((root / 'model/cad/metadata.json').read_text())
held_predictions = pd.read_csv(root / 'historical_holdout_predictions.csv')
held = held_predictions[held_predictions.variant == 'selected']
actual = pipeline.predict_proba(X.loc[held.row_index, list(reversed(X.columns))])
np.testing.assert_allclose(actual[:, 1], held.probability, atol=1e-12, rtol=1e-12)
np.testing.assert_allclose(actual, model.predict_proba(pre.transform(X.loc[held.row_index])), atol=1e-12, rtol=1e-12)
assert actual.shape == (len(holdout), 2)
assert model.base_model.model.tree_count_ == metadata['best']['params']['iterations']
assert model.threshold == metadata['threshold']
for name in ['model.joblib', 'preprocessor.joblib', 'metadata.json']:
    assert (root / 'baseline_snapshot/cad' / name).read_bytes() == (Path('training/artifacts/cad') / name).read_bytes()
old = json.loads((root / 'baseline_snapshot/cad/metadata.json').read_text())['best']
baseline = metrics[metrics.variant == 'baseline']
for field, column in [('cv_roc_auc', 'roc_auc'), ('cv_f1', 'f1'), ('cv_pr_auc', 'average_precision'), ('cv_brier', 'brier')]:
    assert abs(old[field] - baseline[column].mean()) < 1e-10, (field, old[field], baseline[column].mean())
result = {'status': 'passed', 'outer_folds': len(config['seeds']) * config['outer_folds'],
          'outer_prediction_rows': len(predictions), 'unique_development_rows': len(development),
          'checks': ['all split boundaries and calibration subfold isolation',
                     'one outer prediction per row/repeat/model variant',
                     'selected-count OOF probabilities match independent fixed-count refits',
                     'all reported outer metrics match saved predictions',
                     'frozen pipeline and preprocessor/model match held-out saved probabilities',
                     'input column reordering preserves predictions',
                     'saved model tree count and threshold match metadata',
                     'serving CAD artifacts and dataset unchanged',
                     '50-fold baseline reproduces historical CV AUC/F1/AP/Brier exactly']}
(root / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
