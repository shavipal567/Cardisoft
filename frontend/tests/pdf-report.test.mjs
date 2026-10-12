import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = async (file, imports = {}) => {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const fields = await moduleUrl('../src/fields.ts');
const { FIELDS, TARGETS } = await import(fields);
const { createAssessmentPdf } = await import(await moduleUrl('../src/pdf/report.ts', {
  jspdf: pathToFileURL(require.resolve('jspdf')).href,
  '../fields': fields,
  '../assessment': await moduleUrl('../src/assessment.ts', { './fields': fields }),
  '../explanation': await moduleUrl('../src/explanation.ts', { './fields': fields }),
}));
const defaults = JSON.parse(await readFile(new URL('../public/input-defaults.json', import.meta.url), 'utf8'));
const prediction = { prediction: 1, probability: .75 };
const score = { accuracy: .75, correct: 45, n_test: 60, accuracy_interval: { low: .63, high: .84 },
  recall: .5, full_input_accuracy: .85, majority_baseline: .7, model_version: 'fixture-model' };
const snapshot = {
  id: 'pdf-regression', createdAt: '2026-10-12T10:00:00Z', name: 'Sample patient', demo: false,
  inputs: { Age: 58, DM: 0 },
  result: { cad: prediction, vessels: { LAD: prediction, LCX: prediction, RCA: prediction }, context: {
    effective_inputs: defaults, defaulted_inputs: FIELDS.map(f => f.key).filter(k => !['Age', 'DM'].includes(k)),
    models: Object.fromEntries(TARGETS.map(t => [t, { name: 'Fixture model', version: 'fixture-model', training_revision: 'fixture-revision' }])),
    input_validation: { status: 'available', targets: Object.fromEntries(TARGETS.map(t => [t, score])) },
  } },
};
const explanations = { CAD: { target: 'CAD', base_value: .4, signed: true, output_space: 'probability', features: [
  { name: 'DM', value: 0, contribution: .2, provenance: { status: 'recorded' } },
  { name: 'ESR', value: 15, contribution: -.05, assumed: true, provenance: { status: 'default' } },
] } };

async function extract(assessment, details = explanations, baseline = null) {
  const doc = await createAssessmentPdf(assessment, details, { LAD: 'Explanation unavailable for LAD.' }, baseline);
  const pdf = await getDocument({ data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true }).promise;
  try {
    const items = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { items: text } = await page.getTextContent();
      items.push(...text.filter(item => item.str?.trim()).map(item => ({ ...item, page: i, height: page.view[3] })));
    }
    return { text: items.map(item => item.str).join(' '), items };
  } finally { await pdf.destroy(); }
}

test('PDF retains validation, model identity, default provenance and contribution units after conflict resolution', async () => {
  const { text } = await extract(snapshot);
  assert.match(text, /75.0%/);
  assert.match(text, /fixture-model/);
  assert.match(text, /fixture-revision/);
  assert.match(text, /Recorded/);
  assert.match(text, /Default \/ Auto-supplied/);
  assert.match(text, /\+20.00 pp/);
  assert.match(text, /-5.00 pp/);
  assert.match(text, /Explanation unavailable for LAD/);
});

test('all 54 patient fields remain inside PDF page bounds, including the final rows', async () => {
  const { text, items } = await extract(snapshot);
  for (const field of FIELDS) assert.ok(text.includes(field.label.replace(/µ/g, 'u').replace(/³/g, '^3')), `Missing field: ${field.label}`);
  for (const item of items) {
    assert.ok(item.transform[5] >= 12 && item.transform[5] <= item.height - 12,
      `Text outside page ${item.page}: ${item.str}`);
  }
});

test('demo reports and comparisons preserve unavailable notices and changed input values', async () => {
  const { text } = await extract({ ...snapshot, demo: true, inputs: { Age: 60, DM: 0 } }, {}, snapshot);
  assert.match(text, /not evaluated in demo mode/);
  assert.match(text, /Demo fixtures/);
  assert.match(text, /Assessment comparison/);
  assert.match(text, /Changed patient inputs/);
  assert.match(text, /58/);
  assert.match(text, /60/);
  assert.match(text, /No heart visualization was available/);
});
