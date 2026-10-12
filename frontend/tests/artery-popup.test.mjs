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
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replaceAll('import.meta.env', '{}');
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const three = import.meta.resolve('three');
const registration = await moduleUrl('../src/anatomy/registration.ts', { three });
const registered = await readFile(new URL('../src/anatomy/heart-coronaries.json', import.meta.url), 'utf8');
const coronary = await moduleUrl('../src/anatomy/coronary.ts', {
  three, './registration': registration,
  './heart-coronaries.json': `data:text/javascript;base64,${Buffer.from(`export default ${registered}`).toString('base64')}`,
});
const stenosis = await moduleUrl('../src/anatomy/stenosis.ts');
const detail = await moduleUrl('../src/anatomy/vesselDetail.ts', { three, './coronary': coronary, './stenosis': stenosis });
const position = await moduleUrl('../src/viewer/popupPosition.ts');
const { normalizeVesselFindings, lumenRadiusFraction, formatModelProbability } = await import(stenosis);
const { vesselDetail } = await import(detail);
const { popupPosition } = await import(position);
const schematic = await moduleUrl('../src/components/ArterySchematic.tsx', {
  react: pathToFileURL(require.resolve('react')).href,
  'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href,
});
const { default: ArteryPopup } = await import(await moduleUrl('../src/components/ArteryPopup.tsx', {
  react: pathToFileURL(require.resolve('react')).href,
  'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href,
  '../anatomy/coronary': coronary, '../anatomy/stenosis': stenosis,
  '../anatomy/vesselDetail': detail, '../viewer/popupPosition': position, './ArterySchematic': schematic,
}));
const render = (vessel, finding, probability = .81) => renderToStaticMarkup(createElement(ArteryPopup, {
  vessel, finding, probability, viewport: { current: null }, labels: { current: {} }, onClose: () => {},
}));

