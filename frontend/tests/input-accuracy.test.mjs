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
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const fieldsUrl = await moduleUrl('../src/fields.ts');
const { FIELDS } = await import(fieldsUrl);
const assessmentUrl = await moduleUrl('../src/assessment.ts', { './fields': fieldsUrl });
const { default: InputAccuracy } = await import(await moduleUrl('../src/components/InputAccuracy.tsx', {
  '../fields': fieldsUrl, '../assessment': assessmentUrl,
  'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href,
}));
const score = { accuracy: .75, correct: 45, n_test: 60, accuracy_interval: { low: .63, high: .84 },
  recall: .5, full_input_accuracy: .85, majority_baseline: .7, model_version: 'fixture' };
const validation = { status: 'available', method: 'held_out_default_substitution', supplied_count: 1,
  total_features: 54, targets: Object.fromEntries(['CAD', 'LAD', 'LCX', 'RCA'].map(key => [key, score])) };
const snapshot = (inputs = { DM: 0 }, input_validation = validation) => ({ inputs, demo: false,
  result: { context: { input_validation } } });
const render = (assessment, outdated = false) => renderToStaticMarkup(createElement(InputAccuracy, { assessment, outdated }));

test('measured accuracy is separate from the submitted input count and coverage', () => {
  const html = render(snapshot());
  assert.match(html, /1 of 54 inputs supplied/);
  assert.match(html, /2%/);
  assert.equal((html.match(/75.0%/g) ?? []).length, 4);
  assert.match(html, /45 \/ 60 classified correctly/);
  assert.match(html, /not the chance that this patient/);
});
test('empty and complete assessments have accurate counts', () => {
  assert.match(render(snapshot({})), /No patient measurements supplied/);
  const full = Object.fromEntries(FIELDS.map(field => [field.key, 0]));
  const html = render(snapshot(full));
  assert.match(html, /54 of 54 inputs supplied/);
  assert.match(html, /0 defaulted/);
  assert.doesNotMatch(html, /No patient measurements supplied/);
});
test('demo, unavailable and older backend responses never invent an accuracy value', () => {
  for (const assessment of [
    { ...snapshot(), demo: true },
    snapshot({}, { status: 'unavailable', reason: 'Missing cohort' }),
    { inputs: {}, result: {}, demo: false },
  ]) {
    const html = render(assessment);
    assert.doesNotMatch(html, /75.0%/);
    assert.match(html, /not evaluated|unavailable/);
  }
});
test('unsubmitted changes preserve the prior assessment score and show a stale notice', () => {
  const html = render(snapshot(), true);
  assert.match(html, /last submitted inputs/);
  assert.match(html, /Analyze again/);
  assert.match(html, /75.0%/);
});
