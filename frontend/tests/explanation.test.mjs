import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = async (file, imports = {}) => {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const runtime = { react: pathToFileURL(require.resolve('react')).href, 'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href };
const fields = await moduleUrl('../src/fields.ts');
const helpers = await moduleUrl('../src/explanation.ts', { './fields': fields });
const { normalizePrediction, normalizePredictionContext, normalizeExplanation, featureMeta, featureValue, formatContribution, formatOutput, thresholdMargin, direction, waterfall, explanationMatch } = await import(helpers);
const { default: Card, FeatureDetails } = await import(await moduleUrl('../src/components/ExplainabilityCard.tsx', {
  ...runtime, '../fields': fields, '../explanation': helpers,
  './LoadingStatus': await moduleUrl('../src/components/LoadingStatus.tsx', runtime),
}));
const pred = { probability: .55, prediction: 0, threshold: .65 };
const context = { models: { RCA: { version: 'model-a', name: 'Fixture model' } }, input_signature: 'patient-a' };
const features = [
  { name: 'DM', raw_value: 0, contribution: .2, provenance: { status: 'recorded' } },
  { name: 'ESR', raw_value: 15, contribution: -.05, provenance: { status: 'default', method: 'schema_default', detail: 'Omitted input; preset server default.' } },
  { name: 'Dyspnea', raw_value: 'N', contribution: 0, provenance: { status: 'default' } },
];
const fixture = (overrides = {}) => normalizeExplanation({ target: 'RCA', base_value: .4, probability: .55, output_value: .55,
  signed: true, output_space: 'probability', method: 'permutation_shapley', model_version: 'model-a', input_signature: 'patient-a',
  remaining_contribution: 0, total_features: 3, features, ...overrides }, 'RCA');
const render = (explanation = fixture(), overrides = {}) => renderToStaticMarkup(createElement(Card, {
  target: 'RCA', prediction: pred, context, explanation, loading: false, onRetry() {}, ...overrides,
}));

test('backend classification is preserved without a frontend cutoff', () => {
  assert.deepEqual(normalizePrediction(pred), pred);
  assert.equal(normalizePrediction({ probability: .95 }), null);
  assert.equal(normalizePrediction(.95), null);
  assert.equal(normalizePrediction({ probability: null, prediction: 0 }), null);
  assert.equal(normalizePrediction({ probability: 9, prediction: 1 }), null);
  assert.equal(normalizePrediction({ probability: .7, prediction: false }).prediction, 0);
  assert.equal(normalizePrediction({ probability: .7, prediction: 1, threshold: null }).threshold, undefined);
  assert.ok(Math.abs(thresholdMargin(.55, .65) + 10) < 1e-10);
  assert.equal(thresholdMargin(.55), null);
  assert.equal(thresholdMargin(.65, .65), 0);
  const html = render();
  assert.match(html, /Negative/);
  assert.match(html, /65.0%/);
  assert.match(html, /−10.00 percentage points/);
});

test('unknown values, provenance, baseline and malformed features are never fabricated', () => {
  const e = normalizeExplanation({ features: [null, { name: 'DM', contribution: .1 }, { name: 'ESR', contribution: null }, { name: 'Age', contribution: '5' }] }, 'RCA');
  assert.equal(e.base_value, null);
  assert.equal(e.features.length, 1);
  assert.equal(e.invalid_features, true);
  assert.equal(e.features[0].value, null);
  assert.equal(e.features[0].provenance.status, 'unavailable');
  assert.equal(featureValue(e.features[0]), 'Value unavailable');
  assert.equal(formatOutput(e.base_value, 'probability'), 'Unavailable');
  const html = render(e, { prediction: { probability: .55, prediction: 1 } });
  assert.match(html, /Threshold unavailable/);
  assert.match(html, /Provenance unavailable/);
  assert.doesNotMatch(html, /NaN|Baseline model output: <b>0/);
});

test('unexpected model metadata and overflowing grouped contributions do not break rendering', () => {
  assert.equal(normalizePredictionContext('invalid'), undefined);
  const c = normalizePredictionContext({ models: { RCA: { version: 123 } }, effective_inputs: { Age: Infinity }, defaulted_inputs: [null] });
  assert.deepEqual(c.models, {});
  assert.deepEqual(c.effective_inputs, {});
  assert.deepEqual(c.defaulted_inputs, []);
  assert.doesNotThrow(() => render(fixture(), { context: c }));
  const e = fixture({ features: [{ name: 'DM', contribution: Number.MAX_VALUE }, { name: 'DM', contribution: Number.MAX_VALUE }] });
  assert.equal(e.features.length, 0);
  assert.equal(e.invalid_features, true);
});

test('units, signs and small values respect the documented output space', () => {
  assert.equal(formatContribution(.0252, 'probability'), '+2.52 pp');
  assert.equal(formatContribution(-.018, 'probability'), '−1.80 pp');
  assert.equal(formatContribution(.0252, 'log_odds'), '+0.03 log-odds');
  assert.equal(formatContribution(.0252), '+0.03 raw units');
  assert.equal(formatContribution(0, 'probability'), '0.00 pp');
  assert.equal(formatContribution(-.0000001, 'probability'), '−<0.01 pp');
  assert.equal(direction(-.00001, true), 'negative');
  assert.equal(direction(0, true), 'neutral');
  assert.equal(direction(1), 'unknown');
});

test('clinical labels and raw values keep distinct meanings', () => {
  assert.equal(featureMeta('DM').label, 'Diabetes mellitus (DM)');
  assert.equal(featureMeta('Atypical').label, 'Atypical chest pain');
  assert.equal(featureMeta('Typical Chest Pain').label, 'Typical chest pain');
  assert.equal(featureMeta('Lymph').unit, '%');
  assert.equal(featureMeta('ESR').unit, 'mm/hr');
  assert.equal(featureValue(fixture().features[0]), 'No'); // Positive SHAP does not imply present.
  assert.equal(featureValue(fixture().features[2]), 'No');
  assert.equal(featureMeta('unmapped').label, 'unmapped');
});

test('one-hot contributions group without replacing raw input with an encoded value', () => {
  const e = normalizeExplanation({ features: [
    { name: 'cat__Sex_Male', value: 1, contribution: .2 }, { name: 'cat__Sex_Female', value: 0, contribution: -.1 },
  ] }, 'RCA');
  assert.equal(e.features.length, 1);
  assert.equal(e.features[0].name, 'Sex');
  assert.equal(e.features[0].contribution, .1);
  assert.equal(e.features[0].value, null);
});

test('waterfall includes omitted contributions, cumulative outputs and final output', () => {
  const e = fixture();
  const w = waterfall(e, e.features.slice(0, 1), true);
  assert.equal(w.reason, undefined);
  assert.equal(w.steps[0].end, .4);
  assert.equal(w.steps[1].contribution, .2);
  assert.equal(w.steps[2].name, 'Other 2 features (combined)');
  assert.ok(Math.abs(w.steps[2].end - .55) < 1e-10);
  assert.equal(w.steps.at(-1).end, .55);
  const truncated = fixture({ features: features.slice(0, 1), remaining_contribution: -.05 });
  assert.equal(waterfall(truncated, truncated.features, true).reason, undefined);
});

test('waterfall refuses mismatched sums, unsigned, empty, undocumented or unverified explanations', () => {
  for (const patch of [{ base_value: null }, { output_value: .8 }, { output_space: undefined }, { signed: false }, { features: [] }, { features: [{ name: 'DM', contribution: NaN }] }]) {
    const e = fixture(patch);
    assert.match(waterfall(e, e.features, true).reason, /unavailable/);
  }
  assert.match(waterfall(fixture(), [], false).reason, /cannot be verified/);
});

test('log-odds waterfall stays in log-odds without inventing a probability conversion', () => {
  const e = fixture({ base_value: -1, output_value: -.85, output_space: 'log_odds' });
  const w = waterfall(e, e.features, true);
  assert.equal(w.reason, undefined);
  assert.equal(w.steps.at(-1).end, -.85);
});

test('ranked probability-space partial sums are not clamped or presented as patient probabilities', () => {
  const e = fixture({ base_value: .9, probability: 1, output_value: 1,
    features: [{ name: 'Age', contribution: .4 }, { name: 'DM', contribution: -.3 }] });
  const steps = waterfall(e, e.features, true).steps;
  assert.equal(steps[1].end, 1.3);
  assert.equal(steps.at(-1).end, 1);
  assert.match(render(e, { prediction: { probability: 1, prediction: 1 } }), /Intermediate sums can fall outside 0–100%/);
  assert.match(render(fixture({ probability: .64999, output_value: .64999 }), { prediction: { probability: .64999, prediction: 0, threshold: .65 } }), /Classification uses unrounded values/);
});

test('prediction identity includes inputs, model, target and probability', () => {
  assert.equal(explanationMatch(fixture(), 'RCA', pred, context), 'verified');
  for (const patch of [{ input_signature: 'other' }, { model_version: 'other' }, { probability: .2 }]) {
    assert.equal(explanationMatch(fixture(patch), 'RCA', pred, context), 'mismatch');
    assert.doesNotMatch(render(fixture(patch)), /class="explain-feature-row/);
  }
  assert.equal(explanationMatch(fixture({ input_signature: undefined }), 'RCA', pred, context), 'unverified');
  assert.throws(() => normalizeExplanation({ target: 'LAD' }, 'RCA'), /does not match/);
});

test('chart renders accessible row buttons, signed bars, counts and collapsible sections', () => {
  const html = render();
  assert.match(html, /Patient-specific feature contributions/);
  assert.match(html, /3 features shown · 1 recorded · 2 automatically supplied/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
  assert.match(html, /class="explain-bar positive"/);
  assert.match(html, /class="explain-bar negative"/);
  assert.match(html, /class="explain-bar neutral"/);
  assert.match(html, /How the estimate was formed/);
  assert.match(html, /Model reliability and limitations/);
  assert.doesNotMatch(html, /<details[^>]+open/);
  assert.match(html, /not causal effects/);
});

test('feature details expose true raw zero and missing metadata without interpreting contribution as disease', () => {
  const e = fixture();
  const html = renderToStaticMarkup(createElement(FeatureDetails, { feature: e.features[0], explanation: e, id: 'details', onClose() {} }));
  assert.match(html, /<dd>No<\/dd>/);
  assert.match(html, /Raw input<\/dt><dd>0/);
  assert.match(html, /\+20.00 percentage points/);
  assert.match(html, /Close Diabetes mellitus/);
  const missing = renderToStaticMarkup(createElement(FeatureDetails, { feature: { name: 'ESR', value: null, contribution: 0 }, explanation: e, id: 'details', onClose() {} }));
  assert.match(missing, /Value unavailable/);
  assert.match(missing, /Provenance unavailable/);
});

test('reliability filters invalid or mismatched metrics and labels selection CV separately', () => {
  const e = fixture({ reliability: { model_version: 'model-a', evaluation: 'Saved held-out test split', n_test: 61, roc_auc: .748,
    threshold: .65, sensitivity: .391, specificity: .842, selection_cv_brier: .211, brier: null } });
  assert.match(render(e), /0.748/);
  assert.match(render(e), /Sensitivity at 65.0%/);
  assert.match(render(e), /CV Brier score · model selection/);
  assert.doesNotMatch(render(e), /Held-out Brier score/);
  assert.match(render(e), /Calibration information is unavailable/);
  assert.match(render(e), /attribution stability assessment is unavailable/);
  assert.doesNotMatch(render(fixture({ reliability: { ...e.reliability, model_version: 'other' } })), /0.748/);
  assert.doesNotMatch(render(fixture({ reliability: { ...e.reliability, threshold: .5 } })), /Sensitivity at/);
});

test('loading, errors, demo and empty responses have honest unavailable states', () => {
  assert.match(render(undefined, { explanation: undefined, loading: true }), /role="status"/);
  assert.match(render(undefined, { explanation: undefined, error: 'Offline' }), /Retry explanation/);
  assert.match(render(fixture({ features: [] })), /No feature contributions/);
  assert.match(render(fixture(), { demo: true }), /Illustrative demo contributions/);
  assert.match(render(fixture(), { demo: true }), /Waterfall unavailable/);
});
