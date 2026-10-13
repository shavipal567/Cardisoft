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
const probability = await moduleUrl('../src/viewer/probability.ts');
const { probabilityColor, compareProbabilities, PROBABILITY_STOPS, UNAVAILABLE_COLOR } = await import(probability);
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
  '../viewer/probability': probability, '../anatomy/vesselDetail': detail, '../viewer/popupPosition': position, './ArterySchematic': schematic,
}));
const render = (vessel, finding, probability = .81) => renderToStaticMarkup(createElement(ArteryPopup, {
  vessel, finding, probability, viewport: { current: null }, labels: { current: {} }, onClose: () => {},
}));

test('all artery popups show a whole-vessel estimate with no fabricated plaque or spatial markers', () => {
  const routes = ['LAD', 'LCX', 'RCA'].map(vessel => vesselDetail(vessel));
  assert.equal(new Set(routes.map(route => route.centerline)).size, 3);
  for (const vessel of ['LAD', 'LCX', 'RCA']) {
    const html = render(vessel);
    assert.match(html, /Location &amp; diameter narrowing not supplied/);
    assert.match(html, /81.0%/);
    assert.match(html, /one uniform vessel colour/);
    assert.match(html, /does not locate stenosis/);
    assert.doesNotMatch(html, /vessel-detail-plaque|vessel-detail-lesion|Example location|Illustrative stenosis|<circle|<ellipse/);
  }
});

test('probability colours interpolate continuously and reject unavailable outputs instead of inventing risk', () => {
  for (const stop of PROBABILITY_STOPS) assert.equal(probabilityColor(stop.value), stop.color);
  for (const invalid of [undefined, null, NaN, Infinity, -1, 1.01, '0.5']) assert.equal(probabilityColor(invalid), UNAVAILABLE_COLOR);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (const value of [.2, .25, .4, .5, .6, .75, .8]) {
    const before = rgb(probabilityColor(value - .00001)), after = rgb(probabilityColor(value + .00001));
    assert.ok(before.every((v, i) => Math.abs(v - after[i]) <= 1));
  }
});

test('highest probability respects raw values, ties, zero and partial or invalid predictions', () => {
  assert.deepEqual(compareProbabilities({ LAD: .2, LCX: .8, RCA: .5 }), { highest: ['LCX'], complete: true });
  assert.deepEqual(compareProbabilities({ LAD: .8, LCX: .8, RCA: .5 }), { highest: ['LAD', 'LCX'], complete: true });
  assert.deepEqual(compareProbabilities({ LAD: 0, LCX: 0, RCA: 0 }).highest, ['LAD', 'LCX', 'RCA']);
  assert.deepEqual(compareProbabilities({ LAD: .80001, LCX: .80002, RCA: .5 }).highest, ['LCX']);
  assert.deepEqual(compareProbabilities({ LAD: .4, LCX: NaN, RCA: 5 }), { highest: ['LAD'], complete: false });
  assert.deepEqual(compareProbabilities({}), { highest: [], complete: false });
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

test('probability changes colour and the displayed number, never vessel geometry', () => {
  for (const vessel of ['LAD', 'LCX', 'RCA']) {
    const low = render(vessel, undefined, .01), high = render(vessel, undefined, .99);
    const paths = html => [...html.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(paths(low), paths(high));
    assert.match(low, new RegExp(probabilityColor(.01)));
    assert.match(high, new RegExp(probabilityColor(.99)));
    assert.match(low, /Not a measurement of diameter narrowing/);
    assert.match(low, /1.0%/); assert.match(high, /99.0%/);
  }
});

test('explicitly supplied measurements stay separate and never deform the probability diagram', () => {
  const finding = { source: 'Synthetic measured fixture', lesions: [{ location: 'distal', start_fraction: .2, end_fraction: .6, diameter_stenosis_percent: 65 }] };
  const html = render('RCA', finding, .2);
  assert.match(html, /Separately supplied findings/);
  assert.match(html, /65%/); assert.match(html, /20.0%/);
  assert.match(html, /Synthetic measured fixture/);
  const paths = value => [...value.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(paths(html), paths(render('RCA', undefined, .2)));
  assert.doesNotMatch(html, /vessel-detail-plaque|vessel-detail-lesion|Example location/);
  // The independent data-normalization utility still preserves measured narrowing.
  assert.equal(lumenRadiusFraction(.4, finding.lesions), .35);
});

test('tapered tubes have smooth decreasing radii, finite normals and a shared left-main junction', async () => {
  const { loadCoronaries } = await import(coronary);
  const { taperedTube } = await import(await moduleUrl('../src/anatomy/taperedTube.ts', { three, './registration': registration }));
  const THREE = await import(three);
  const anatomy = loadCoronaries();
  assert.ok(anatomy.routes.LAD.points[0].equals(anatomy.routes.LCX.points[0]));
  assert.ok(anatomy.leftMain.at(-1).equals(anatomy.routes.LAD.points[0]));
  for (const { points } of Object.values(anatomy.routes)) {
    const geometry = taperedTube(points), vertices = geometry.getAttribute('position');
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const rings = vertices.count / 13 - 1;
    let previous = Infinity;
    for (let i = 0; i <= rings; i++) {
      const radius = new THREE.Vector3().fromBufferAttribute(vertices, i * 13).distanceTo(curve.getPointAt(i / rings));
      assert.ok(radius <= previous + 1e-6, 'taper must not create a localized constriction');
      assert.ok(radius >= .00849 && radius <= .01901);
      previous = radius;
    }
    assert.ok(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite));
    assert.equal(geometry.getAttribute('color'), undefined, 'no spatial probability colours');
    geometry.dispose();
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
