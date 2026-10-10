import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = async (file, imports = {}) => {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replace(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const fieldsUrl = await moduleUrl('../src/fields.ts');
const { FIELDS, fieldError, validate } = await import(fieldsUrl);
const { completeness, displayInput, changedInputs, probabilityChange } = await import(await moduleUrl('../src/assessment.ts', { './fields': fieldsUrl }));
const defaults = JSON.parse(await readFile(new URL('../public/input-defaults.json', import.meta.url), 'utf8'));
const snapshot = (inputs, effective = defaults) => ({ inputs, result: { context: { effective_inputs: effective } } });

test('explicit zero is supplied, while omitted fields are defaulted', () => {
  assert.equal(completeness({}).missing.length, 54);
  const counts = completeness({ Age: 58, DM: 0, Sex: 0 });
  assert.equal(counts.supplied.length, 3);
  assert.equal(counts.missing.length, 51);
  assert.equal(counts.percent, 6);
});
test('all 54 frontend keys have server-derived defaults', () => {
  assert.deepEqual(FIELDS.map((field) => field.key).sort(), Object.keys(defaults).sort());
});
test('categorical defaults and user selections have readable meanings', () => {
  assert.equal(displayInput('Sex', {}, defaults), 'Male');
  assert.equal(displayInput('Sex', { Sex: 0 }, defaults), 'Female');
  assert.equal(displayInput('DM', { DM: 0 }, defaults), 'No');
  assert.equal(displayInput('CRF', {}, defaults), 'No');
  assert.equal(displayInput('VHD', {}, defaults), 'mild');
  assert.equal(displayInput('Age', {}, undefined), 'Default unavailable');
});
test('comparison detects provenance changes even with the same effective value', () => {
  const before = snapshot({ DM: 0 });
  const after = snapshot({});
  assert.deepEqual(changedInputs(before, after).map((field) => field.key), ['DM']);
  assert.deepEqual(changedInputs(after, after), []);
});
test('comparison detects a changed backend default', () => {
  assert.deepEqual(changedInputs(snapshot({}), snapshot({}, { ...defaults, Age: 60 })).map((field) => field.key), ['Age']);
});
test('probability deltas use percentage points and avoid negative zero', () => {
  assert.equal(probabilityChange(.2, .35), '+15.0 pp');
  assert.equal(probabilityChange(.35, .2), '-15.0 pp');
  assert.equal(probabilityChange(.350001, .35), '0.0 pp');
});

test('optional input validation distinguishes missing, invalid numeric and boundary values', () => {
  const age = FIELDS.find((field) => field.key === 'Age');
  const weight = FIELDS.find((field) => field.key === 'Weight');
  assert.equal(fieldError(age, undefined), '');
  assert.equal(fieldError(age, 20), '');
  assert.equal(fieldError(age, 100), '');
  assert.match(fieldError(age, 19), /20.*100/);
  assert.match(fieldError(age, NaN), /valid number/);
  assert.match(fieldError(weight, 0), /greater than 0/);
  assert.equal(fieldError(weight, 0.1), '');
  assert.deepEqual(validate({ Age: 19, DM: 0, 'Function Class': 4 }), ['Age (years)', 'Function class']);
});
