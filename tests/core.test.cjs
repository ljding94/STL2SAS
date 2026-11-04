const {test} = require('node:test');
const assert = require('node:assert/strict');
const SAS = require('../src/core.js');
const f = require('./fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');
const identity = SAS.rotationMatrix([0, 0, 0]);
const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) < tol, `${message || ''}: ${a} vs ${b}; tolerance ${tol}`);

test('ASCII STL, binary STL with solid header, and quad OBJ parse the same closed solid', () => {
  for (const [buf, name] of [[f.bytes(f.ascii), 'cube.stl'], [f.binarySTL(), 'cube.STL'], [f.bytes(f.obj), 'cube.obj']]) {
    const mesh = SAS.prepareMesh(buf, name);
    assert.equal(mesh.faces, 12); assert.equal(mesh.span, 2); assert.deepEqual(mesh.dimensions, [2, 2, 2]);
    assert.deepEqual(SAS.checkClosed(mesh.triangles), {boundary: 0, nonmanifold: 0});
    const tree = SAS.buildBVH(mesh.triangles);
    assert.ok(SAS.pointInside(0, 0, 0, mesh.triangles, tree));
    assert.ok(SAS.pointInside(.499, -.499, .499, mesh.triangles, tree));
    assert.ok(!SAS.pointInside(1, 0, 0, mesh.triangles, tree));
  }
});
test('OBJ supports negative vertex indices and concave polygon triangulation', () => {
  const negative = f.obj.replace('f 1 4 3 2', 'f -8 -5 -6 -7');
  assert.equal(SAS.prepareMesh(f.bytes(negative), 'cube.obj').faces, 12);
  const polygon = 'v 0 0 0\nv 2 0 0\nv 2 2 0\nv 1 1 0\nv 0 2 0\nf 1 2 3 4 5';
  assert.equal(SAS.parseOBJ(f.bytes(polygon)).length, 27);
});
test('Open surfaces, non-finite coordinates, malformed faces and unknown files are rejected', () => {
  assert.throws(() => SAS.prepareMesh(f.bytes(f.obj.split('\n').slice(0, -1).join('\n')), 'open.obj'), /closed/);
  assert.throws(() => SAS.prepareMesh(f.bytes(f.obj.replace('v -1 -1 -1', 'v NaN -1 -1')), 'bad.obj'), /non-finite/);
  assert.throws(() => SAS.prepareMesh(f.bytes('v 0 0 0\nf 1 2 3'), 'bad.obj'), /invalid vertex/);
  assert.throws(() => SAS.prepareMesh(new ArrayBuffer(0), 'bad.stl'), /Invalid STL/);
  assert.throws(() => SAS.prepareMesh(new ArrayBuffer(0), 'bad.glb'), /supports/);
});
test('Mesh rejection sampling fills the volume uniformly and reproducibly', () => {
  const mesh = SAS.prepareMesh(f.binarySTL(), 'cube.stl');
  const result = SAS.sampleMesh(mesh, 30000, 42);
  assert.equal(result.acceptance, 1); near(result.volume, 1, 1e-9);
  for (let axis = 0; axis < 3; axis++) {
    let mean = 0, variance = 0;
    for (let i = axis; i < result.points.length; i += 3) { mean += result.points[i] / 30000; variance += result.points[i] ** 2 / 30000; assert.ok(Math.abs(result.points[i]) <= .5); }
    near(mean, 0, .006); near(variance, 1/12, .003);
  }
  assert.deepEqual(SAS.sampleMesh(mesh, 10, 42).points, result.points.slice(0, 30));
});
test('Sphere volume sampling has the expected radius of gyration', () => {
  const {points} = SAS.sampleShape('sphere', 100000, 77);
  for (let i = 0; i < points.length; i += 3) assert.ok(Math.hypot(points[i], points[i+1], points[i+2]) <= .5000001);
  near(SAS.pointStats(points).rg, Math.sqrt(3/5) * .5, .001);
});
test('Concave imported L-prism samples the solid, including its correct missing quadrant', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../examples/concave-L.obj'));
  const mesh = SAS.prepareMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'concave-L.obj');
  const {points, volume} = SAS.sampleMesh(mesh, 20000, 52);
  near(volume, .375, .006);
  for (let i = 0; i < points.length; i += 3) assert.ok(!(points[i] > 0 && points[i+1] > 0), 'cutout remains empty');
  const stats = SAS.pointStats(points);
  near(stats.mean[0], -1/12, .008); near(stats.mean[1], -1/12, .008);
});
test('Nested closed shells preserve an empty cavity with odd-even filling', () => {
  const outer = SAS.prepareMesh(f.binarySTL(), 'cube.stl');
  const triangles = new Float32Array(outer.triangles.length * 2);
  triangles.set(outer.triangles); triangles.set(outer.triangles.map(x => x * .5), outer.triangles.length);
  const tree = SAS.buildBVH(triangles);
  assert.ok(!SAS.pointInside(.01,.02,.03,triangles,tree));
  assert.ok(SAS.pointInside(.4,.03,.02,triangles,tree));
  const sample = SAS.sampleMesh({triangles}, 10000, 45);
  near(sample.volume, 1 - .5 ** 3, .015);
  for (let i = 0; i < sample.points.length; i += 3) assert.ok(Math.max(Math.abs(sample.points[i]),Math.abs(sample.points[i+1]),Math.abs(sample.points[i+2])) >= .25);
});
test('Spatial proposal sampling preserves thin-shell cavities, uniform moments, and volume', () => {
  const outer = SAS.prepareMesh(f.binarySTL(), 'cube.stl'), innerSpan = .98;
  const triangles = new Float32Array(outer.triangles.length * 2);
  triangles.set(outer.triangles); triangles.set(outer.triangles.map(x => x * innerSpan), outer.triangles.length);
  const sample = SAS.sampleMesh({triangles}, 20000, 42), stats = SAS.pointStats(sample.points);
  assert.ok(sample.accelerated); assert.ok(sample.acceptance > .2);
  near(sample.volume, 1 - innerSpan ** 3, .003);
  const expectedSecondMoment = (1 - innerSpan ** 5) / (12 * (1 - innerSpan ** 3));
  for (let a = 0; a < 3; a++) {
    near(stats.mean[a], 0, .008);
    let moment = 0; for (let i = a; i < sample.points.length; i += 3) moment += sample.points[i] ** 2 / 20000;
    near(moment, expectedSecondMoment, .004);
  }
  for (let i = 0; i < sample.points.length; i += 3) assert.ok(Math.max(Math.abs(sample.points[i]), Math.abs(sample.points[i+1]), Math.abs(sample.points[i+2])) >= innerSpan/2 - 1e-7);
});
test('A real curved STL imports, samples its volume, and reproduces ellipsoid moments', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../examples/ellipsoid.stl'));
  const mesh = SAS.prepareMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'ellipsoid.stl');
  assert.equal(mesh.faces, 2208);
  const sample = SAS.sampleMesh(mesh, 20000, 42), stats = SAS.pointStats(sample.points);
  near(stats.rg, Math.sqrt((.5**2 + .27**2 + .18**2)/5), .003);
  near(sample.volume, 4/3 * Math.PI * .5 * .27 * .18, .004);
});
test('Rotation uses Rz Ry Rx, preserves distances and maps X to Y at Z=90', () => {
  const v = SAS.rotatePoints(new Float32Array([1, 0, 0]), SAS.rotationMatrix([0, 0, 90]));
  near(v[0], 0, 1e-6); near(v[1], 1, 1e-6);
  const points = SAS.sampleShape('ellipsoid', 100, 5).points;
  const rotated = SAS.rotatePoints(points, SAS.rotationMatrix([32, -68, 15]));
  near(SAS.pointStats(points).rg, SAS.pointStats(rotated).rg, 1e-7);
});
test('FFT matches direct complex amplitudes on all three reciprocal planes', () => {
  const {points} = SAS.sampleShape('ellipsoid', 20000, 123);
  const matrix = SAS.rotationMatrix([31, -23, 18]), rotated = SAS.rotatePoints(points, matrix);
  const {planes, size, qMaxD} = new SAS.ScatteringEngine().compute(points, matrix, 128, 32);
  const axes = [[0,1],[0,2],[1,2]];
  for (let p = 0; p < 3; p++) {
    assert.equal(planes[p][size/2 * size + size/2], 1);
    for (const [kx, ky] of [[1,0],[0,4],[6,-3],[10,9],[-20,15],[40,-32]]) {
      const q = [0,0,0]; q[axes[p][0]] = kx * 2 * qMaxD / size; q[axes[p][1]] = ky * 2 * qMaxD / size;
      const value = planes[p][(ky + size/2) * size + kx + size/2];
      near(value, SAS.directIntensity(rotated, q), .0003, `plane ${p}, k=(${kx},${ky})`);
      near(value, planes[p][(-ky + size/2) * size - kx + size/2], 1e-7, 'Friedel symmetry');
    }
  }
});
test('Sphere FFT agrees with analytic normalized form factor in the low-q region', () => {
  const points = SAS.sampleShape('sphere', 100000, 42).points;
  const {planes, size} = new SAS.ScatteringEngine().compute(points, identity, 128, 32);
  for (let k = 1; k <= 16; k++) {
    const qR = k * .5 * .5, exact = (3 * (Math.sin(qR) - qR * Math.cos(qR)) / qR ** 3) ** 2;
    near(planes[0][size/2 * size + size/2 + k], exact, .004, `qR=${qR}`);
  }
});
test('All detectors share identical intensities along shared laboratory axes', () => {
  const points = SAS.sampleShape('cube', 10000, 7).points;
  const {planes, size} = new SAS.ScatteringEngine().compute(points, SAS.rotationMatrix([15,18,35]), 128, 32), half = size/2;
  for (let k = -30; k <= 30; k++) {
    near(planes[0][half*size+half+k], planes[1][half*size+half+k], 1e-6, 'X axis');
    near(planes[0][(half+k)*size+half], planes[2][half*size+half+k], 1e-6, 'Y axis');
    near(planes[1][(half+k)*size+half], planes[2][(half+k)*size+half], 1e-6, 'Z axis');
  }
});
test('FFT bounds and normalization hold at the largest supported qD and rotated cube', () => {
  const points = SAS.sampleShape('cube', 5000, 42).points, engine = new SAS.ScatteringEngine();
  const result = engine.compute(points, SAS.rotationMatrix([45, 45, 45]), 128, 120);
  for (const plane of result.planes) { assert.equal(plane[64*128+64], 1); assert.ok(plane.every(x => Number.isFinite(x) && x >= 0)); }
  assert.throws(() => engine.compute(points, identity, 64, 32), /size/);
});
