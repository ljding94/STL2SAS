(function () {
  'use strict';
  const $ = id => document.getElementById(id), root = $('inverse');
  const state = {profile: null, name: '', provenance: '', result: null, selected: 0, worker: null, job: 0, load: 0, live: null, mesh: null, angles: [-24, 30, 12]};
  const sourceURL = URL.createObjectURL(new Blob([$('worker-source').textContent], {type: 'text/javascript'}));
  const n = (value, digits = 3) => Number(value).toPrecision(digits).replace(/\.0+(?=e|$)/, '');
  const selected = () => state.result?.candidates[state.selected];
  const unit = () => $('inverse-unit').value;
  function status(text, kind = 'ready') { $('inverse-status').textContent = text; $('inverse-status').dataset.state = kind; }
  function busy(value) {
    $('inverse-settings').disabled = value;
    $('inverse-generator-settings').disabled = value;
    $('inverse-run').disabled = value || !state.profile;
    $('inverse-stop').hidden = !value;
    root.setAttribute('aria-busy', String(value));
  }
  function stop(silent = false) {
    if (!state.worker) return;
    state.worker.terminate(); state.worker = null; state.job++; busy(false);
    if (!silent) status('Stopped. No completed candidates were kept; change settings or start again.', 'stopped');
  }
  function clearResult() {
    state.result = null; state.live = null; state.mesh = null;
    $('inverse-candidate').replaceChildren(new Option('Run a reconstruction first'));
    $('inverse-candidate').disabled = true;
    for (const id of ['inverse-stl','inverse-fit','inverse-report','inverse-explore']) $(id).disabled = true;
    $('inverse-fit-stats').textContent = 'The fit and weighted residuals will appear here.';
    $('inverse-shape-caption').textContent = 'A candidate envelope will appear here.';
    $('inverse-progress').value = 0;
    drawPlot(); drawShape();
  }
  function resolutionHint() {
    const diameter = Number($('inverse-diameter').value), qmax = Number($('inverse-qmax').value), size = Number($('inverse-size').value);
    try {
      const plan=SASInverse.accuracyPlan(qmax*diameter,size,state.profile?.q.length||256);
      $('inverse-resolution').textContent = `Voxel edge ≈ ${n(diameter/size)} ${unit()}; q max × diameter = ${n(qmax*diameter)}. Adaptive search: ${plan.directions.toLocaleString()} directions; final check: ${plan.verificationDirections.toLocaleString()}.${plan.voxelPhase>Math.PI ? ' This q range exceeds the grid’s spatial resolution; use a finer grid or smaller search extent.' : ''}`;
    } catch(error) { $('inverse-resolution').textContent=error.message; }
  }
  function setProfile(profile, name, lengthUnit = 'Å', provenance = 'Uploaded isotropic intensity') {
    stop(true); state.profile = profile; state.name = name; state.provenance = provenance;
    $('inverse-data-export').disabled = false;
    $('inverse-unit').value = lengthUnit;
    const diameter = profile.suggestedDiameter || 8 / profile.q.at(-1);
    $('inverse-diameter').value = n(diameter, 5);
    $('inverse-qmax').value = n(Math.min(profile.q.at(-1), 120 / diameter), 8);
    $('inverse-q-axis').value = profile.generator?.spacing === 'log' ? 'log' : 'linear';
    $('inverse-data-summary').textContent = `${name} · ${profile.q.length} points · q ${n(profile.q[0])}–${n(profile.q.at(-1))}. ${profile.hasSigma ? 'Supplied uncertainties.' : 'Assumed weights: 5% of I, with a low-q floor.'}${profile.rg ? ` Estimated Rg ≈ ${n(profile.rg)} ${lengthUnit}.` : 'No usable Guinier size estimate; set the search diameter.'} ${provenance}${profile.intensity.some(v => v <= 0) ? ' Nonpositive intensities are fitted but omitted from the log-intensity plot.' : ''}`;
    clearResult(); resolutionHint(); busy(false);
    const clipped = Number($('inverse-qmax').value) < profile.q.at(-1) * (1 - 1e-7);
    status(clipped ? `Data loaded. This browser implementation supports q max × diameter up to 120, so the fit ends at q = ${n(Number($('inverse-qmax').value))} ${lengthUnit}⁻¹. The plot and input CSV retain the full range.` : 'Data loaded. Check the q unit and search diameter, then reconstruct.');
  }
  async function loadFile(file) {
    if (!file) return;
    const id = ++state.load; stop(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Use a data file smaller than 2 MB.');
      if (!/\.(txt|dat|csv)$/i.test(file.name)) throw Error('Choose a TXT, DAT or CSV intensity file.');
      const text = await file.text(); if (id !== state.load) return;
      setProfile(SASInverse.parseProfile(text), file.name);
    } catch (error) { if (id === state.load) { busy(false); status(error.message, 'error'); } }
  }
  $('inverse-drop').addEventListener('click', () => $('inverse-file').click());
  $('inverse-file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
  for (const type of ['dragenter','dragover']) root.addEventListener(type, event => {
    if (!ModelFileDrop.isFileDrag(event.dataTransfer)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('inverse-drop').classList.add('dragging');
  });
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) $('inverse-drop').classList.remove('dragging'); });
  root.addEventListener('drop', event => {
    if (!ModelFileDrop.isFileDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); $('inverse-drop').classList.remove('dragging');
    loadFile(ModelFileDrop.filesFrom(event.dataTransfer)[0]);
  });
  function generateSphere() {
    try {
      for (const input of $('inverse-generator-settings').querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return; }
      const settings={qmin:Number($('inverse-gen-qmin').value),qmax:Number($('inverse-gen-qmax').value),count:Number($('inverse-gen-count').value),spacing:$('inverse-gen-spacing').value};
      const profile=SASInverse.sphereExample(settings);
      state.load++; setProfile(profile, 'Synthetic sphere · radius 30 Å', 'Å', `Analytic sphere with seeded noise; ${settings.spacing} q spacing; not experimental data.`);
    } catch (error) { status(error.message, 'error'); }
  }
  $('inverse-demo').addEventListener('click', generateSphere);
  $('inverse-generator-settings').addEventListener('change', () => {
    if(state.profile?.generator?.type==='sphere')generateSphere();
  });
  $('inverse-current').addEventListener('click', () => { state.load++; document.dispatchEvent(new CustomEvent('stl2sas:profile-request')); });
  document.addEventListener('stl2sas:profile', ({detail}) => {
    if (detail.error) { status(detail.error, 'error'); return; }
    try { setProfile(SASInverse.prepareProfile(detail.rows), detail.name, detail.unit, `Forward approximation: ${detail.method}. Use denser isotropic accuracy for a meaningful round trip.`); }
    catch (error) { status(error.message, 'error'); }
  });
  $('inverse-settings').addEventListener('change', () => {
    clearResult(); resolutionHint();
    if (state.profile) status('Settings changed. Reconstruct to generate new candidates.');
  });
  $('inverse-q-axis').addEventListener('change', () => {
    if($('inverse-q-axis').value==='log'&&state.profile?.q[0]===0){$('inverse-q-axis').value='linear';status('A logarithmic q axis needs a positive minimum q. The q = 0 point is retained on a linear axis.');}
    drawPlot();
  });
  $('inverse-run').addEventListener('click', () => {
    if (!state.profile || state.worker) return;
    try {
      for (const input of $('inverse-settings').querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return; }
      const settings = {
        diameter: Number($('inverse-diameter').value), size: Number($('inverse-size').value), qmax: Number($('inverse-qmax').value),
        iterations: Number($('inverse-iterations').value), attempts: Number($('inverse-attempts').value),
        seed: Number($('inverse-seed').value), regularization: Number($('inverse-regularization').value), background: $('inverse-background').checked
      };
      SASInverse.accuracyPlan(settings.qmax*settings.diameter,settings.size,state.profile.q.length);
      clearResult(); busy(true); status('Preparing the search…', 'running');
      document.dispatchEvent(new CustomEvent('stl2sas:inverse-start'));
      const id = ++state.job, worker = state.worker = new Worker(sourceURL), started = performance.now(), lengthUnit = unit();
      worker.onmessage = ({data}) => {
        if (id !== state.job) return;
        if (data.type === 'error') { stop(true); status(data.message, 'error'); return; }
        if (data.type === 'inverse-progress') {
          $('inverse-progress').value = data.fraction;
          status(`${data.stage}${data.step ? ` · ${data.step.toLocaleString()}/${data.iterations.toLocaleString()} steps · best weighted RMS ${n(data.wrms)}` : '…'}`, 'running');
          if (data.curve) { state.live = {q: data.q, curve: data.curve}; drawPlot(); }
          return;
        }
        if (data.type !== 'inverse-result') return;
        state.result = {...data, lengthUnit, source: state.name, provenance: state.provenance}; state.selected = 0; state.live = null;
        worker.terminate(); state.worker = null; busy(false);
        $('inverse-progress').value = 1;
        $('inverse-candidate').replaceChildren(...data.candidates.map((c, i) => new Option(`Candidate ${i+1} · weighted RMS ${n(c.wrms)} · seed ${c.seed}`, String(i))));
        $('inverse-candidate').disabled = false;
        for (const key of ['inverse-stl','inverse-fit','inverse-report','inverse-explore']) $(key).disabled = false;
        selectCandidate();
        const poor=data.candidates[0].wrms>2;
        status(`${data.candidates.length} candidate${data.candidates.length > 1 ? 's' : ''} completed in ${((performance.now()-started)/1000).toFixed(1)} s.${poor?' Residuals remain large; check the search extent, resolution, assumptions and longer runs.':' Compare shapes and residuals; a fit does not identify a unique structure.'}`, 'complete');
      };
      worker.onerror = () => { if (id === state.job) { stop(true); status('The reconstruction worker stopped. Try a smaller grid or fewer steps.', 'error'); } };
      worker.postMessage({type: 'reconstruct', id, profile: state.profile, settings});
    } catch (error) { stop(true); busy(false); status(error.message, 'error'); }
  });
  $('inverse-stop').addEventListener('click', () => stop());
  $('inverse-candidate').addEventListener('change', () => { state.selected = Number($('inverse-candidate').value); selectCandidate(); });
  function selectCandidate() {
    const c = selected(), result = state.result; if (!c) return;
    state.mesh = SAS.prepareMesh(c.mesh, 'reconstructed.stl');
    $('inverse-fit-stats').textContent = `Weighted RMS ${n(c.wrms)} · ${result.data.q.length} fitted points · q ${n(result.data.q[0])}–${n(result.data.q.at(-1))} ${result.lengthUnit}⁻¹ · scale ${n(c.scale)} · background ${n(c.background)} · final check: ${result.verificationDirections.toLocaleString()} directions. ${result.data.hasSigma ? 'Uses supplied σ.' : 'Uses assumed weights, not measured σ.'}${Math.abs(c.wrms-c.optimizationWRMS)>.5?' Search and final-check residuals differ; treat this candidate cautiously.':''}`;
    $('inverse-shape-caption').textContent = `${c.voxelCount} connected voxels · volume ${n(c.volume)} ${result.lengthUnit}³ · exact, unsmoothed envelope`;
    state.angles = [-24,30,12]; drawPlot(); drawShape();
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width*dpr)); canvas.height = Math.max(1, Math.round(rect.height*dpr));
    const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); return {ctx,w:rect.width,h:rect.height};
  }
  function drawPlot() {
    const {ctx,w,h} = fitCanvas($('inverse-plot')), profile = state.profile;
    ctx.clearRect(0,0,w,h); ctx.font = '11px system-ui'; ctx.fillStyle = '#7b8581';
    if (!profile) { ctx.textAlign='center'; ctx.fillText('Load a curve to begin',w/2,h/2); return; }
    const c = selected(), fitted = state.result?.data, line = c ? {q:fitted.q,curve:c.curve} : state.live;
    const xmin = profile.q[0], xmax = profile.q.at(-1), left=55,right=w-15,top=16,bottom=h*.66,resTop=h*.79,resBottom=h-27;
    const logAxis=$('inverse-q-axis').value==='log'&&xmin>0,transform=q=>logAxis?Math.log(q):q;
    $('inverse-plot').dataset.qAxis=logAxis?'log':'linear';
    const positives = Array.from(profile.intensity).filter(v=>v>0).concat(line ? Array.from(line.curve).filter(v=>v>0) : []);
    const ymax = Math.ceil(Math.log10(Math.max(...positives))), ymin = Math.max(ymax-8,Math.floor(Math.log10(Math.min(...positives))));
    const x = q => left+(transform(q)-transform(xmin))/(transform(xmax)-transform(xmin))*(right-left), y = v => bottom-(Math.log10(v)-ymin)/Math.max(1,ymax-ymin)*(bottom-top);
    ctx.textAlign='right'; ctx.strokeStyle='#e8ede7'; ctx.lineWidth=1;
    for(let tick=ymin;tick<=ymax;tick++) { const yy=y(10**tick);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText(`1e${tick}`,left-9,yy+4); }
    ctx.fillStyle='#64766a';ctx.textAlign='left';ctx.fillText('I(q)',left,10);
    for(let i=0;i<=4;i++) {const q=logAxis?Math.exp(Math.log(xmin)+(Math.log(xmax)-Math.log(xmin))*i/4):xmin+(xmax-xmin)*i/4;ctx.textAlign='center';ctx.fillText(n(q,2),x(q),h-11);}
    ctx.textAlign='right';ctx.fillText(`q (${state.result?.lengthUnit || unit()}⁻¹)${logAxis?' · log scale':''}`,right,h-1);
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    for(let i=0;i<profile.q.length;i++) {
      const value=profile.intensity[i];if(value<=0)continue;
      ctx.strokeStyle='#7b8c9480';ctx.beginPath();ctx.moveTo(x(profile.q[i]),y(value+profile.sigma[i]));ctx.lineTo(x(profile.q[i]),y(Math.max(value-profile.sigma[i],10**ymin)));ctx.stroke();
      ctx.fillStyle='#6c7b89';ctx.beginPath();ctx.arc(x(profile.q[i]),y(value),2,0,2*Math.PI);ctx.fill();
    }
    if(line) {ctx.strokeStyle='#167858';ctx.lineWidth=2;ctx.beginPath();let first=true;for(let i=0;i<line.q.length;i++)if(line.curve[i]>0){if(first)ctx.moveTo(x(line.q[i]),y(line.curve[i]));else ctx.lineTo(x(line.q[i]),y(line.curve[i]));first=false;}ctx.stroke();}
    ctx.restore();
    const residual = c ? Array.from(c.curve,(v,i)=>(v-fitted.intensity[i])/fitted.sigma[i]) : [];
    const range = Math.max(3, ...residual.map(Math.abs)), ry = v => (resTop+resBottom)/2-v/range*(resBottom-resTop)/2;
    ctx.fillStyle='#7b8581';ctx.textAlign='left';ctx.fillText('(fit − data) / σ',left,resTop-10);
    ctx.strokeStyle='#cfd8ce';ctx.beginPath();ctx.moveTo(left,ry(0));ctx.lineTo(right,ry(0));ctx.stroke();
    ctx.fillStyle='#167858'; residual.forEach((v,i)=>{ctx.beginPath();ctx.arc(x(fitted.q[i]),ry(v),2,0,2*Math.PI);ctx.fill();});
    ctx.fillStyle='#7b8581';ctx.textAlign='right';ctx.fillText(`+${n(range,2)}`,left-8,resTop+4);ctx.fillText(`−${n(range,2)}`,left-8,resBottom+4);
  }
  function drawShape() {
    const {ctx,w,h} = fitCanvas($('inverse-shape')); ctx.clearRect(0,0,w,h);
    if (!state.mesh) return;
    const points=SAS.rotatePoints(state.mesh.triangles,SAS.rotationMatrix(state.angles)),faces=[],scale=Math.min(w*.7,h*.78);
    for(let i=0;i<points.length;i+=9)faces.push({offset:i,z:(points[i+2]+points[i+5]+points[i+8])/3});
    faces.sort((a,b)=>a.z-b.z);
    for(const {offset:i} of faces) {
      const u=[points[i+3]-points[i],points[i+4]-points[i+1],points[i+5]-points[i+2]],v=[points[i+6]-points[i],points[i+7]-points[i+1],points[i+8]-points[i+2]];
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],shade=.55+.35*(normal[0]*.25+normal[1]*.5+normal[2]*.8)/Math.hypot(...normal);
      ctx.fillStyle=`rgb(${Math.round(85+60*shade)} ${Math.round(139+73*shade)} ${Math.round(112+66*shade)})`;
      ctx.beginPath();ctx.moveTo(w/2+points[i]*scale,h*.47-points[i+1]*scale);ctx.lineTo(w/2+points[i+3]*scale,h*.47-points[i+4]*scale);ctx.lineTo(w/2+points[i+6]*scale,h*.47-points[i+7]*scale);ctx.closePath();ctx.fill();
      ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.5;ctx.stroke();
    }
  }
  let drag = null;
  $('inverse-shape').addEventListener('pointerdown', event => { drag=[event.clientX,event.clientY];event.currentTarget.setPointerCapture(event.pointerId); });
  $('inverse-shape').addEventListener('pointermove', event => { if (!drag) return; state.angles[1]+=(event.clientX-drag[0])*.5;state.angles[0]+=(event.clientY-drag[1])*.5;drag=[event.clientX,event.clientY];drawShape(); });
  for(const event of ['pointerup','pointercancel','lostpointercapture']) $('inverse-shape').addEventListener(event,()=>drag=null);
  $('inverse-shape').addEventListener('keydown', event => {if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();state.angles[event.key.includes('Left')||event.key.includes('Right')?1:0]+=event.key==='ArrowLeft'||event.key==='ArrowUp'?-5:5;drawShape();});
  new ResizeObserver(()=>{drawPlot();drawShape();}).observe(root.querySelector('.inverse-results'));
  function download(data, name, type) {
    const url=URL.createObjectURL(new Blob([data],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  $('inverse-data-export').addEventListener('click',()=>{
    const p=state.profile;if(!p)return;
    const rows=['# STL2SAS input data',`# source=${JSON.stringify(state.name)}; length_unit=${unit()}; supplied_sigma=${p.hasSigma}`,`# generator=${JSON.stringify(p.generator||null)}`,p.hasSigma?'q,intensity,sigma':'q,intensity'];
    for(let i=0;i<p.q.length;i++)rows.push((p.hasSigma?[p.q[i],p.intensity[i],p.sigma[i]]:[p.q[i],p.intensity[i]]).join(','));
    download(rows.join('\n')+'\n','stl2sas-input-data.csv','text/csv;charset=utf-8');
  });
  $('inverse-stl').addEventListener('click',()=>{if(selected())download(selected().mesh,`stl2sas-inverse-candidate-${state.selected+1}.stl`,'model/stl');});
  $('inverse-explore').addEventListener('click',()=>{if(selected())document.dispatchEvent(new CustomEvent('stl2sas:load-reconstruction',{detail:{mesh:selected().mesh,name:`inverse-candidate-${state.selected+1}.stl`,unit:state.result.lengthUnit}}));});
  $('inverse-fit').addEventListener('click',()=>{
    const c=selected(),r=state.result;if(!c)return;
    const rows=['# STL2SAS experimental inverse reconstruction',`# source=${JSON.stringify(r.source)}; unit=${r.lengthUnit}; candidate=${state.selected+1}; seed=${c.seed}`,`# settings=${JSON.stringify(r.settings)}`,`# scale=${c.scale}; background=${c.background}; weighted_RMS=${c.wrms}; supplied_sigma=${r.data.hasSigma}`,`# assumed_sigma_if_needed=max(0.05*abs(I),0.002*low_q_reference); final_directions=${r.verificationDirections}`,'q,intensity,sigma,fit,weighted_residual'];
    for(let i=0;i<r.data.q.length;i++)rows.push([r.data.q[i],r.data.intensity[i],r.data.sigma[i],c.curve[i],(c.curve[i]-r.data.intensity[i])/r.data.sigma[i]].join(','));
    download(rows.join('\n')+'\n',`stl2sas-inverse-fit-${state.selected+1}.csv`,'text/csv;charset=utf-8');
  });
  $('inverse-report').addEventListener('click',()=>{
    const r=state.result;if(!r)return;
    const report={format:'STL2SAS inverse 0.2',source:r.source,provenance:r.provenance,lengthUnit:r.lengthUnit,generator:r.data.generator||null,
      algorithm:'ellipsoid initialization + voxel simulated annealing',settings:r.settings,selectedCandidate:state.selected+1,elapsedMs:r.ms,
      optimizedPoints:r.optimizedPoints,optimizationDirections:r.optimizationDirections,verificationDirections:r.verificationDirections,accuracy:r.accuracy,amplitudeCache:r.amplitudeCache,
      weights:r.data.hasSigma?'supplied sigma':'assumed max(0.05*abs(I),0.002*low-q reference)',data:{q:Array.from(r.data.q),intensity:Array.from(r.data.intensity),sigma:Array.from(r.data.sigma)},
      candidates:r.candidates.map((c,i)=>({rank:i+1,seed:c.seed,voxelCount:c.voxelCount,volume:c.volume,compactness:c.compactness,scale:c.scale,background:c.background,
        weightedRMS:c.wrms,optimizationRMS:c.optimizationWRMS,initialization:c.initialization,executedSteps:c.executedSteps,
        fit:Array.from(c.curve),occupiedSites:Array.from(c.occupied),centersInLengthUnits:Array.from(c.points,x=>x*r.settings.diameter)})),
      limitations:['Nonunique, prior-dependent envelope; not a validated structural determination.','Weighted RMS is not reduced chi-squared.','No polydispersity, structure factor, varying SLD, or instrument smearing.','Final check uses approximate angular quadrature and projection FFT.','The exported STL has no embedded length unit and is not smoothed.']};
    download(JSON.stringify(report,null,2)+'\n','stl2sas-inverse-report.json','application/json');
  });
  window.addEventListener('beforeunload',()=>{stop(true);URL.revokeObjectURL(sourceURL);});
  resolutionHint(); drawPlot(); drawShape();
})();
