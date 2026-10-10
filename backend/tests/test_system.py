"""Regression checks for live inference, metadata, explanations and validation.

Run: python -m unittest discover -s backend/tests -v
"""
import asyncio
import csv
import json
import sys
import unittest
from pathlib import Path

import httpx
import numpy as np
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "training")]
from main import app
from schemas import PatientInput
from inference import predict_patient, transformed_row, get_artifact
from preprocessing import ALL_INPUT_FEATURES, LEAKAGE_COLUMNS
from services.explainer import explain_patient, feature_groups, permutation_contributions
from model_info import model_info


class SchemaTests(unittest.TestCase):
    def test_defaults_and_aliases(self):
        p = PatientInput.model_validate({"Sex": "Fmale", "Current Smoker": 1, "EF-TTE": 55})
        self.assertEqual(p.Sex, "Female")
        self.assertEqual(p.to_feature_dict()["Current Smoker"], 1)
        self.assertEqual(set(p.to_feature_dict()), set(ALL_INPUT_FEATURES))

    def test_invalid_inputs_rejected(self):
        for field, value in [("Age", -10), ("Age", 101), ("Sex", "invalid"), ("DM", 4),
                             ("DM", True), ("DM", 0.5), ("BMI", float('nan')),
                             ("BP", float('inf')), ("BP", 0), ("Age", None),
                             ("VHD", "unknown"), ("BBB", "unknown"), ("CRF", "yes"),
                             ("Region RWMA", 5), ("Function Class", -1), ("Lymph", 101),
                             ("WBC", -1), ("typo", 1), *[(key, "Normal") for key in LEAKAGE_COLUMNS]]:
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                PatientInput.model_validate({field: value})

    def test_dataset_inputs_remain_accepted(self):
        with (ROOT / "dataset/dataset.csv").open() as f:
            rows = list(csv.DictReader(f))
        defaults = PatientInput().to_feature_dict()
        for row in rows:
            values = {key: (int(float(row[key])) if isinstance(defaults[key], int)
                            else float(row[key]) if isinstance(defaults[key], float) else row[key])
                      for key in defaults}
            PatientInput.model_validate(values)


class InferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patient = PatientInput().to_feature_dict()
        cls.other = PatientInput(Age=80, DM=1, HTN=1, BP=180,
                                Typical_Chest_Pain=1, EF_TTE=30).to_feature_dict()

    def test_predictions_depend_on_patient(self):
        a, b = predict_patient(self.patient), predict_patient(self.other)
        self.assertNotEqual(a, b)
        for p in [a['cad'], *a['vessels'].values()]:
            self.assertTrue(0 <= p['probability'] <= 1)
            self.assertIn(p['prediction'], (0, 1))

    def test_patient_specific_explanations_and_additivity(self):
        predictions = predict_patient(self.patient)
        for target in ('cad', 'lad', 'lcx', 'rca'):
            with self.subTest(target=target):
                e = explain_patient(self.patient, target, 60)
                other = explain_patient(self.other, target, 60)
                p = predictions['cad'] if target == 'cad' else predictions['vessels'][target.upper()]
                self.assertEqual(e['method'], 'permutation_shapley')
                self.assertTrue(e['signed'])
                self.assertEqual(len(e['features']), 54)
                self.assertAlmostEqual(e['probability'], p['probability'], places=10)
                self.assertAlmostEqual(e['base_value'] + sum(x['contribution'] for x in e['features']), e['probability'], places=10)
                self.assertNotEqual({x['name']: x['contribution'] for x in e['features']},
                                    {x['name']: x['contribution'] for x in other['features']})
                self.assertEqual({x['name'] for x in e['features']}, set(ALL_INPUT_FEATURES))
                for x in e['features']:
                    self.assertEqual(x['raw_value'], self.patient[x['name']])

    def test_top_k_and_repeatability(self):
        a = explain_patient(self.patient, 'cad', 3)
        b = explain_patient(self.patient, 'cad', 3)
        self.assertEqual(a, b)
        self.assertEqual(len(a['features']), 3)
        self.assertAlmostEqual(a['base_value'] + sum(f['contribution'] for f in a['features'])
                               + a['remaining_contribution'], a['probability'], places=10)

    def test_categorical_columns_grouped(self):
        _, names = transformed_row(self.patient, 'lad')
        groups = feature_groups(names)
        self.assertEqual(len(groups['Sex']), 2)
        self.assertEqual(sorted(i for g in groups.values() for i in g), list(range(len(names))))
        self.assertFalse(set(groups) & set(LEAKAGE_COLUMNS))

    def test_known_linear_model_attributions(self):
        class LinearProbability:
            def predict_proba(self, x):
                p = 0.2 + x @ np.array([0.1, 0.2, 0.05])
                return np.column_stack([1-p, p])
        bg = np.array([[0, 0, 0], [1, 0, 1]])
        x = np.array([1, 1, 0])
        base, prediction, c = permutation_contributions(LinearProbability(), x, bg, {'a': [0], 'b': [1], 'c': [2]})
        np.testing.assert_allclose(c, [0.05, 0.2, -0.025], atol=1e-12)
        self.assertAlmostEqual(base + sum(c), prediction)

    def test_metadata_matches_saved_evaluation(self):
        info = model_info()
        metrics = json.loads((ROOT / 'training/artifacts/metrics.json').read_text())
        self.assertEqual(info['targets']['CAD']['model_name'], 'CatBoost')
        for t, row in info['targets'].items():
            self.assertEqual(row['roc_auc'], metrics[t.lower()]['roc_auc'])
            self.assertEqual(row['positive_rate'], metrics[t.lower()]['pos_rate'])
        self.assertEqual(info, json.loads((ROOT / 'frontend/public/model-info.json').read_text()))


