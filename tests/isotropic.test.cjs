const {test} = require('node:test');
const assert = require('node:assert/strict');
const SAS = require('../src/core.js');
function near(a,b,tol,context='') { assert.ok(Math.abs(a-b)<tol,`${context}: ${a} vs ${b}, tolerance ${tol}`); }
function debye(points, q) {
  const n=points.length/3; let sum=n;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
    const z=q*Math.hypot(points[3*i]-points[3*j],points[3*i+1]-points[3*j+1],points[3*i+2]-points[3*j+2]);
    sum+=2*(Math.abs(z)<1e-12?1:Math.sin(z)/z);
  }
  return sum/(n*n);
}
test('The default 40 directions cover equal-area bands on the full sphere',()=>{
  const rule=SAS.isotropicDirectionRule();
  assert.equal(rule.directions,40); assert.equal(rule.method,'Fibonacci_sphere');
  near(rule.weights.reduce((sum,w)=>sum+w,0),1,1e-12);
  for(let i=0;i<40;i++) {
    near(Math.hypot(...rule.vectors.subarray(i*3,i*3+3)),1,1e-12);
    near(rule.weights[i],1/40,1e-12);
    near(rule.vectors[i*3+2],1-2*(i+.5)/40,1e-12);
  }
  // Nearly isotropic first and second moments, including off-diagonal terms.
  for(let a=0;a<3;a++) {
    let mean=0;for(let i=0;i<40;i++)mean+=rule.weights[i]*rule.vectors[i*3+a];
    near(mean,0,.002);
    for(let b=a;b<3;b++) {
      let moment=0;for(let i=0;i<40;i++)moment+=rule.weights[i]*rule.vectors[i*3+a]*rule.vectors[i*3+b];
      near(moment,a===b?1/3:0,.004);
    }
  }
});
test('The 40-direction default averages direct intensities using the full point cloud',()=>{
  const points=SAS.sampleShape('cube',48,123).points,progress=[];
  const result=SAS.isotropicScattering(points,120,undefined,value=>progress.push(value));
  const rule=SAS.isotropicDirectionRule();
  assert.equal(result.quality,'quick');assert.equal(result.directions,40);assert.equal(result.count,48);
  assert.equal(result.intensity[0],1);near(result.qD.at(-1),120,1e-10);
  assert.ok(result.intensity.every(value=>Number.isFinite(value)&&value>=0));
  for(const k of [0,8,32,64,128,256,512]) {
    let expected=0;
    for(let i=0;i<40;i++)expected+=rule.weights[i]*SAS.directIntensity(points,Array.from(rule.vectors.subarray(i*3,i*3+3),v=>v*result.qD[k]));
    near(result.intensity[k],expected,.00001,`40-direction qD=${result.qD[k]}`);
  }
  assert.equal(progress.length,40);assert.equal(progress.at(-1),1);
});
test('Spherical quadrature has correct solid-angle weights',()=>{
  for(const n of [16,32,64]) {
    const {nodes,weights}=SAS.gaussLegendre(n);
    near(weights.reduce((a,b)=>a+b,0),2,1e-12);
    near(weights.reduce((a,w,i)=>a+w*nodes[i],0),0,1e-12);
    near(weights.reduce((a,w,i)=>a+w*nodes[i]**2,0),2/3,1e-12);
    near(weights.reduce((a,w,i)=>a+w*nodes[i]**14,0),2/15,1e-12);
  }
});
test('Isotropic projection FFT matches the exact finite-point Debye sum',()=>{
  const points=SAS.sampleShape('cube',48,123).points;
  const result=SAS.isotropicScattering(points,120,'balanced');
  assert.equal(result.intensity[0],1); near(result.qD.at(-1),120,1e-10);
  assert.equal(result.directions,2048); assert.equal(result.count,48);
  for(let k=0;result.qD[k]<=32;k+=4) near(result.intensity[k],debye(points,result.qD[k]),.00003,`qD=${result.qD[k]}`);
  assert.ok(result.intensity.every(value=>Number.isFinite(value)&&value>=0));
});
test('Refining the angular average improves high-q agreement with the Debye sum',()=>{
  const points=SAS.sampleShape('cube',48,123).points;
  const fast=SAS.isotropicScattering(points,120,'fast'), fine=SAS.isotropicScattering(points,120,'fine');
  let fastError=0,fineError=0;
  for(let k=160;k<fine.qD.length;k+=16) {
    const exact=debye(points,fine.qD[k]); fastError+=Math.abs(fast.intensity[k]-exact); fineError+=Math.abs(fine.intensity[k]-exact);
    near(fine.intensity[k],exact,.0005,`fine qD=${fine.qD[k]}`);
  }
  assert.ok(fineError<fastError*.3,`refinement error ${fineError} vs ${fastError}`);
});
test('Numerical isotropic intensity is invariant under point-cloud rotation and translation',()=>{
  const points=SAS.sampleShape('ellipsoid',80,52).points;
  const transformed=SAS.rotatePoints(points,SAS.rotationMatrix([37,-21,58]));
  for(let i=0;i<transformed.length;i++) transformed[i]+=[2,-3,4][i%3];
  const original=SAS.isotropicScattering(points,32,'balanced'), rotated=SAS.isotropicScattering(transformed,32,'balanced');
  for(let k=0;k<original.intensity.length;k+=4) near(original.intensity[k],rotated.intensity[k],.00003,`qD=${original.qD[k]}`);
});
test('The isotropic sphere agrees with the analytic continuum form factor including finite-point self terms',()=>{
  const n=30000,points=SAS.sampleShape('sphere',n,42).points;
  for(const quality of ['quick','balanced']) {
    const result=SAS.isotropicScattering(points,120,quality);
    for(let k=1;result.qD[k]<=16;k++) {
      const z=result.qD[k]*.5,amp=3*(Math.sin(z)-z*Math.cos(z))/z**3;
      near(result.intensity[k],1/n+(1-1/n)*amp*amp,.003,`${quality} qR=${z}`);
    }
  }
  const single=SAS.isotropicScattering(new Float32Array([2,3,4]),120,'fast');
  assert.ok(single.intensity.every(value=>value===1));
  assert.throws(()=>SAS.isotropicScattering(new Float32Array(),32,'fast'),/points/);
  assert.throws(()=>SAS.isotropicScattering(points,32,'unknown'),/accuracy/);
});
