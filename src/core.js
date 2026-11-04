/* STL2SAS numerical core. Dependency-free; shared by the worker and Node tests. */
(function (root) {
  'use strict';
  const MAX_FACES = 200000;
  const TAU = 2 * Math.PI;

  function random(seed = 123456789) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }

  function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength >= 84) {
      const count = view.getUint32(80, true);
      const end = 84 + count * 50;
      // Check the size, rather than the unreliable "solid" header, for binary STL.
      if (count > 0 && end <= buffer.byteLength && buffer.byteLength - end < 256) {
        if (count > MAX_FACES) throw Error('Mesh exceeds the 200,000 triangle MVP limit. Decimate it first.');
        const result = new Float64Array(count * 9);
        for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) result[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
        return result;
      }
    }
    const text = new TextDecoder().decode(buffer);
    const values = [];
    const re = /\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi;
    let m;
    while ((m = re.exec(text))) {
      values.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (values.length > MAX_FACES * 9) throw Error('Mesh exceeds the 200,000 triangle MVP limit.');
    }
    if (!values.length || values.length % 9) throw Error('Invalid STL: expected complete triangle vertices.');
    return new Float64Array(values);
  }

  // Ear clipping supports simple, planar, concave OBJ polygons as well as triangles.
  function triangulate(vertices, polygon) {
    if (polygon.length === 3) return [polygon];
    if (polygon.length > 256) throw Error('OBJ faces may have at most 256 vertices. Triangulate this model before importing.');
    const normal = [0, 0, 0];
    for (let i = 0; i < polygon.length; i++) {
      const a = vertices[polygon[i]], b = vertices[polygon[(i + 1) % polygon.length]];
      normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
      normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
      normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const axes = [0, 1, 2].filter(x => x !== drop);
    const p = polygon.map(i => axes.map(a => vertices[i][a]));
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let area = 0;
    for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; area += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
    const sign = Math.sign(area);
    if (!sign) throw Error('OBJ contains a degenerate polygon.');
    const ids = polygon.map((_, i) => i), out = [];
    while (ids.length > 3) {
      let found = false;
      for (let i = 0; i < ids.length; i++) {
        const a = ids[(i + ids.length - 1) % ids.length], b = ids[i], c = ids[(i + 1) % ids.length];
        if (cross(p[a], p[b], p[c]) * sign <= 0) continue;
        if (ids.some(d => d !== a && d !== b && d !== c && cross(p[a], p[b], p[d]) * sign >= 0 && cross(p[b], p[c], p[d]) * sign >= 0 && cross(p[c], p[a], p[d]) * sign >= 0)) continue;
        out.push([polygon[a], polygon[b], polygon[c]]); ids.splice(i, 1); found = true; break;
      }
      if (!found) throw Error('OBJ contains a non-simple polygon. Triangulate or repair the mesh.');
    }
    out.push(ids.map(i => polygon[i]));
    return out;
  }

  function parseOBJ(buffer) {
    const vertices = [], values = [];
    for (const raw of new TextDecoder().decode(buffer).split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      const tokens = line.split(/\s+/);
      if (tokens[0] === 'v') {
        if (tokens.length < 4) throw Error('Invalid OBJ vertex.');
        const vertex = tokens.slice(1, 4).map(Number);
        if (!vertex.every(Number.isFinite)) throw Error('OBJ contains a non-finite vertex.');
        vertices.push(vertex);
        if (vertices.length > 600000) throw Error('OBJ exceeds the MVP vertex limit.');
      } else if (tokens[0] === 'f') {
        if (tokens.length < 4) throw Error('OBJ face has fewer than three vertices.');
        const poly = tokens.slice(1).map(token => {
          const n = Number(token.split('/')[0]);
          const i = n > 0 ? n - 1 : vertices.length + n;
          if (!Number.isInteger(n) || !n || i < 0 || i >= vertices.length) throw Error('OBJ face references an invalid vertex.');
          return i;
        });
        for (const tri of triangulate(vertices, poly)) for (const i of tri) values.push(...vertices[i]);
        if (values.length > MAX_FACES * 9) throw Error('Mesh exceeds the 200,000 triangle MVP limit.');
      }
    }
    if (!values.length) throw Error('No polygon faces found in this OBJ.');
    return new Float64Array(values);
  }

  function prepareMesh(buffer, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const raw = ext === 'stl' ? parseSTL(buffer) : ext === 'obj' ? parseOBJ(buffer) : null;
    if (!raw) throw Error('This MVP supports .stl (binary or ASCII) and .obj files.');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < raw.length; i++) {
      if (!Number.isFinite(raw[i])) throw Error('Mesh contains non-finite coordinates.');
      const a = i % 3; min[a] = Math.min(min[a], raw[i]); max[a] = Math.max(max[a], raw[i]);
    }
    const dimensions = max.map((x, a) => x - min[a]);
    const span = Math.max(...dimensions);
    if (!(span > 0) || !Number.isFinite(span) || dimensions.some(x => x <= span * 1e-9)) throw Error('The mesh must enclose a nonzero 3D volume.');
    const center = min.map((x, a) => x / 2 + max[a] / 2), normalized = [];
    let degenerate = 0;
    for (let i = 0; i < raw.length; i += 9) {
      const v = Array.from(raw.subarray(i, i + 9), (x, k) => (x - center[k % 3]) / span);
      const u = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], w = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
      const area2 = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
      if (area2 < 1e-14) { degenerate++; continue; }
      normalized.push(...v);
    }
    if (!normalized.length) throw Error('No nondegenerate triangles found.');
    const triangles = new Float32Array(normalized);
    const topology = checkClosed(triangles);
    if (topology.boundary || topology.nonmanifold) throw Error(`Mesh does not form a closed two-manifold surface (${topology.boundary} open edges, ${topology.nonmanifold} non-manifold edges). Repair or close it in your modeling tool, then import again.`);
    return {triangles, span, dimensions, degenerate, faces: triangles.length / 9};
  }

  function checkClosed(triangles) {
    const vertices = new Map(), edges = new Map();
    const vertex = (i) => {
      const key = [0, 1, 2].map(a => Math.round(triangles[i + a] * 1e6)).join(',');
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      return vertices.get(key);
    };
    for (let t = 0; t < triangles.length; t += 9) {
      const ids = [vertex(t), vertex(t + 3), vertex(t + 6)];
      for (let a = 0; a < 3; a++) {
        const u = ids[a], v = ids[(a + 1) % 3];
        const key = u < v ? `${u}:${v}` : `${v}:${u}`;
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    let boundary = 0, nonmanifold = 0;
    for (const n of edges.values()) { if (n === 1) boundary++; else if (n !== 2) nonmanifold++; }
    return {boundary, nonmanifold};
  }

  function buildBVH(triangles) {
    function build(ids) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const t of ids) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
        const x = triangles[t * 9 + v * 3 + a]; min[a] = Math.min(min[a], x); max[a] = Math.max(max[a], x);
      }
      if (ids.length <= 12) return {min, max, ids};
      const widths = max.map((x, a) => x - min[a]), axis = widths.indexOf(Math.max(...widths));
      const centroid = t => triangles[t * 9 + axis] + triangles[t * 9 + axis + 3] + triangles[t * 9 + axis + 6];
      ids.sort((a, b) => centroid(a) - centroid(b));
      const half = ids.length >> 1;
      return {min, max, left: build(ids.slice(0, half)), right: build(ids.slice(half))};
    }
    return build(Array.from({length: triangles.length / 9}, (_, i) => i));
  }

  const ray = [1, 0.3713906763541037, 0.127831374271];
  function pointInside(x, y, z, triangles, tree) {
    const origin = [x, y, z]; let hits = 0;
    function visit(node) {
      let lo = 0, hi = Infinity;
      for (let a = 0; a < 3; a++) {
        lo = Math.max(lo, (node.min[a] - origin[a]) / ray[a]);
        hi = Math.min(hi, (node.max[a] - origin[a]) / ray[a]);
      }
      if (hi < lo) return;
      if (!node.ids) { visit(node.left); visit(node.right); return; }
      for (const t of node.ids) {
        const i = t * 9, ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
        const e1x = triangles[i + 3] - ax, e1y = triangles[i + 4] - ay, e1z = triangles[i + 5] - az;
        const e2x = triangles[i + 6] - ax, e2y = triangles[i + 7] - ay, e2z = triangles[i + 8] - az;
        const px = ray[1] * e2z - ray[2] * e2y, py = ray[2] * e2x - ray[0] * e2z, pz = ray[0] * e2y - ray[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-15) continue;
        const inv = 1 / det, tx = x - ax, ty = y - ay, tz = z - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (ray[0] * qx + ray[1] * qy + ray[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-12) hits++;
      }
    }
    visit(tree);
    return (hits & 1) === 1;
  }

  function buildVolumeProposal(triangles, tree, resolution = 32) {
    const {min, max} = tree, step = max.map((x, a) => (x - min[a]) / resolution);
    const boundary = new Uint8Array(resolution ** 3);
    let marked = 0, markingWork = 0;
    const index = (x, a) => Math.max(0, Math.min(resolution - 1, Math.floor((x - min[a]) / step[a])));
    // Triangle AABBs conservatively retain every cell touching a surface. False
    // positives cost time but cannot discard particle volume or bias sampling.
    for (let t = 0; t < triangles.length; t += 9) {
      const lo = [], hi = [];
      for (let a = 0; a < 3; a++) {
        lo[a] = index(Math.min(triangles[t + a], triangles[t + a + 3], triangles[t + a + 6]), a);
        hi[a] = index(Math.max(triangles[t + a], triangles[t + a + 3], triangles[t + a + 6]), a);
      }
      markingWork += (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (markingWork > 2000000) return null; // Keep pathological triangle AABBs on the simple sampler.
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
        const i = (z * resolution + y) * resolution + x;
        if (!boundary[i]) { boundary[i] = 1; marked++; }
      }
      if (marked === boundary.length) return null; // No empty space can be skipped.
    }
    const cells = [];
    for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const i = (z * resolution + y) * resolution + x;
      // A cell without a surface crossing is wholly inside or wholly outside.
      if (boundary[i] || pointInside(min[0] + (x + .5) * step[0], min[1] + (y + .5) * step[1], min[2] + (z + .5) * step[2], triangles, tree)) cells.push(i);
    }
    return {cells, step, resolution, volume: cells.length * step[0] * step[1] * step[2]};
  }

  function sampleMesh(mesh, count, seed, progress = () => {}) {
    const tree = buildBVH(mesh.triangles), rng = random(seed), points = new Float32Array(count * 3);
    const {min, max} = tree, start = Date.now();
    let accepted = 0, trials = 0, proposal = null, proposalStartTrials = 0, proposalStartAccepted = 0;
    while (accepted < count) {
      let x, y, z;
      if (proposal) {
        const {cells, step, resolution} = proposal, cell = cells[Math.floor(rng() * cells.length)];
        const ix = cell % resolution, iy = Math.floor(cell / resolution) % resolution, iz = Math.floor(cell / (resolution * resolution));
        x = min[0] + (ix + rng()) * step[0]; y = min[1] + (iy + rng()) * step[1]; z = min[2] + (iz + rng()) * step[2];
      } else {
        x = min[0] + rng() * (max[0] - min[0]); y = min[1] + rng() * (max[1] - min[1]); z = min[2] + rng() * (max[2] - min[2]);
      }
      if (pointInside(x, y, z, mesh.triangles, tree)) { points[accepted * 3] = x; points[accepted * 3 + 1] = y; points[accepted * 3 + 2] = z; accepted++; }
      trials++;
      if (trials === 2048 && count >= 5000 && accepted / trials < .35) {
        progress(accepted / count);
        proposal = buildVolumeProposal(mesh.triangles, tree);
        proposalStartTrials = trials; proposalStartAccepted = accepted;
      }
      if (trials % 8192 === 0) {
        progress(accepted / count);
        if (Date.now() - start > 20000 || trials > Math.max(count * 1000, 1000000)) throw Error('Volume sampling timed out. This model may be very thin, self-intersecting, or mostly empty. Try a simpler solid mesh.');
      }
    }
    const volume = proposal ? proposal.volume * (accepted - proposalStartAccepted) / (trials - proposalStartTrials) : (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]) * accepted / trials;
    return {points, acceptance: accepted / trials, volume, accelerated: !!proposal};
  }

  function sampleShape(shape, count, seed = 42) {
    const rng = random(seed), points = new Float32Array(count * 3);
    const axes = shape === 'ellipsoid' ? [0.5, 0.27, 0.18] : [0.5, 0.5, 0.5];
    for (let i = 0; i < count; i++) {
      let x, y, z;
      if (shape === 'cube') { x = rng() - 0.5; y = rng() - 0.5; z = rng() - 0.5; }
      else if (shape === 'cylinder') { const r = Math.sqrt(rng()) * 0.22, a = rng() * TAU; x = r * Math.cos(a); y = r * Math.sin(a); z = rng() - 0.5; }
      else { const u = 2 * rng() - 1, a = rng() * TAU, r = Math.cbrt(rng()); x = r * Math.sqrt(1 - u * u) * Math.cos(a) * axes[0]; y = r * Math.sqrt(1 - u * u) * Math.sin(a) * axes[1]; z = r * u * axes[2]; }
      points.set([x, y, z], i * 3);
    }
    const volume = shape === 'cube' ? 1 : shape === 'cylinder' ? Math.PI * 0.22 ** 2 : 4 / 3 * Math.PI * axes[0] * axes[1] * axes[2];
    return {points, volume, span: 100, dimensions: (shape === 'cylinder' ? [0.44, 0.44, 1] : axes.map(a => a * 2)).map(x => x * 100), faces: 0};
  }

  // Row-major active rotation Rz * Ry * Rx. The same matrix drives all views.
  function rotationMatrix(degrees) {
    const [x, y, z] = degrees.map(a => a * Math.PI / 180), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
  }
  function rotatePoints(points, m, out = new Float32Array(points.length)) {
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i], y = points[i + 1], z = points[i + 2];
      out[i] = m[0] * x + m[1] * y + m[2] * z; out[i + 1] = m[3] * x + m[4] * y + m[5] * z; out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
    }
    return out;
  }

  const fftPlans = new Map();
  function fftPlan(n) {
    if (fftPlans.has(n)) return fftPlans.get(n);
    const bits = Math.log2(n), reverse = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n; i++) { let k = i, r = 0; for (let b = 0; b < bits; b++) { r = (r << 1) | (k & 1); k >>= 1; } reverse[i] = r; }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(TAU * i / n); sin[i] = -Math.sin(TAU * i / n); }
    const plan = {reverse, cos, sin}; fftPlans.set(n, plan); return plan;
  }
  function fft1D(real, imag, offset, stride, n, plan) {
    for (let i = 0; i < n; i++) { const j = plan.reverse[i]; if (j > i) { const a = offset + i * stride, b = offset + j * stride; [real[a], real[b]] = [real[b], real[a]]; [imag[a], imag[b]] = [imag[b], imag[a]]; } }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let block = 0; block < n; block += size) for (let k = 0; k < half; k++) {
        const a = offset + (block + k) * stride, b = a + half * stride, tw = k * step;
        const tr = plan.cos[tw] * real[b] - plan.sin[tw] * imag[b], ti = plan.sin[tw] * real[b] + plan.cos[tw] * imag[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti;
      }
    }
  }
  function fft2D(real, imag, n) {
    const plan = fftPlan(n);
    for (let y = 0; y < n; y++) fft1D(real, imag, y * n, 1, n, plan);
    for (let x = 0; x < n; x++) fft1D(real, imag, x, n, n, plan);
  }
  function sinc(x) { return Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x; }

  class ScatteringEngine {
    constructor() { this.size = 0; }
    compute(points, matrix, size = 128, qMaxD = 32) {
      if (![128, 256, 512].includes(size)) throw Error('Unsupported detector size.');
      if (!(qMaxD >= 4 && qMaxD <= 120)) throw Error('qD must be between 4 and 120.');
      // 2x oversampling keeps displayed frequencies well below the grid Nyquist.
      const n = size * 2, length = n * n, count = points.length / 3;
      if (!count) throw Error('No scattering points.');
      if (this.size !== n) {
        this.size = n; this.real = new Float64Array(length); this.imag = new Float64Array(length);
        this.correction = new Float64Array(size);
        for (let i = 0; i < size; i++) this.correction[i] = 1 / sinc(Math.PI * (i - size / 2) / n) ** 4;
      }
      if (!this.rotated || this.rotated.length !== points.length) this.rotated = new Float32Array(points.length);
      rotatePoints(points, matrix, this.rotated);
      const scale = qMaxD / Math.PI * 2; // h = pi/(2 qMaxD), q step = 2 qMaxD / size.
      const planes = [[0, 1], [0, 2], [1, 2]], output = [];
      for (const [a, b] of planes) {
        const real = this.real, imag = this.imag; real.fill(0); imag.fill(0);
        // Cloud-in-cell deposition conserves scattering mass exactly.
        for (let i = 0; i < this.rotated.length; i += 3) {
          const x = this.rotated[i + a] * scale + n / 2, y = this.rotated[i + b] * scale + n / 2;
          const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
          if (ix < 0 || iy < 0 || ix + 1 >= n || iy + 1 >= n) throw Error('Model exceeds the real-space FFT box. Reduce qD or increase detector resolution.');
          const j = iy * n + ix;
          real[j] += (1 - fx) * (1 - fy); real[j + 1] += fx * (1 - fy); real[j + n] += (1 - fx) * fy; real[j + n + 1] += fx * fy;
        }
        fft2D(real, imag, n);
        const intensity = new Float32Array(size * size), norm = 1 / (count * count), half = size / 2;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const j = ((y - half + n) % n) * n + ((x - half + n) % n);
          intensity[y * size + x] = (real[j] ** 2 + imag[j] ** 2) * norm * this.correction[x] * this.correction[y];
        }
        output.push(intensity);
      }
      return {planes: output, size, qMaxD, count};
    }
  }

  function directIntensity(points, q) {
    let re = 0, im = 0;
    for (let i = 0; i < points.length; i += 3) { const phase = q[0] * points[i] + q[1] * points[i + 1] + q[2] * points[i + 2]; re += Math.cos(phase); im += Math.sin(phase); }
    return (re * re + im * im) / (points.length / 3) ** 2;
  }
  const ISOTROPIC_QUALITIES = {fast: [16, 64], balanced: [32, 128], fine: [64, 256]};
  const gaussRules = new Map();
  function gaussLegendre(order) {
    if (!Number.isInteger(order) || order < 2 || order > 128) throw Error('Invalid angular quadrature order.');
    if (gaussRules.has(order)) return gaussRules.get(order);
    const nodes = new Float64Array(order), weights = new Float64Array(order);
    for (let i = 0; i < Math.ceil(order / 2); i++) {
      let z = Math.cos(Math.PI * (i + .75) / (order + .5)), derivative;
      for (let iteration = 0; iteration < 32; iteration++) {
        let p = 1, previous = 0;
        for (let j = 1; j <= order; j++) { const before = previous; previous = p; p = ((2 * j - 1) * z * previous - (j - 1) * before) / j; }
        derivative = order * (z * p - previous) / (z * z - 1);
        const step = p / derivative; z -= step;
        if (Math.abs(step) < 2e-15) break;
      }
      const w = 2 / ((1 - z * z) * derivative * derivative);
      nodes[i] = -z; nodes[order - 1 - i] = z; weights[i] = w; weights[order - 1 - i] = w;
    }
    const rule = {nodes, weights}; gaussRules.set(order, rule); return rule;
  }

  // Orientational average of INTENSITY, not amplitude, using all original points.
  // Each direction needs one O(N) projection and one small 1D FFT. The particle
  // stays in its body frame: display rotations never enter this calculation.
  function isotropicScattering(points, qMaxD = 120, quality = 'balanced', progress = () => {}) {
    const count = points.length / 3, orders = ISOTROPIC_QUALITIES[quality];
    if (!Number.isInteger(count) || !count) throw Error('No scattering points.');
    if (!(qMaxD >= 4 && qMaxD <= 120)) throw Error('qD must be between 4 and 120.');
    if (!orders) throw Error('Unknown isotropic accuracy.');
    const [polarOrder, azimuthCount] = orders, rule = gaussLegendre(polarOrder);
    // Eight-fold real-space oversampling; zero padding yields 513 radial q values.
    const gridSize = 8192, bins = gridSize / 16 + 1, scale = 8 * qMaxD / Math.PI;
    const dq = 2 * Math.PI * scale / gridSize, qD = new Float64Array(bins), intensity = new Float64Array(bins);
    const real = new Float64Array(gridSize), imag = new Float64Array(gridSize), plan = fftPlan(gridSize), correction = new Float64Array(bins);
    for (let k = 0; k < bins; k++) { qD[k] = k * dq; correction[k] = 1 / sinc(Math.PI * k / gridSize) ** 4; }
    const {mean} = pointStats(points), centered = new Float64Array(points.length);
    let radius = 0;
    for (let i = 0; i < points.length; i += 3) {
      for (let a = 0; a < 3; a++) centered[i + a] = (points[i + a] - mean[a]) * scale;
      radius = Math.max(radius, Math.hypot(centered[i], centered[i + 1], centered[i + 2]));
    }
    if (!Number.isFinite(radius) || radius >= gridSize / 2 - 2) throw Error('Point cloud exceeds the isotropic projection box.');
    const directions = polarOrder / 2 * azimuthCount;
    if (radius < 1e-12) { intensity.fill(1); progress(1); return {qD, intensity, count, qMaxD, quality, directions, polarOrder, azimuthCount, gridSize}; }
    let weightSum = 0;
    for (let p = polarOrder / 2; p < polarOrder; p++) weightSum += rule.weights[p];
    const norm = 1 / (count * count), tick = Math.max(1, Math.floor(directions / 100));
    let completed = 0;
    // I(q)=I(-q) for real uniform contrast: the positive hemisphere suffices.
    for (let p = polarOrder / 2; p < polarOrder; p++) {
      const nz = rule.nodes[p], radial = Math.sqrt(1 - nz * nz), weight = rule.weights[p] / (azimuthCount * weightSum);
      for (let a = 0; a < azimuthCount; a++) {
        const angle = TAU * a / azimuthCount, nx = radial * Math.cos(angle), ny = radial * Math.sin(angle);
        real.fill(0); imag.fill(0);
        for (let i = 0; i < centered.length; i += 3) {
          const x = nx * centered[i] + ny * centered[i + 1] + nz * centered[i + 2] + gridSize / 2;
          const ix = Math.floor(x), fraction = x - ix;
          real[ix] += 1 - fraction; real[ix + 1] += fraction;
        }
        fft1D(real, imag, 0, 1, gridSize, plan);
        for (let k = 0; k < bins; k++) intensity[k] += weight * (real[k] * real[k] + imag[k] * imag[k]) * norm * correction[k];
        completed++;
        if (completed % tick === 0 || completed === directions) progress(completed / directions);
      }
    }
    intensity[0] = 1;
    return {qD, intensity, count, qMaxD, quality, directions, polarOrder, azimuthCount, gridSize};
  }
  function pointStats(points) {
    const mean = [0, 0, 0], count = points.length / 3;
    for (let i = 0; i < points.length; i++) mean[i % 3] += points[i] / count;
    let rg2 = 0; for (let i = 0; i < points.length; i++) rg2 += (points[i] - mean[i % 3]) ** 2 / count;
    return {mean, rg: Math.sqrt(rg2)};
  }
  const api = {MAX_FACES, random, parseSTL, parseOBJ, prepareMesh, checkClosed, buildBVH, pointInside, buildVolumeProposal, sampleMesh, sampleShape, rotationMatrix, rotatePoints, fft2D, ScatteringEngine, directIntensity, pointStats, ISOTROPIC_QUALITIES, gaussLegendre, isotropicScattering};
  root.SAS = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