class ApiTests(unittest.TestCase):
    def test_http_contract(self):
        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
                self.assertTrue((await c.get('/health')).json()['artifacts_loaded'])
                self.assertEqual((await c.get('/model-info')).status_code, 200)
                defaults = (await c.get('/input-defaults')).json()
                self.assertEqual(defaults, PatientInput().to_feature_dict())
                self.assertEqual(defaults, json.loads((ROOT / 'frontend/public/input-defaults.json').read_text()))
                empty = (await c.post('/predict', json={})).json()['context']
                self.assertEqual(empty['effective_inputs'], defaults)
                self.assertEqual(set(empty['defaulted_inputs']), set(defaults))
                supplied = (await c.post('/predict', json={'Age': 70, 'DM': 0, 'Sex': 'Female'})).json()['context']
                self.assertNotIn('DM', supplied['defaulted_inputs'])
                self.assertNotIn('Sex', supplied['defaulted_inputs'])
                self.assertEqual(supplied['effective_inputs']['Age'], 70)
                self.assertEqual(supplied['effective_inputs']['Sex'], 'Female')
                for key, model in supplied['models'].items():
                    self.assertEqual(model['version'], get_artifact(key.lower())['version'])
                    self.assertEqual(len(model['version']), 64)
                for body in [{'Age': -10}, {'Sex': 'invalid'}, {'DM': 4}, {'Cath': 'CAD'}]:
                    self.assertEqual((await c.post('/predict', json=body)).status_code, 422)
                    self.assertEqual((await c.post('/explain', json={'features': body})).status_code, 422)
                for literal in ['NaN', 'Infinity', '-Infinity']:
                    response = await c.post('/predict', content='{"Age":'+literal+'}', headers={'Content-Type': 'application/json'})
                    self.assertEqual(response.status_code, 422)
                    response = await c.post('/explain', content='{"features":{"Age":'+literal+'}}', headers={'Content-Type': 'application/json'})
                    self.assertEqual(response.status_code, 422)
                self.assertEqual((await c.post('/explain', json={'target': 'invalid'})).status_code, 422)
                e = await c.post('/explain', json={'target': 'cad', 'top_k': 3})
                self.assertEqual(e.status_code, 200)
                self.assertEqual(e.json()['method'], 'permutation_shapley')
                self.assertEqual(e.json()['model_version'], get_artifact('cad')['version'])
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
