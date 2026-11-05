const {test} = require('node:test');
const assert = require('node:assert/strict');
const SAS = require('../src/core.js');
const Inverse = require('../src/inverse.js');

test('Inverse input reads data and own isotropic CSV, sorts q, and rejects unusable measurements', () => {
  const rows = Array.from({length:10}, (_,i)=>`${(10-i)/100},${1/(11-i)},0.01`);
  const p = Inverse.parseProfile('# example\nq,I,sigma\n'+rows.join('\n'));
  assert.equal(p.q[0],.01); assert.equal(p.hasSigma,true);
  const own = 'profile,q,I_over_I0\n'+Array.from({length:10},(_,i)=>`isotropic,${i/100},${Math.exp(-i/10)}\nXY_azimuthal,${i/100},2`).join('\n');
  assert.equal(Inverse.parseProfile(own).q.length,10);
  assert.equal(Inverse.parseProfile(own).hasSigma,false);
  assert.throws(()=>Inverse.parseProfile('0,1\n1,2'),/at least 8/);
  assert.throws(()=>Inverse.parseProfile(rows.join('\n')+'\n.01,1,.1'),/Repeated/);
  assert.throws(()=>Inverse.parseProfile(rows.join('\n')+'\n.3,1,0'),/uncertainty/);
  assert.throws(()=>Inverse.parseProfile(own.replace('isotropic,0,1','isotropic,0,-1')),/negative/);
});

test('Nuisance scale and nonnegative background use weighted least squares with boundary solutions', () => {
  const curve=Float64Array.from([1,.8,.6,.4,.3,.2,.1,.05]);
  const p=Inverse.prepareProfile(Array.from(curve,(v,i)=>[i*.01,4*v+.3,.01]),true);
  const fit=Inverse.fitScale(p,curve,true);
  assert.ok(Math.abs(fit.scale-4)<1e-12);assert.ok(Math.abs(fit.background-.3)<1e-12);assert.ok(fit.wrms<1e-10);
  const constrained=Inverse.fitScale(Inverse.prepareProfile(Array.from(curve,(v,i)=>[i*.01,4*v-.1,.01]),true),curve,true);
  assert.equal(constrained.background,0);assert.ok(constrained.scale>=0);
});

test('Voxel scattering includes the finite cube form factor, including a single cube at the origin', () => {
  const points=new Float32Array([0,0,0,.15,-.1,.2]),h=.12;
  const actual=SAS.isotropicScattering(points,20,'balanced',()=>{},h),rule=SAS.isotropicDirectionRule('balanced');
  const sinc=x=>x===0?1:Math.sin(x)/x;
  for(const k of [0,40,170,400,512]) {
    const q=actual.qD[k];let expected=0;
    for(let d=0;d<rule.directions;d++) {
      const [x,y,z]=rule.vectors.subarray(d*3,d*3+3),phase=q*(points[3]*x+points[4]*y+points[5]*z);
      const factor=sinc(q*h*x/2)*sinc(q*h*y/2)*sinc(q*h*z/2);
      expected+=rule.weights[d]*(1+Math.cos(phase))/2*factor**2;
    }
    assert.ok(Math.abs(actual.intensity[k]-expected)<.001,`${k}: ${actual.intensity[k]} vs ${expected}`);
  }
  const one=SAS.isotropicScattering(new Float32Array([0,0,0]),20,'fast',()=>{},.1);
  assert.equal(one.intensity[0],1);assert.ok(one.intensity.at(-1)<.8,'a uniform cube is not a unit point at nonzero q');
});

test('Synthetic reconstruction improves the fit, stays connected, and exports the fitted closed volume reproducibly', () => {
  const profile=Inverse.sphereExample(),settings={diameter:80,size:9,iterations:1000,attempts:1,seed:42,qmax:.14};
  let initial;
  const result=Inverse.reconstruct(profile,settings,update=>{if(update.step===1)initial=update.wrms;}),c=result.candidates[0];
  assert.ok(c.wrms<initial*.6,`${c.wrms} vs initial ${initial}`);assert.ok(c.wrms<1.5);
  const lattice=Inverse.makeLattice(settings.size,settings.diameter);
  assert.ok(Inverse.isConnected(lattice,c.occupied,c.voxelCount));
  assert.ok(c.occupied.every((v,i)=>!v||Inverse.localManifold(lattice,c.occupied,i)));
  const mesh=SAS.prepareMesh(c.mesh,'inverse.stl');
  assert.equal(SAS.checkClosed(mesh.triangles).boundary,0);
  const raw=SAS.parseSTL(c.mesh);let volume=0;
  for(let i=0;i<raw.length;i+=9)volume+=(raw[i]*(raw[i+4]*raw[i+8]-raw[i+5]*raw[i+7])+raw[i+1]*(raw[i+5]*raw[i+6]-raw[i+3]*raw[i+8])+raw[i+2]*(raw[i+3]*raw[i+7]-raw[i+4]*raw[i+6]))/6;
  assert.ok(Math.abs(volume-c.volume)<c.volume*1e-6,'STL volume matches fitted occupied cubes');
  const rg=Math.sqrt(SAS.pointStats(c.points).rg**2+1/(4*settings.size**2))*settings.diameter;
  assert.ok(Math.abs(rg-Math.sqrt(3/5)*30)<3,'recovers synthetic sphere low-q size');
  const repeat=Inverse.reconstruct(profile,settings).candidates[0];
  assert.deepEqual(repeat.occupied,c.occupied);assert.equal(repeat.wrms,c.wrms);
});

test('Independent starts produce closed candidates; excessive q range and insufficient coverage are rejected', () => {
  const profile=Inverse.sphereExample(),result=Inverse.reconstruct(profile,{diameter:90,size:9,iterations:500,attempts:3,qmax:.14});
  assert.equal(result.candidates.length,3);assert.equal(new Set(result.candidates.map(c=>c.seed)).size,3);
  for(const c of result.candidates)assert.ok(SAS.prepareMesh(c.mesh,'candidate.stl').faces>0);
  assert.throws(()=>Inverse.reconstruct(profile,{diameter:300,qmax:.14}),/≤ 30/);
  assert.throws(()=>Inverse.reconstruct(profile,{diameter:80,qmax:.004}),/at least 8/);
});

test('Search fits an independent analytic prolate-ellipsoid intensity, not just its initial sphere', () => {
  const rule=SAS.isotropicDirectionRule('balanced'),rows=[];
  for(let i=0;i<80;i++) {
    const q=.005+i*.235/79;let value=0;
    for(let d=0;d<rule.directions;d++) {
      const radius=Math.hypot(rule.vectors[d*3]*30,rule.vectors[d*3+1]*15,rule.vectors[d*3+2]*15),x=q*radius;
      const amplitude=3*(Math.sin(x)-x*Math.cos(x))/x**3;
      value+=rule.weights[d]*amplitude*amplitude;
    }
    rows.push([q,value,.03*value+.0003]);
  }
  let initial;
  const result=Inverse.reconstruct(Inverse.prepareProfile(rows,true),{diameter:70,size:11,iterations:3000,attempts:1,qmax:.24},update=>{if(update.step===1)initial=update.wrms;});
  assert.ok(result.candidates[0].wrms<initial*.1);
  assert.ok(result.candidates[0].wrms<1);
  assert.ok(SAS.prepareMesh(result.candidates[0].mesh,'ellipsoid-fit.stl').faces>0);
});
