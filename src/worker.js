'use strict';
let points = null;
const engine = new SAS.ScatteringEngine();
self.onmessage = ({data}) => {
  try {
    if (data.type === 'sample') {
      const start = performance.now();
      let result;
      if (data.buffer) {
        self.postMessage({type: 'progress', text: 'Checking mesh and building spatial index…'});
        const mesh = SAS.prepareMesh(data.buffer, data.name);
        const sampled = SAS.sampleMesh(mesh, data.count, data.seed, fraction => self.postMessage({type: 'progress', text: `Filling volume · ${Math.round(fraction * 100)}%`}));
        // Limit the rendering copy, not the number of faces used for volume sampling.
        const stride = Math.max(1, Math.ceil(mesh.faces / 6000)), display = [];
        for (let i = 0; i < mesh.faces; i += stride) display.push(...mesh.triangles.subarray(i * 9, i * 9 + 9));
        result = {...sampled, span: mesh.span, dimensions: mesh.dimensions, faces: mesh.faces, degenerate: mesh.degenerate, display: new Float32Array(display)};
      } else result = {...SAS.sampleShape(data.shape, data.count, data.seed), display: new Float32Array(0)};
      result.stats = SAS.pointStats(result.points);
      self.postMessage({type: 'sampled', ...result, ms: performance.now() - start}, [result.points.buffer, result.display.buffer]);
    } else if (data.type === 'points') {
      points = data.points;
    } else if (data.type === 'isotropic') {
      const start = performance.now();
      const result = SAS.isotropicScattering(data.points, data.qMaxD, data.quality, fraction => self.postMessage({type: 'isotropic-progress', id: data.id, fraction}));
      self.postMessage({type: 'isotropic-result', id: data.id, ...result, ms: performance.now() - start}, [result.qD.buffer, result.intensity.buffer]);
    } else if (data.type === 'reconstruct') {
      const result = SASInverse.reconstruct(data.profile, data.settings, update => self.postMessage({type: 'inverse-progress', id: data.id, ...update}));
      self.postMessage({type: 'inverse-result', id: data.id, ...result}, result.candidates.map(candidate => candidate.mesh));
    } else if (data.type === 'calculate') {
      const start = performance.now();
      if (!points) throw Error('Load a model first.');
      const result = engine.compute(points, data.matrix, data.size, data.qMaxD);
      self.postMessage({type: 'result', id: data.id, angles: data.angles, ...result, ms: performance.now() - start}, result.planes.map(x => x.buffer));
    }
  } catch (error) { self.postMessage({type: 'error', id: data.id, message: error.message}); }
};
