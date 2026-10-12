import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const urlFor = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function moduleUrl(file, imports = {}) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to)).replaceAll(`'${from}'`, JSON.stringify(to));
  return urlFor(code.replace('import.meta.env.BASE_URL', '"/"'));
}
const { reportKind, MAX_REPORT_BYTES, extractReport } = await import(await moduleUrl('../src/import/report.ts'));
const fields = await moduleUrl('../src/fields.ts');
const { parsePatientFromText } = await import(await moduleUrl('../src/pdf/fieldMap.ts', { '../fields': fields }));
const factory = urlFor('export const createWorker = (...args) => globalThis.ocrFactory(...args);');
const { recognizeImage } = await import(await moduleUrl('../src/import/imageText.ts', { 'tesseract.js': factory }));

test('accepts PDF and supported report images, including missing camera MIME types', () => {
  for (const [name, type, kind] of [
    ['report.pdf', 'application/pdf', 'pdf'], ['report.PNG', 'image/png', 'image'],
    ['report.jpg', 'image/jpeg', 'image'], ['report.jpeg', '', 'image'],
    ['report.webp', 'image/webp', 'image'], ['report.bmp', 'image/bmp', 'image'],
    ['report.JPG', 'application/octet-stream', 'image'], ['report.PDF', '', 'pdf'],
  ]) assert.equal(reportKind({ name, type, size: 100 }), kind);
});

test('rejects empty, oversized and unsupported files before extraction', () => {
  assert.throws(() => reportKind({ name: 'report.png', type: 'image/png', size: 0 }), /empty/);
  assert.throws(() => reportKind({ name: 'report.png', type: 'image/png', size: MAX_REPORT_BYTES + 1 }), /15 MB/);
  for (const [name, type] of [['report.heic', 'image/heic'], ['report.gif', 'image/gif'], ['fake.png', 'text/html'], ['notes.txt', '']]) {
    assert.throws(() => reportKind({ name, type, size: 100 }), /Unsupported/);
  }
});

test('cancelled imports do not start a reader', async () => {
  await assert.rejects(extractReport({ name: 'report.png', type: 'image/png', size: 100 }, {
    signal: AbortSignal.abort(), onProgress() {},
  }), { name: 'AbortError' });
});

test('OCR-style lines fill recognized measurements and retain explicit negatives', () => {
  const parsed = parsePatientFromText('Age: 58 years\nSex: Female\nBMI: 27.4\nBP: 140/90\nPulse rate: 78\nFBS: 110\nLDL-C: 130\nHDL: 40\nTriglycerides: 160\nLVEF: 50%\nDiabetes: no\nHypertension: present\nSmoking: none');
  assert.deepEqual(parsed.values, { Age: 58, BMI: 27.4, BP: 140, PR: 78, FBS: 110, LDL: 130, HDL: 40, TG: 160, 'EF-TTE': 50, Sex: 0, DM: 0, HTN: 1, 'Current Smoker': 0 });
  const bad = parsePatientFromText('Age: 999\nLDL: 9999\nUnrelated report text');
  assert.deepEqual(bad.values, {});
  assert.equal(bad.skipped.length, 2);
});

const options = (controller = new AbortController()) => ({ signal: controller.signal, onProgress() {} });
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
globalThis.location = { href: 'https://cardisoft.test/assessment' };

test('OCR uses local assets, reports progress and releases its worker after success', async () => {
  let terminated = 0;
  const progress = [];
  globalThis.ocrFactory = async (lang, mode, config) => {
    assert.equal(lang, 'eng');
    assert.equal(mode, 1);
    for (const path of [config.workerPath, config.corePath, config.langPath]) assert.equal(new URL(path).origin, 'https://cardisoft.test');
    config.logger({ status: 'recognizing text', progress: .5 });
    return { recognize: async () => ({ data: { text: 'Age: 58' } }), terminate: async () => { terminated++; } };
  };
  assert.equal(await recognizeImage({}, { ...options(), onProgress: (message) => progress.push(message) }), 'Age: 58');
  assert.ok(progress.some((message) => message.includes('50%')));
  assert.equal(terminated, 1);
});

test('empty OCR results and recognition failures release resources', async () => {
  for (const recognize of [async () => ({ data: { text: '  ' } }), async () => { throw new Error('read failure'); }]) {
    let terminated = false;
    globalThis.ocrFactory = async () => ({ recognize, terminate: async () => { terminated = true; } });
    await assert.rejects(recognizeImage({}, options()), /No readable text|read failure/);
    assert.equal(terminated, true);
  }
});

test('cancelling recognition settles even when the worker job never resolves', async () => {
  let terminated = false;
  globalThis.ocrFactory = async () => ({ recognize: () => new Promise(() => {}), terminate: async () => { terminated = true; } });
  const controller = new AbortController();
  const result = recognizeImage({}, options(controller));
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await nextTurn();
  controller.abort();
  await rejected;
  assert.equal(terminated, true);
});

test('cancelling during initialization disposes of the worker when initialization completes', async () => {
  let ready;
  let terminated = false;
  globalThis.ocrFactory = () => new Promise((resolve) => { ready = resolve; });
  const controller = new AbortController();
  const result = recognizeImage({}, options(controller));
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await nextTurn();
  controller.abort();
  await rejected;
  ready({ terminate: async () => { terminated = true; } });
  await nextTurn();
  assert.equal(terminated, true);
});

test('language/engine loading failure surfaces a retryable error without waiting for timeout', async () => {
  globalThis.ocrFactory = (_lang, _mode, config) => {
    queueMicrotask(() => config.errorHandler('network error'));
    return new Promise(() => {});
  };
  await assert.rejects(recognizeImage({}, options()), /could not load or process/);
});
