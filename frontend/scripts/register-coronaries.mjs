// Regenerate the mesh-registered overlay after editing its landmarks or asset.
// Textures are excluded from this offline geometry operation; the GLB is unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

const sourceURL = new URL('../src/anatomy/registration.ts', import.meta.url);
const source = await readFile(sourceURL, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  .replace('"three"', JSON.stringify(new URL('../node_modules/three/build/three.module.js', import.meta.url).href));
const { registerHeart, buildCoronaries, SURFACE_OFFSET } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const asset = await readFile(new URL('../public/heart.glb', import.meta.url));
const jsonLength = asset.readUInt32LE(12);
const json = JSON.parse(asset.subarray(20, 20 + jsonLength).toString());
const binary = asset.subarray(28 + jsonLength);
json.materials = [{ doubleSided: true }];
for (const key of ['textures', 'images', 'samplers']) delete json[key];
let text = JSON.stringify(json);
text += ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4);
const data = Buffer.from(text);
const buffer = Buffer.alloc(28 + data.length + binary.length);
buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
buffer.writeUInt32LE(data.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); data.copy(buffer, 20);
buffer.writeUInt32LE(binary.length, 20 + data.length); buffer.writeUInt32LE(0x004e4942, 24 + data.length);
binary.copy(buffer, 28 + data.length);
const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
const heart = registerHeart(gltf.scene);
const anatomy = buildCoronaries(heart);
const { LAD, LCX, RCA } = anatomy.routes;
assert.ok(LAD.points[0].equals(LCX.points[0]), 'LAD and LCX must share a bifurcation');
assert.ok(LAD.points.at(-1).y < -1, 'LAD must reach the apex');
assert.ok(LAD.points.every((p) => p.z > 0), 'LAD must remain anterior');
assert.ok(LCX.points[48].x > 0 && LCX.points.at(-1).z < 0, 'LCX must wrap left to posterior');
assert.ok(RCA.points[48].x < 0 && RCA.points.at(-1).z < 0, 'RCA must wrap right to posterior');
const ray = new THREE.Raycaster();
for (const [name, route] of Object.entries(anatomy.routes)) {
  for (let i = 0; i < route.points.length; i++) {
    const p = route.points[i];
    assert.ok(p.toArray().every(Number.isFinite));
    if (i) assert.ok(p.distanceTo(route.points[i - 1]) < .15, `${name}: discontinuous surface path`);
    ray.set(p, route.normals[i].clone().negate());
    const hit = ray.intersectObject(heart, true)[0];
    assert.ok(hit && Math.abs(hit.distance - SURFACE_OFFSET) < .006, `${name}: overlay left the surface`);
  }
}
const vector = (p) => p.toArray().map((v) => Number(v.toFixed(7)) || 0);
const generated = {
  assetSha256: createHash('sha256').update(asset).digest('hex'),
  registrationSha256: createHash('sha256').update(source).digest('hex'),
  routes: Object.fromEntries(Object.entries(anatomy.routes).map(([name, route]) => [name, {
    points: route.points.map(vector), normals: route.normals.map(vector),
  }])),
  leftMain: anatomy.leftMain.map(vector), rightOrigin: anatomy.rightOrigin.map(vector),
};
const output = new URL('../src/anatomy/heart-coronaries.json', import.meta.url);
if (process.argv.includes('--check')) {
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), generated, 'Regenerate the coronary overlay');
  console.log('Coronary registration verified: asset fingerprint, shared origin, courses, continuity and surface contact.');
} else {
  await writeFile(output, JSON.stringify(generated) + '\n');
  console.log(`Registered and validated all three coronary paths: ${fileURLToPath(output)}`);
}
