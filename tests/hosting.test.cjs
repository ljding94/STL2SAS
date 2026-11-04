const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SAS = require('../src/core.js');
const root = path.join(__dirname, '..');

test('Downloaded models retain their upstream bytes and pass closed-volume sampling', () => {
  for (const [filename, expected, count] of [
    ['trimesh-torus.stl', '91441a7f60479bda93c59dd88134da3b4f33d1df71729fe71e1b2ae989974da3', 8700],
    ['trimesh-angle-block.stl', '512bf110ef9f181e33b1006467a0637f3a0ae2c89e02bca943526a574440c4c9', 704]
  ]) {
    const bytes = fs.readFileSync(path.join(root, 'examples', filename));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected);
    const mesh = SAS.prepareMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), filename);
    assert.equal(mesh.faces, count);
    const sample = SAS.sampleMesh(mesh, 2000, 42);
    assert.equal(sample.points.length, 6000);
    assert.ok(sample.acceptance > .1 && sample.acceptance < .95);
    if (filename.includes('torus')) assert.ok(!SAS.pointInside(0, 0, 0, mesh.triangles, SAS.buildBVH(mesh.triangles)), 'torus central hole stays empty');
  }
});

test('Portable HTML embeds exact example files and preserves their license', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/<script id="example-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'embedded model catalog');
  const examples = JSON.parse(match[1]);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/catalog.json'), 'utf8'));
  assert.deepEqual(Object.keys(examples), catalog.map(entry => entry.id));
  assert.deepEqual(catalog.map(entry => entry.filename).sort(), fs.readdirSync(path.join(root, 'examples')).filter(name => /\.(stl|obj)$/i.test(name)).sort());
  for (const sample of Object.values(examples)) {
    assert.deepEqual(Buffer.from(sample.base64, 'base64'), fs.readFileSync(path.join(root, 'examples', sample.filename)));
    assert.ok(html.includes(`value="${sample.id}"`), `${sample.filename} is selectable`);
    if (sample.licenseFile) assert.equal(sample.license, fs.readFileSync(path.join(root, 'examples', sample.licenseFile), 'utf8'));
  }
  assert.ok(!html.includes('/*__'), 'no unexpanded build placeholders');
});

test('Every catalog example is a valid closed mesh with nonempty volume', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/catalog.json'), 'utf8'));
  for (const entry of catalog) {
    const bytes = fs.readFileSync(path.join(root, 'examples', entry.filename));
    const mesh = SAS.prepareMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entry.filename);
    const {points, volume} = SAS.sampleMesh(mesh, 1000, 42);
    assert.equal(points.length, 3000, entry.filename);
    assert.ok(volume > 0, entry.filename);
  }
});

test('Cloudflare build publishes only intended assets and the same portable HTML', () => {
  const dist = path.join(root, 'dist');
  assert.equal(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.deepEqual(fs.readdirSync(dist).sort(), ['examples', 'index.html']);
  for (const file of ['trimesh-torus.stl', 'trimesh-angle-block.stl', 'TRIMESH-LICENSE.txt']) {
    assert.deepEqual(fs.readFileSync(path.join(dist, 'examples', file)), fs.readFileSync(path.join(root, 'examples', file)));
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.assets.directory, './dist');
  assert.ok(!config.main, 'static-only deployment needs no Worker script');
});
