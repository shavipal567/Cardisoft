import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
    .replace('"three"', JSON.stringify(new URL('../node_modules/three/build/three.module.js', import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { registerHeart } = await loadModule('../src/anatomy/registration.ts');
const { hollowMajorVessels } = await loadModule('../src/anatomy/vesselLumens.ts');

async function loadHeart() {
  const asset = await readFile(new URL('../public/heart.glb', import.meta.url));
  const jsonLength = asset.readUInt32LE(12);
  const json = JSON.parse(asset.subarray(20, 20 + jsonLength).toString());
  // Exercise the real asset without a browser's image decoding dependencies.
  json.materials = [{ doubleSided: true }];
  for (const key of ['textures', 'images', 'samplers']) delete json[key];
  const binary = asset.subarray(28 + jsonLength);
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4);
  const data = Buffer.from(text), buffer = Buffer.alloc(28 + data.length + binary.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(data.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); data.copy(buffer, 20);
  buffer.writeUInt32LE(binary.length, 20 + data.length); buffer.writeUInt32LE(0x004e4942, 24 + data.length);
  binary.copy(buffer, 28 + data.length);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  return gltf.scene;
}

function geometryHash(geometry) {
  const hash = createHash('sha256');
  for (const attribute of [geometry.index, ...Object.values(geometry.attributes)]) {
    const array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return hash.digest('hex');
}

function checkRimContinuity(mesh, center, axis) {
  const index = mesh.geometry.index, position = mesh.geometry.getAttribute('position');
  const edges = new Map();
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let rimEdges = 0;
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    const [a, b] = key.split(':').map((i) => new THREE.Vector3().fromBufferAttribute(position, Number(i)).applyMatrix4(mesh.matrixWorld));
    if (Math.abs(a.clone().sub(center).dot(axis)) > 0.04 || Math.abs(b.clone().sub(center).dot(axis)) > 0.04) continue;
    rimEdges++;
    assert.ok(a.distanceTo(b) < 0.025, `${mesh.name}: rim must follow a continuous cut contour (${a.distanceTo(b)})`);
  }
  assert.ok(rimEdges > 12, 'rim must join the outer vessel along its complete contour');
}

test('large arteries and veins have open lumens and preserve the cached heart', async () => {
  // Independent observations from the original cap surfaces.
  const mouths = [
    { point: [-0.12, 1.16, 0.10], axis: [-0.232, 0.952, 0.199], name: 'Aortic branch inner wall' },
    { point: [0.112, 1.167, -0.0125], axis: [0, 1, 0], name: 'Aortic branch inner wall' },
    { point: [0.25, 1.156, -0.177], axis: [0.09, 0.995, -0.032], name: 'Aortic branch inner wall' },
    { point: [0.615, 0.445, -0.125], axis: [1, 0, 0], name: 'Pulmonary artery inner wall' },
    { point: [-0.377, 1.184, 0.058], axis: [0, 1, 0], name: 'Vena cava inner wall' },
    { point: [-0.415, -1.089, 0.001], axis: [0, -1, 0], name: 'Vena cava inner wall' },
    { point: [-0.0386, 1.002, 0.273], axis: [0.88, 0.18, 0.4], name: 'Upper venous branch inner wall' },
    { point: [0.682, 0.26, -0.293], axis: [1, 0, 0], name: 'Pulmonary vein inner wall' },
    { point: [0.712, 0.066, -0.323], axis: [1, 0, 0], name: 'Pulmonary vein inner wall' },
  ];
  const source = await loadHeart();
  const originals = new Map();
  source.traverse((object) => {
    if (object.isMesh) originals.set(object.geometry, geometryHash(object.geometry));
  });
  const original = registerHeart(source), heart = registerHeart(source);
  const owned = hollowMajorVessels(heart);
  const ray = new THREE.Raycaster();
  const walls = heart.children.filter((object) => object.name === 'Aortic branch inner wall');
  assert.equal(walls.length, 3);
  assert.equal(heart.children.filter((object) => object.name === 'Pulmonary artery inner wall').length, 1);
  assert.equal(heart.children.filter((object) => object.name === 'Vena cava inner wall').length, 2);
  assert.equal(heart.children.filter((object) => object.name === 'Upper venous branch inner wall').length, 1);
  assert.equal(heart.children.filter((object) => object.name === 'Pulmonary vein inner wall').length, 2);

  for (const { point, axis, name } of mouths) {
    const center = new THREE.Vector3(...point), outward = new THREE.Vector3(...axis).normalize();
    // Approach the upper side branch from above; its other side faces into the
    // aorta, so an exterior probe there would start inside a neighbouring vessel.
    const sideways = (Math.abs(outward.x) < 0.9 && name !== 'Upper venous branch inner wall'
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .projectOnPlane(outward).normalize();
    if (name === 'Pulmonary vein inner wall' && center.y < 0.1) sideways.negate();
    for (const offset of [-0.025, 0, 0.025]) {
      ray.set(center.clone().addScaledVector(outward, 0.1).addScaledVector(sideways, offset), outward.clone().negate());
      assert.ok(ray.intersectObject(original, true)[0].distance < 0.13, 'original asset has a solid cap');
      const hit = ray.intersectObject(heart, true)[0];
      assert.ok(!hit || hit.distance > 0.30, `${name}: lumen must be open well below the rim (${hit?.distance})`);
    }
    ray.set(center.clone().addScaledVector(outward, -0.10), sideways);
    const wall = ray.intersectObject(heart, true)[0];
    assert.equal(wall.object.name, name);
    const maxBore = ['Pulmonary artery inner wall', 'Vena cava inner wall'].includes(name) ? 0.14 : 0.09;
    assert.ok(wall.distance > 0.025 && wall.distance < maxBore, 'wall has a plausible bore');
    assert.ok(wall.face.normal.clone().transformDirection(wall.object.matrixWorld).dot(sideways) < -0.5,
      'front faces point into the lumen');
    checkRimContinuity(wall.object, center, outward);

    // The outer branch below its lip must remain exactly where it was.
    ray.set(center.clone().addScaledVector(outward, -0.06).addScaledVector(sideways, 0.2), sideways.clone().negate());
    const before = ray.intersectObject(original, true)[0], after = ray.intersectObject(heart, true)[0];
    assert.ok(before.point.distanceTo(after.point) < 1e-6,
      `${name} at ${point}: preserve exterior branch geometry (${before.point.toArray()} → ${after.point.toArray()}; ${after.object.name})`);
  }
  // The lumen follows the trunk's bend rather than exposing background through
  // the open end of a short straight sleeve when viewed from the side.
  ray.set(new THREE.Vector3(4, 1.4, -1), new THREE.Vector3(0.598, 0.46, -0.125).sub(new THREE.Vector3(4, 1.4, -1)).normalize());
  assert.equal(ray.intersectObject(heart, true)[0].object.name, 'Pulmonary artery inner wall');
  for (const [x, y] of [[0.48, 0.451], [0.36, 0.451], [0.27, 0.37], [0.20, 0.26], [0.16, 0.16]]) {
    for (const side of [-1, 1]) {
      ray.set(new THREE.Vector3(x, y, side * 3), new THREE.Vector3(0, 0, -side));
      const before = ray.intersectObject(original, true)[0], after = ray.intersectObject(heart, true)[0];
      assert.ok(before.point.distanceTo(after.point) < 1e-6, 'curved lining stays inside the exterior');
    }
  }
  const coronaries = JSON.parse(await readFile(new URL('../src/anatomy/heart-coronaries.json', import.meta.url), 'utf8'));
  for (const [name, route] of Object.entries(coronaries.routes)) {
    for (const i of [0, 16, 32, 48, 64, 80, 96]) {
      const normal = new THREE.Vector3(...route.normals[i]);
      ray.set(new THREE.Vector3(...route.points[i]), normal.negate());
      const before = ray.intersectObject(original, true)[0], after = ray.intersectObject(heart, true)[0];
      assert.ok(before.point.distanceTo(after.point) < 1e-6, `${name}: preserve small coronary surface vessels`);
    }
  }
  for (const [geometry, hash] of originals) assert.equal(geometryHash(geometry), hash, 'cached GLB geometry is immutable');

  const replacements = new Set();
  heart.traverse((object) => {
    if (object.isMesh && !originals.has(object.geometry)) replacements.add(object.geometry);
  });
  const disposed = new Set();
  for (const geometry of [...originals.keys(), ...replacements]) geometry.addEventListener('dispose', () => disposed.add(geometry));
  owned.dispose();
  assert.deepEqual(disposed, replacements, 'dispose only the geometry owned by this viewer');
});