test('each vessel has distinct reference geometry and explicitly illustrative plaque without inventing clinical lesions', () => {
  const routes = ['LAD', 'LCX', 'RCA'].map(vessel => vesselDetail(vessel));
  assert.equal(new Set(routes.map(route => route.centerline)).size, 3);
  for (const [i, vessel] of ['LAD', 'LCX', 'RCA'].entries()) {
    assert.deepEqual(routes[i].markers, []);
    assert.equal(routes[i].plaqueIsExample, true);
    assert.equal(routes[i].plaques.length, 1);
    const html = render(vessel);
    assert.match(html, /Location &amp; diameter narrowing not supplied/);
    assert.match(html, /Model-estimated probability/);
    assert.match(html, /81.0%/);
    assert.doesNotMatch(html, /Reported segment|vessel-detail-lesion/);
    assert.match(html, /vessel-detail-plaque/);
    assert.match(html, /Example location only/);
    assert.match(html, /Illustrative visualization only\. The plaque shown does not represent this patient&#x27;s actual plaque burden, location, or degree of stenosis\./);
  }
  assert.equal(new Set(routes.map(route => route.plaques[0].path)).size, 3);
});

test('missing, empty and invalid findings do not imply a healthy artery or create a lesion', () => {
  for (const value of [undefined, null, {}, { LAD: { lesions: [] } },
    { LAD: { lesions: [{ start_fraction: -.1, end_fraction: 1.1, diameter_stenosis_percent: 150 }, null, {}] } }]) {
    assert.equal(normalizeVesselFindings(value), undefined);
  }
  const data = normalizeVesselFindings({ LAD: { lesions: [
    { start_fraction: .8, end_fraction: .2, diameter_stenosis_percent: 60 },
    { location: 'proximal', diameter_stenosis_percent: '70' },
    { start_fraction: .2, end_fraction: .3, diameter_stenosis_percent: NaN },
  ] } });
  assert.deepEqual(data.LAD.lesions, [{ diameter_stenosis_percent: 60 }, { location: 'proximal' }, { start_fraction: .2, end_fraction: .3 }]);
});

test('anatomy probability formatting preserves the same estimate and rejects invalid values', () => {
  assert.equal(formatModelProbability(.546), '54.6%');
  assert.equal(formatModelProbability(0), '0.0%');
  assert.equal(formatModelProbability(1), '100.0%');
  for (const invalid of [undefined, NaN, Infinity, -.1, 54.6]) {
    assert.equal(formatModelProbability(invalid), 'Unavailable');
  }
});

test('probability never changes cutaway or explanatory cross-section geometry', () => {
  for (const vessel of ['LAD', 'LCX', 'RCA']) {
    const low = render(vessel, undefined, .01), high = render(vessel, undefined, .99);
    const figure = html => html.match(/<figure[\s\S]*?<\/figure>/)[0];
    assert.equal(figure(low), figure(high));
    assert.match(low, /Reference<br\/>segment/);
    assert.match(low, /Illustrative<br\/>stenosis/);
    assert.match(low, /Explanatory cross-sections, not patient measurements/);
    assert.match(low, /Arterial wall/);
    assert.match(low, /Not a measurement of diameter narrowing/);
    // No apparent clinical percentage is printed in either illustration.
    assert.doesNotMatch(figure(low), /\d+(?:\.\d+)?%/);
  }
});

test('reported lumen measurements remain independent of illustrative plaque', () => {
  const lesion = { start_fraction: .2, end_fraction: .6, diameter_stenosis_percent: 75 };
  assert.equal(lumenRadiusFraction(.1, [lesion]), 1);
  assert.equal(lumenRadiusFraction(.8, [lesion]), 1);
  assert.equal(lumenRadiusFraction(.4, [lesion]), .25);
  assert.equal(lumenRadiusFraction(.4, [{ ...lesion, diameter_stenosis_percent: 100 }]), 0);
  assert.equal(lumenRadiusFraction(.4, [{ ...lesion, diameter_stenosis_percent: 0 }]), 1);
  assert.equal(lumenRadiusFraction(.4, [{ start_fraction: .2, end_fraction: .6 }]), 1);
  assert.equal(lumenRadiusFraction(.4, [{ location: 'mid', diameter_stenosis_percent: 75 }]), 1);
  const plain = vesselDetail('LAD');
  const measured = vesselDetail('LAD', [lesion]);
  assert.notEqual(measured.lumen, plain.lumen);
  assert.equal(measured.markers.length, 1);
  assert.equal(vesselDetail('LAD', [{ diameter_stenosis_percent: 75 }]).markers.length, 0);
});

test('partial findings keep unknown clinical locations and severities distinct from the plaque example', () => {
  const located = render('LCX', { source: 'Test fixture', lesions: [{ start_fraction: .1, end_fraction: .3 }] });
  assert.match(located, /Numbered markers: reported segments/);
  assert.match(located, /Diameter narrowing: <b>unavailable/);
  const measured = render('RCA', { lesions: [{ location: 'distal', diameter_stenosis_percent: 65 }] }, .2);
  assert.match(measured, /65%/);
  assert.match(measured, /20.0%/);
  assert.match(measured, /Position on vessel unavailable/);
  assert.doesNotMatch(measured, /vessel-detail-lesion/);
  assert.match(measured, /Example location only/);
});

test('plaque follows supplied segment boundaries, preserves measurements and never substitutes an example for reported zero narrowing', () => {
  const lesions = [{ start_fraction: .1, end_fraction: .3, diameter_stenosis_percent: 75 }];
  const before = structuredClone(lesions);
  const drawing = vesselDetail('LCX', lesions);
  assert.equal(drawing.plaqueIsExample, false);
  assert.equal(drawing.plaques.length, 2);
  assert.deepEqual(lesions, before);
  assert.equal(lumenRadiusFraction(.2, lesions), .25);
  for (const plaque of drawing.plaques) {
    assert.doesNotMatch(plaque.path, /NaN|Infinity/);
    const vertices = [...plaque.path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const half = vertices.length / 2;
    // Each deposit closes against its attached wall at both ends, while its
    // inner surface protrudes into the reference lumen between those endpoints.
    assert.deepEqual(vertices[0], vertices.at(-1));
    assert.deepEqual(vertices[half - 1], vertices[half]);
    assert.ok(vertices.slice(0, half).some((v, i) => Math.hypot(v[0] - vertices.at(-1-i)[0], v[1] - vertices.at(-1-i)[1]) > 1));
  }
  const other = vesselDetail('LCX', [{ ...lesions[0], start_fraction: .7, end_fraction: .9 }]);
  assert.notEqual(other.plaques[0].path, drawing.plaques[0].path);
  for (const zero of [[{ ...lesions[0], diameter_stenosis_percent: 0 }], [{ diameter_stenosis_percent: 0 }]]) {
    assert.deepEqual(vesselDetail('LAD', zero).plaques, []);
  }
  const html = render('LCX', { lesions }, .34);
  assert.match(html, /75%/);
  assert.match(html, /34.0%/);
  assert.doesNotMatch(html, /Example location/);
});

test('short, endpoint and multiple lesions remain finite with visible numbered markers', () => {
  const drawing = vesselDetail('RCA', [
    { start_fraction: 0, end_fraction: .002, diameter_stenosis_percent: 90 },
    { start_fraction: .999, end_fraction: 1, diameter_stenosis_percent: 100 },
  ]);
  assert.equal(drawing.markers.length, 2);
  assert.doesNotMatch(drawing.lumen, /NaN|Infinity/);
  for (const marker of drawing.markers) {
    assert.ok(marker.path.length > 100);
    assert.ok(marker.labelX >= 9 && marker.labelX <= 291);
    assert.ok(marker.labelY >= 9 && marker.labelY <= 155);
  }
});

test('prediction normalization carries only valid artery-specific findings through the real API path', async () => {
  const { predict } = await import(await moduleUrl('../src/api.ts', {
    './fields': await moduleUrl('../src/fields.ts'),
    './explanation': await moduleUrl('../src/explanation.ts', { './fields': await moduleUrl('../src/fields.ts') }), './anatomy/stenosis': stenosis,
  }));
  const original = globalThis.fetch;
  const result = { cad: { probability: .9, prediction: 1 }, vessels: {
    LAD: { probability: .8, prediction: 1 }, LCX: { probability: .4, prediction: 0 }, RCA: { probability: .2, prediction: 0 } }, vessel_findings: {
    LAD: { source: 'Synthetic test fixture', lesions: [{ location: 'mid', start_fraction: .4, end_fraction: .5, diameter_stenosis_percent: 75 }] },
    LCX: { lesions: [{ diameter_stenosis_percent: -10 }] },
    RCA: { lesions: [{ location: 'distal', diameter_stenosis_percent: 40 }] },
  } };
  globalThis.fetch = async () => new Response(JSON.stringify(result), { status: 200 });
  try {
    const normalized = await predict({});
    assert.equal(normalized.vessel_findings.LAD.lesions[0].diameter_stenosis_percent, 75);
    assert.equal(normalized.vessel_findings.LCX, undefined);
    assert.equal(normalized.vessel_findings.RCA.lesions[0].location, 'distal');
    assert.equal(normalized.vessels.LAD.probability, .8);
    delete result.vessel_findings;
    assert.equal((await predict({})).vessel_findings, undefined);
  } finally { globalThis.fetch = original; }
});

test('popup placement stays inside desktop, mobile and expanded view without covering HUD or zoom controls', () => {
  for (const [width, height] of [[1000, 700], [314, 460], [248, 380]]) {
    const panel = { width: Math.min(302, width - 20), height: Math.min(370, height - 110) };
    for (const [x, y] of [[0, 0], [width / 2, height / 2], [width, height]]) {
      const anchor = { left: x, top: y, width: 70, height: 30 };
      const point = popupPosition(width, height, panel, anchor, [anchor]);
      assert.ok(point.left >= 10 && point.left + panel.width <= width - 10);
      assert.ok(point.top >= 44 && point.top + panel.height <= height - 66);
    }
  }
  const anchor = { left: 450, top: 200, width: 70, height: 30 };
  const point = popupPosition(1000, 700, { width: 302, height: 370 }, anchor, [anchor]);
  assert.ok(point.left > anchor.left + anchor.width || point.left + 302 < anchor.left);
  assert.ok(point.left === 10 || point.left === 688, 'dock away from the central heart when space allows');
});
