(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const examples = JSON.parse($('example-data').textContent);
  const names = {ellipsoid: 'Triaxial ellipsoid', sphere: 'Sphere', cube: 'Cube', cylinder: 'Cylinder'};
  const planeNames = ['XY', 'XZ', 'YZ'], plotColors = ['#197d62', '#7186cf', '#d59a4c'];
  const sourceURL = URL.createObjectURL(new Blob([$('worker-source').textContent], {type: 'text/javascript'}));
  const state = {shape: 'ellipsoid', file: null, points: null, display: null, angles: [20, -25, 15], zoom: 1, result: null, isotropic: null, pending: null, busy: false, requestId: 0, seed: 42, sampling: false, auto: true, sampleVersion: 0};
  let sampleWorker = null, calcWorker = null, isotropicWorker = null, isotropicId = 0, modelData = null, modelDirty = true;
  const fmt = n => new Intl.NumberFormat('en-US').format(n);
  const number = (n, digits = 3) => Math.abs(n) >= 10000 || (Math.abs(n) > 0 && Math.abs(n) < .001) ? n.toExponential(2) : Number(n.toPrecision(digits)).toString();
  const length = () => Number($('size-value').value);
  const unit = () => $('unit').value;
  const inverseUnit = () => `${unit()}⁻¹`;
  const superscript = n => String(n).split('').map(x => ({'-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'}[x])).join('');
  function notice(message = '', error = false) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('error', error); }
  function setComputeStatus(label) {
    const text = ` ${label}`, node = $('compute-status').lastChild;
    if (node.textContent !== text) node.textContent = text;
  }
  function setSampling(active, message = 'Filling particle volume…') {
    state.sampling = active; $('loading').hidden = !active; $('loading-label').textContent = message;
    $('resample').disabled = active;
    setComputeStatus(active ? 'Sampling' : state.result ? 'Live' : 'Updating');
    updateExports();
  }
  // A completed frame is an immutable export snapshot, even while the next
  // orientation is in flight. Only replacing the point set invalidates it.
  function updateExports() {
    const unavailable = state.sampling || !state.result;
    for (const [id, disabled] of [['export', unavailable], ['export-profiles', unavailable || !state.isotropic]]) {
      if ($(id).disabled !== disabled) $(id).disabled = disabled;
    }
  }
  function stopIsotropic() {
    isotropicId++;
    if (isotropicWorker) isotropicWorker.terminate();
    isotropicWorker = null; state.isotropic = null; updateExports();
  }
  function calculateIsotropic() {
    if (!state.points || state.sampling) return;
    stopIsotropic();
    const id = isotropicId, version = state.sampleVersion;
    $('isotropic-status').textContent = 'Calculating isotropic average…';
    $('isotropic-status').dataset.calculationId = String(id);
    $('isotropic-status').dataset.ready = 'false';
    drawProfile();
    isotropicWorker = new Worker(sourceURL);
    isotropicWorker.onmessage = ({data}) => {
      if (id !== isotropicId || version !== state.sampleVersion) return;
      if (data.type === 'isotropic-progress') { $('isotropic-status').textContent = `Isotropic average · ${Math.round(data.fraction * 100)}%`; return; }
      if (data.type === 'error') {
        $('isotropic-status').textContent = `Isotropic average unavailable: ${data.message}`;
        isotropicWorker.terminate(); isotropicWorker = null; return;
      }
      if (data.type !== 'isotropic-result') return;
      state.isotropic = data;
      $('isotropic-status').textContent = `Ready · ${fmt(data.directions)} directions · fixed during rotation`;
      $('isotropic-status').dataset.ready = 'true';
      isotropicWorker.terminate(); isotropicWorker = null;
      drawProfile(); updateExports();
    };
    isotropicWorker.onerror = () => { if (id === isotropicId) { $('isotropic-status').textContent = 'Isotropic worker stopped. Change accuracy or resample to retry.'; isotropicWorker.terminate(); isotropicWorker = null; } };
    // Cover the entire qD slider once. Rotation, zoom, q range, detector size and
    // physical units all reuse this body-frame curve; none requests another job.
    isotropicWorker.postMessage({type: 'isotropic', id, points: state.points, qMaxD: 120, quality: $('isotropic-quality').value});
  }
  function createCalculationWorker() {
    if (calcWorker) calcWorker.terminate();
    calcWorker = new Worker(sourceURL);
    state.busy = false; state.pending = null;
    calcWorker.onmessage = ({data}) => {
      state.busy = false;
      if (data.type === 'error') { notice(data.message, true); state.result = null; setComputeStatus('Error'); }
      if (data.type === 'result') {
        state.result = data;
        $('metric-time').textContent = `${data.ms.toFixed(1)} ms`;
        setComputeStatus('Live');
        $('compute-status').dataset.frameId = String(data.id);
        drawDetectors(); drawProfile();
      }
      if (state.pending) { const next = state.pending; state.pending = null; sendCalculation(next); }
      updateExports();
    };
    calcWorker.onerror = () => { state.busy = false; state.result = null; notice('The calculation worker stopped. Reload this page to restart.', true); setComputeStatus('Error'); updateExports(); };
  }
  function sendCalculation(job) { state.busy = true; calcWorker.postMessage(job); }
  function calculate() {
    if (!state.points || state.sampling) return;
    const job = {type: 'calculate', id: ++state.requestId, angles: [...state.angles], matrix: SAS.rotationMatrix(state.angles), size: Number($('resolution').value), qMaxD: Number($('q-range').value)};
    if (!state.result) setComputeStatus('Updating');
    if (state.busy) state.pending = job; else sendCalculation(job);
  }
  async function loadModel(newModel = false) {
    const version = ++state.sampleVersion;
    state.result = null;
    if (sampleWorker) sampleWorker.terminate();
    stopIsotropic(); $('isotropic-status').textContent = 'Waiting for model…'; $('isotropic-status').dataset.ready = 'false';
    updateAutoButton();
    notice(); setSampling(true);
    if (calcWorker) { calcWorker.terminate(); calcWorker = null; }
    state.busy = false; state.pending = null; state.requestId++;
    try {
      let buffer;
      if (state.file) {
        if (state.file.size > 50 * 1024 * 1024) throw Error('File exceeds the 50 MB MVP limit. Export a smaller or decimated mesh.');
        buffer = await state.file.arrayBuffer();
        if (version !== state.sampleVersion) return;
      }
      sampleWorker = new Worker(sourceURL);
      sampleWorker.onmessage = ({data}) => {
        if (version !== state.sampleVersion) return;
        if (data.type === 'progress') { $('loading-label').textContent = data.text; return; }
        if (data.type === 'error') {
          setSampling(false); notice(data.message, true); setComputeStatus('Import failed');
          state.points = null; state.result = null; modelData = null; modelDirty = true; clearOutputs();
          updateExports(); sampleWorker.terminate(); return;
        }
        if (data.type !== 'sampled') return;
        state.points = data.points; state.display = data.display; state.stats = data.stats;
        state.dimensions = data.dimensions; state.nativeSpan = data.span;
        state.faces = data.faces; state.sampleMs = data.ms;
        state.volume = data.volume;
        if (newModel) { $('size-value').value = data.span; if (state.file) $('unit').value = 'unit'; }
        $('model-name').textContent = state.file ? state.file.name : names[state.shape];
        $('model-type').textContent = state.file ? `${fmt(data.faces)} FACES` : 'EXAMPLE';
        $('stage-point-count').textContent = `${fmt(data.points.length / 3)} points`;
        $('metric-points').textContent = fmt(data.points.length / 3);
        $('metric-floor').textContent = (3 / data.points.length).toExponential(1);
        $('point-label').textContent = fmt(data.points.length / 3);
        if (state.file) $('size-hint').textContent = `Native bounds: ${data.dimensions.map(n => number(n)).join(' × ')}. Set a unit and physical span.`;
        else $('size-hint').textContent = 'Example span: 100 nm. Change the span to set your physical scale.';
        createCalculationWorker(); calcWorker.postMessage({type: 'points', points: data.points});
        prepareRenderingData(); setSampling(false); updateLabels(); calculate(); calculateIsotropic();
        if (data.degenerate) notice(`${fmt(data.degenerate)} zero-area triangles were removed before sampling.`);
        sampleWorker.terminate();
      };
      sampleWorker.onerror = () => { setSampling(false); notice('Model worker could not start. Open this HTML file in a current Chrome, Edge, Firefox, or Safari browser.', true); };
      const job = {type: 'sample', count: Number($('point-count').value), seed: state.seed, shape: state.shape, name: state.file?.name, buffer};
      sampleWorker.postMessage(job, buffer ? [buffer] : []);
    } catch (error) { setSampling(false); notice(error.message, true); state.points = null; state.result = null; modelData = null; modelDirty = true; clearOutputs(); updateExports(); }
  }
  function clearOutputs() {
    for (let p = 0; p < 3; p++) { const c = $(`plane-${p}`); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
    for (const id of ['metric-points', 'metric-time', 'metric-rg', 'metric-floor']) $(id).textContent = '—';
    $('profile-canvas').getContext('2d').clearRect(0, 0, $('profile-canvas').width, $('profile-canvas').height);
  }
  function updateLabels() {
    const span = length(), q = Number($('q-range').value) / span;
    $('q-label').textContent = `±${number(q)} ${inverseUnit()}`;
    document.querySelectorAll('.tick-min').forEach(x => x.textContent = `−${number(q)}`);
    document.querySelectorAll('.tick-max').forEach(x => x.textContent = `+${number(q)}`);
    $('detector-detail').textContent = `${$('resolution').value}² pixels per plane · q in ${inverseUnit()}`;
    $('metric-grid').textContent = `three ${$('resolution').value} × ${$('resolution').value} planes`;
    $('dynamic-label').textContent = `${$('dynamic-range').value} decades`;
    $('color-min').textContent = `10${superscript(-Number($('dynamic-range').value))}`;
    if (state.stats) $('metric-rg').textContent = `${number(state.stats.rg * span)} ${unit()}`;
    $('analytic').disabled = !!state.file || state.shape === 'cube' || state.shape === 'cylinder';
  }

  // Canvas renderer keeps every browser dependency inside the portable HTML.
  const modelCanvas = $('model-canvas'), modelCtx = modelCanvas.getContext('2d');
  function prepareRenderingData() {
    const count = Math.min(state.points.length / 3, 12000), stride = Math.max(1, Math.floor(state.points.length / 3 / count));
    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) points.set(state.points.subarray(i * stride * 3, i * stride * 3 + 3), i * 3);
    modelData = {points}; modelDirty = true;
  }
  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }
  // Camera is fixed in lab space; the particle rotation alone changes scattering.
  const camera = SAS.rotationMatrix([-25, -20, -9]);
  function cameraPoint(x, y, z) { return [camera[0] * x + camera[1] * y + camera[2] * z, camera[3] * x + camera[4] * y + camera[5] * z, camera[6] * x + camera[7] * y + camera[8] * z]; }
  function drawModel() {
    fitCanvas(modelCanvas);
    const ctx = modelCtx, w = modelCanvas.width, h = modelCanvas.height, dpr = Math.min(devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(w, h) * .71 * state.zoom, cx = w * .5, cy = h * .49;
    const project = p => [cx + p[0] * scale, cy - p[1] * scale];
    // Reference grid lies in the fixed laboratory XY plane below the particle.
    ctx.lineWidth = .55 * dpr; ctx.strokeStyle = '#8ab79a13';
    for (let i = -7; i <= 7; i++) {
      for (const a of [0, 1]) {
        const u = a ? [-.8, i / 8, -.53] : [i / 8, -.8, -.53], v = a ? [.8, i / 8, -.53] : [i / 8, .8, -.53];
        const p = project(cameraPoint(...u)), q = project(cameraPoint(...v)); ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
      }
    }
    if (modelData) {
      const rotated = SAS.rotatePoints(modelData.points, SAS.rotationMatrix(state.angles));
      // Batch dots into depth bands to make the volume readable without sorting.
      const bands = Array.from({length: 8}, () => []);
      for (let i = 0; i < rotated.length; i += 3) { const p = cameraPoint(rotated[i], rotated[i + 1], rotated[i + 2]); bands[Math.max(0, Math.min(7, Math.floor((p[2] + .85) * 8 / 1.7)))].push(p); }
      for (let b = 0; b < bands.length; b++) {
        ctx.fillStyle = `rgba(${140 + b * 9},${184 + b * 7},${154 + b * 8},${.18 + b * .055})`;
        const r = dpr * (.7 + b * .055);
        ctx.beginPath(); for (const p of bands[b]) { const [x, y] = project(p); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); } ctx.fill();
      }
    }
    const origin = [w - 43 * dpr, h - 48 * dpr], labels = ['X', 'Y', 'Z'], colors = ['#d58970', '#a9c780', '#82a3d4'];
    for (let a = 0; a < 3; a++) { const p = [0, 0, 0]; p[a] = .36; const c = cameraPoint(...p), end = [origin[0] + c[0] * 55 * dpr, origin[1] - c[1] * 55 * dpr]; ctx.strokeStyle = colors[a]; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(...origin); ctx.lineTo(...end); ctx.stroke(); ctx.fillStyle = colors[a]; ctx.font = `${8 * dpr}px sans-serif`; ctx.fillText(labels[a], end[0] + 3 * dpr, end[1] + 3 * dpr); }
  }

  const palette = (() => {
    const stops = [[17,25,45],[41,53,91],[92,71,126],[163,90,120],[215,134,100],[247,198,119],[255,242,204]], lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) { const t = i / 255 * (stops.length - 1), j = Math.min(stops.length - 2, Math.floor(t)), f = t - j; for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[j][c] * (1 - f) + stops[j + 1][c] * f; }
    return lut;
  })();
  function drawDetectors() {
    if (!state.result) return;
    const {size, planes} = state.result, decades = Number($('dynamic-range').value);
    for (let p = 0; p < 3; p++) {
      const canvas = $(`plane-${p}`); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(size, size);
      // Positive vertical q points upward; the highest positive sample is on top.
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const sy = size - 1 - y, i = sy * size + x, dst = (y * size + x) * 4;
        const color = Math.round(255 * Math.max(0, Math.min(1, 1 + Math.log10(Math.max(planes[p][i], 1e-30)) / decades)));
        image.data[dst] = palette[color * 3]; image.data[dst + 1] = palette[color * 3 + 1]; image.data[dst + 2] = palette[color * 3 + 2]; image.data[dst + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }
  }
  // Radial bins have exact mean |q| coordinates, rather than nominal bin centers.
  function radialProfiles(result) {
    const {size, qMaxD, planes} = result, half = size / 2, dq = 2 * qMaxD / size;
    const profiles = planes.map(() => []), sums = planes.map(() => new Float64Array(half)), radii = new Float64Array(half), counts = new Uint32Array(half);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - half, y - half), bin = Math.round(r);
      if (bin >= half) continue;
      radii[bin] += r * dq; counts[bin]++;
      for (let p = 0; p < 3; p++) sums[p][bin] += planes[p][y * size + x];
    }
    for (let b = 0; b < half; b++) if (counts[b]) for (let p = 0; p < 3; p++) profiles[p].push([radii[b] / counts[b], sums[p][b] / counts[b]]);
    return profiles;
  }
  function analyticPlane(qD, plane, matrix) {
    const axes = state.shape === 'sphere' ? [.5, .5, .5] : [.5, .27, .18], pair = [[0, 1], [0, 2], [1, 2]][plane];
    let sum = 0;
    for (let a = 0; a < 96; a++) {
      const angle = Math.PI * 2 * a / 96, q = [0, 0, 0]; q[pair[0]] = qD * Math.cos(angle); q[pair[1]] = qD * Math.sin(angle);
      const t = Math.hypot(...axes.map((r, j) => r * (matrix[j] * q[0] + matrix[3 + j] * q[1] + matrix[6 + j] * q[2])));
      const amp = t < 1e-5 ? 1 : 3 * (Math.sin(t) - t * Math.cos(t)) / t ** 3;
      sum += amp * amp / 96;
    }
    return sum;
  }
  function drawProfile() {
    const canvas = $('profile-canvas'); fitCanvas(canvas);
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, dpr = Math.min(devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, w, h); if (!state.result) return;
    const {qMaxD} = state.result, pad = {l: 42 * dpr, r: 12 * dpr, t: 14 * dpr, b: 32 * dpr}, pw = w - pad.l - pad.r, ph = h - pad.t - pad.b, decades = Number($('dynamic-range').value);
    if (pw < 1 || ph < 1) return;
    const x = q => pad.l + q / qMaxD * pw, y = v => pad.t - Math.log10(Math.max(v, 1e-30)) / decades * ph;
    ctx.font = `${8 * dpr}px -apple-system, sans-serif`; ctx.lineWidth = .6 * dpr;
    for (let k = 0; k <= decades; k++) { const yy = pad.t + k / decades * ph; ctx.strokeStyle = '#e9ede5'; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke(); ctx.fillStyle = '#99a38f'; ctx.textAlign = 'right'; ctx.fillText(`10${superscript(-k)}`, pad.l - 8 * dpr, yy + 3 * dpr); }
    for (let k = 0; k <= 4; k++) { const xx = pad.l + k / 4 * pw; ctx.strokeStyle = '#f0f2ec'; ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, pad.t + ph); ctx.stroke(); ctx.fillStyle = '#99a38f'; ctx.textAlign = 'center'; ctx.fillText(number(qMaxD / length() * k / 4), xx, pad.t + ph + 14 * dpr); }
    ctx.fillStyle = '#8c9881'; ctx.textAlign = 'right'; ctx.fillText(`q (${inverseUnit()})`, w - pad.r, h - 2 * dpr); ctx.textAlign = 'left'; ctx.fillText('I(q) / I(0)', pad.l, 7 * dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
    const profiles = radialProfiles(state.result);
    for (let p = 2; p >= 0; p--) {
      ctx.strokeStyle = plotColors[p]; ctx.lineWidth = 1.4 * dpr; ctx.setLineDash([]); ctx.beginPath();
      profiles[p].forEach(([q, v], i) => { if (i) ctx.lineTo(x(q), y(v)); else ctx.moveTo(x(q), y(v)); }); ctx.stroke();
      if ($('analytic').checked && !$('analytic').disabled) {
        ctx.globalAlpha = .55; ctx.lineWidth = dpr; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.beginPath();
        const matrix = SAS.rotationMatrix(state.result.angles);
        for (let i = 0; i <= 160; i++) { const q = qMaxD * i / 160, v = analyticPlane(q, p, matrix); if (i) ctx.lineTo(x(q), y(v)); else ctx.moveTo(x(q), y(v)); } ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (state.isotropic) {
      ctx.strokeStyle = '#253c37'; ctx.lineWidth = 2.4 * dpr; ctx.setLineDash([]); ctx.beginPath();
      state.isotropic.qD.forEach((q, i) => { const yy = y(state.isotropic.intensity[i]); if (i) ctx.lineTo(x(q), yy); else ctx.moveTo(x(q), yy); });
      ctx.stroke();
    }
    const floor = 1 / state.result.count;
    ctx.setLineDash([2 * dpr, 4 * dpr]); ctx.strokeStyle = '#b7bdac'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(pad.l, y(floor)); ctx.lineTo(w - pad.r, y(floor)); ctx.stroke(); ctx.setLineDash([]);
    if (y(floor) > pad.t && y(floor) < pad.t + ph) { ctx.fillStyle = '#a0aa93'; ctx.textAlign = 'right'; ctx.fillText('1/N', w - pad.r - 4 * dpr, y(floor) - 5 * dpr); }
    ctx.restore();
  }

  function setAngles(angles) {
    state.angles = angles.map(a => ((a + 180) % 360 + 360) % 360 - 180);
    ['x', 'y', 'z'].forEach((a, i) => $(`angle-${a}`).value = Math.round(state.angles[i]));
    modelDirty = true; calculate();
  }
  let pointer = null;
  modelCanvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; pointer = {x: event.clientX, y: event.clientY}; modelCanvas.setPointerCapture(event.pointerId); state.auto = false; updateAutoButton(); });
  modelCanvas.addEventListener('pointermove', event => { if (!pointer) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer = {x: event.clientX, y: event.clientY}; setAngles([state.angles[0] - dy * .45, state.angles[1] + dx * .45, state.angles[2]]); });
  const endDrag = () => { pointer = null; };
  modelCanvas.addEventListener('pointerup', endDrag); modelCanvas.addEventListener('pointercancel', endDrag);
  modelCanvas.addEventListener('wheel', event => { event.preventDefault(); state.zoom = Math.max(.45, Math.min(2.5, state.zoom * Math.exp(-event.deltaY * .001))); modelDirty = true; }, {passive: false});
  modelCanvas.addEventListener('keydown', event => { const directions = {ArrowLeft: [0, -5], ArrowRight: [0, 5], ArrowUp: [-5, 0], ArrowDown: [5, 0]}; if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; setAngles([state.angles[0] + x, state.angles[1] + y, state.angles[2]]); } });
  ['x', 'y', 'z'].forEach((a, i) => {
    const input = $(`angle-${a}`);
    input.addEventListener('input', event => {
      if (event.target.value === '' || !event.target.checkValidity()) return;
      const angle = Number(event.target.value); if (!Number.isFinite(angle)) return;
      state.angles[i] = angle; modelDirty = true; calculate();
    });
    input.addEventListener('change', event => { const angle = Number(event.target.value); if (!Number.isFinite(angle)) return; const next = [...state.angles]; next[i] = angle; setAngles(next); });
  });
  $('reset-view').addEventListener('click', () => { state.zoom = 1; setAngles([0, 0, 0]); });
  function updateAutoButton() {
    $('rotation-label').textContent = state.auto ? 'Pause rotation' : 'Start rotation';
    $('rotation-icon').setAttribute('d', state.auto ? 'M6 4v12M14 4v12' : 'm6 3 10 7-10 7Z');
    $('auto-rotate').setAttribute('aria-pressed', String(state.auto));
  }
  $('auto-rotate').addEventListener('click', () => { state.auto = !state.auto; updateAutoButton(); });
  let previousFrame = 0, previousAuto = 0;
  function frame(now) {
    const dt = Math.min(60, now - previousFrame); previousFrame = now;
    if (state.auto && !state.sampling && !document.hidden && now - previousAuto > 40) { previousAuto = now; setAngles([state.angles[0], state.angles[1] + dt * .065, state.angles[2]]); }
    if (modelDirty) { modelDirty = false; drawModel(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const observer = new ResizeObserver(() => { modelDirty = true; drawProfile(); }); observer.observe($('model-stage')); observer.observe($('profile-canvas').parentElement);

  $('drop-zone').addEventListener('click', () => $('file-input').click());
  function acceptFile(file, exampleKey = 'custom') {
    if (!file) return;
    if (!/\.(stl|obj)$/i.test(file.name)) { notice('Choose an STL or OBJ model. More formats can be added in a future version.', true); return; }
    state.file = file; state.shape = null; $('example').value = exampleKey; $('download-example').disabled = false; loadModel(true);
  }
  function acceptFiles(files) { acceptFile(Array.from(files).find(file => /\.(stl|obj)$/i.test(file.name)) || files[0]); }
  $('file-input').addEventListener('change', event => { acceptFiles(event.target.files); event.target.value = ''; });
  const removeFileDrop = ModelFileDrop.install({
    zone: $('drop-zone'), surface: window, onFiles: acceptFiles,
    onDragState: active => {
      $('drop-title').textContent = active ? 'Release to load your model' : 'Drag & drop your model';
      $('drop-subtitle').textContent = active ? 'Drop an STL or OBJ file here' : 'STL or OBJ · or click to browse';
    }
  });
  function exampleFile(key) {
    const sample = examples[key], bytes = Uint8Array.from(atob(sample.base64), c => c.charCodeAt(0));
    return new File([bytes], sample.filename, {type: sample.filename.toLowerCase().endsWith('.stl') ? 'model/stl' : 'text/plain'});
  }
  $('example').addEventListener('change', event => {
    const key = event.target.value;
    if (examples[key]) {
      const entry = examples[key];
      if (entry.recommendedPoints) $('point-count').value = String(entry.recommendedPoints);
      if (entry.orientation) setAngles(entry.orientation);
      acceptFile(exampleFile(key), key); return;
    }
    state.shape = key; state.file = null; $('download-example').disabled = true; $('unit').value = 'nm'; loadModel(true);
  });
  $('download-example').addEventListener('click', () => { if (state.file) download(state.file, state.file.name, state.file.type); });
  $('point-count').addEventListener('change', () => { $('point-label').textContent = fmt(Number($('point-count').value)); loadModel(); });
  $('resample').addEventListener('click', () => { state.seed++; loadModel(); });
  $('resolution').addEventListener('change', () => { updateLabels(); calculate(); });
  $('q-range').addEventListener('input', () => { updateLabels(); calculate(); });
  $('dynamic-range').addEventListener('input', () => { updateLabels(); drawDetectors(); drawProfile(); });
  $('size-value').addEventListener('change', () => {
    const input = $('size-value');
    if (!(Number(input.value) > 0) || !input.checkValidity()) { input.value = state.nativeSpan || 100; notice('Enter a positive, finite physical span.'); }
    else notice();
    updateLabels(); drawProfile();
  });
  $('unit').addEventListener('change', () => { updateLabels(); drawProfile(); });
  $('analytic').addEventListener('change', drawProfile);
  $('isotropic-quality').addEventListener('change', calculateIsotropic);
  ['method-button', 'method-footer'].forEach(id => $(id).addEventListener('click', () => $('method-dialog').showModal()));
  $('close-method').addEventListener('click', () => $('method-dialog').close());
  $('method-dialog').addEventListener('click', event => { if (event.target === $('method-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
  for (let p = 0; p < 3; p++) {
    const canvas = $(`plane-${p}`);
    canvas.addEventListener('pointermove', event => {
      if (!state.result) return;
      const {size, qMaxD, planes} = state.result, rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(size - 1, Math.floor((event.clientX - rect.left) / rect.width * size))), screenY = Math.max(0, Math.min(size - 1, Math.floor((event.clientY - rect.top) / rect.height * size))), y = size - 1 - screenY;
      const qa = (x - size / 2) * 2 * qMaxD / size / length(), qb = (y - size / 2) * 2 * qMaxD / size / length();
      $('hover-readout').textContent = `${planeNames[p]}  q = (${number(qa)}, ${number(qb)}) ${inverseUnit()}   I/I₀ = ${planes[p][y * size + x].toExponential(4)}`;
    });
    canvas.addEventListener('pointerleave', () => $('hover-readout').textContent = 'Hover over a detector to inspect q and intensity.');
  }

  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], {type})), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('export-profiles').addEventListener('click', () => {
    if (!state.result || !state.isotropic || state.sampling) return;
    const iso = state.isotropic;
    const rows = [
      '# STL2SAS normalized profiles; isotropic averages INTENSITY over 3D directions',
      `# model=${JSON.stringify(state.file ? state.file.name : names[state.shape])}; N=${iso.count}; seed=${state.seed}`,
      `# longest_span=${length()}; length_unit=${unit()}; plane_rotation_xyz_degrees=${state.result.angles.join(' ')}`,
      `# displayed_qD_max=${state.result.qMaxD}; cached_isotropic_qD_max=${iso.qMaxD}`,
      `# isotropic_method=${iso.method}_1D_FFT; quality=${iso.quality}; directions=${iso.directions}; projection_fft=${iso.gridSize}`,
      ...(iso.polarOrder ? [`# polar_order=${iso.polarOrder}; azimuth_count=${iso.azimuthCount}`] : []),
      '# isotropic is cached in the original model frame; plane averages follow rotation',
      '# numerical angular integration and gridding are approximate; finite-point self terms retained',
      'profile,q,I_over_I0'
    ];
    for (let i = 0; i < iso.qD.length && iso.qD[i] <= state.result.qMaxD + 1e-10; i++) rows.push(`isotropic,${(iso.qD[i] / length()).toPrecision(10)},${iso.intensity[i].toExponential(10)}`);
    radialProfiles(state.result).forEach((profile, p) => profile.forEach(([q, value]) => rows.push(`${planeNames[p]}_azimuthal,${(q / length()).toPrecision(10)},${value.toExponential(10)}`)));
    download(rows.join('\n') + '\n', 'stl2sas-profiles.csv', 'text/csv;charset=utf-8');
  });
  $('export').addEventListener('click', () => {
    if (!state.result || state.sampling) return;
    const {size, qMaxD, planes, count, angles} = state.result;
    const metadata = [
      '# STL2SAS 0.1; normalized single-particle intensity; uniform contrast; FFT approximation',
      `# model=${JSON.stringify(state.file ? state.file.name : names[state.shape])}`,
      `# N=${count}; seed=${state.seed}; longest_span=${length()}; length_unit=${unit()}; rotation_xyz_degrees=${angles.join(' ')}`,
      '# R=Rz*Ry*Rx; q uses radians/length; plane coordinates are fixed in laboratory space',
      '# raw intensities include the finite-point self term; expected noise floor ~1/N',
      '# these directional planes are not an isotropic average; use Export profiles for the isotropic curve',
      '# XY=(qx,qy), XZ=(qx,qz), YZ=(qy,qz)',
      'plane,q_a,q_b,I_over_I0'
    ];
    const rows = [...metadata];
    for (let p = 0; p < 3; p++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rows.push(`${planeNames[p]},${((x - size / 2) * 2 * qMaxD / size / length()).toPrecision(9)},${((y - size / 2) * 2 * qMaxD / size / length()).toPrecision(9)},${planes[p][y * size + x].toExponential(8)}`);
    download(rows.join('\n') + '\n', 'stl2sas-planes.csv', 'text/csv;charset=utf-8');
  });
  window.addEventListener('beforeunload', () => { removeFileDrop(); if (sampleWorker) sampleWorker.terminate(); if (calcWorker) calcWorker.terminate(); if (isotropicWorker) isotropicWorker.terminate(); URL.revokeObjectURL(sourceURL); });
  updateLabels(); loadModel();
})();
