(function (root) {
  'use strict';
  const SAS = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.SAS;
  const sinc = x => Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;

  function prepareProfile(rows, hasSigma = false) {
    if (rows.length < 8) throw Error('Provide at least 8 q, intensity data points.');
    if (rows.length > 5000) throw Error('Use at most 5,000 data points for this browser MVP.');
    rows = rows.map(row => [...row]).sort((a, b) => a[0] - b[0]);
    const positive = rows.filter(row => row[1] > 0);
    if (positive.length < 5) throw Error('At least 5 intensities must be positive.');
    const reference = Math.max(...positive.slice(0, 5).map(row => row[1]));
    for (let i = 0; i < rows.length; i++) {
      const [q, value, sigma] = rows[i];
      if (!Number.isFinite(q) || q < 0 || !Number.isFinite(value)) throw Error('q must be finite and nonnegative, and intensity must be finite.');
      if (i && q === rows[i - 1][0]) throw Error('Repeated q values: merge duplicate measurements first.');
      if (hasSigma && (!Number.isFinite(sigma) || sigma <= 0)) throw Error('Every supplied uncertainty must be positive.');
      if (!hasSigma && value <= 0) throw Error('For zero or negative intensities, supply a third column with positive uncertainties.');
    }
    // Two-column data use explicitly assumed weights, not measured uncertainties.
    const profile = {
      q: Float64Array.from(rows, row => row[0]),
      intensity: Float64Array.from(rows, row => row[1]),
      sigma: Float64Array.from(rows, row => hasSigma ? row[2] : Math.max(.05 * Math.abs(row[1]), .002 * reference)),
      hasSigma
    };
    let rg = null;
    for (let end = 5; end <= Math.min(24, positive.length); end++) {
      const subset = positive.slice(0, end);
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [q, value] of subset) { const x = q * q, y = Math.log(value); sx += x; sy += y; sxx += x*x; sxy += x*y; }
      const denominator = end * sxx - sx*sx;
      if (denominator <= 0) continue;
      const slope = (end*sxy - sx*sy) / denominator;
      if (slope >= 0) continue;
      const candidate = Math.sqrt(-3*slope);
      if (subset.at(-1)[0] * candidate <= 1.3) rg = candidate;
    }
    profile.rg = rg;
    profile.suggestedDiameter = rg ? 4 * rg : null;
    return profile;
  }

  function parseProfile(text) {
    const rows = []; let columns = null, profileCSV = false;
    for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || /^(#|;|\/\/)/.test(line)) continue;
      const parts = line.split(/[,\s]+/).filter(Boolean);
      if (/^profile$/i.test(parts[0])) { profileCSV = true; continue; }
      if (profileCSV || /^(isotropic|XY_azimuthal|XZ_azimuthal|YZ_azimuthal)$/.test(parts[0])) {
        if (parts[0] !== 'isotropic') continue;
        parts.shift();
      }
      if (!/^[+\-\d.]/.test(parts[0])) continue;
      if (parts.length !== 2 && parts.length !== 3) throw Error(`Line ${index + 1}: expected q, intensity, and optional uncertainty.`);
      const values = parts.map(Number);
      if (!values.every(Number.isFinite)) throw Error(`Line ${index + 1}: invalid numerical value.`);
      if (columns !== null && columns !== values.length) throw Error('Use the same number of columns on every data row.');
      columns = values.length; rows.push(values);
    }
    return prepareProfile(rows, columns === 3);
  }

  function fitScale(profile, curve, background = false) {
    let xx = 0, xy = 0, x = 0, y = 0, wsum = 0;
    for (let i = 0; i < curve.length; i++) {
      const w = 1 / profile.sigma[i] ** 2, p = curve[i], value = profile.intensity[i];
      xx += w*p*p; xy += w*p*value; x += w*p; y += w*value; wsum += w;
    }
    const options = [[Math.max(0, xy / Math.max(xx, 1e-300)), 0]];
    if (background) {
      const determinant = xx*wsum - x*x;
      if (determinant > 1e-20 * Math.max(xx*wsum, 1e-300)) {
        const a = (xy*wsum - x*y) / determinant, b = (xx*y - x*xy) / determinant;
        if (a >= 0 && b >= 0) options.push([a,b]);
      }
      options.push([0, Math.max(0, y / wsum)]);
    }
    let best = null;
    for (const [scale, offset] of options) {
      let score = 0;
      for (let i = 0; i < curve.length; i++) score += ((scale * curve[i] + offset - profile.intensity[i]) / profile.sigma[i]) ** 2;
      score /= curve.length;
      if (!best || score < best.score) best = {scale, background: offset, score, wrms: Math.sqrt(score)};
    }
    return best;
  }

  function makeLattice(size, diameter) {
    if (![9,11].includes(size) || !(diameter > 0) || !Number.isFinite(diameter)) throw Error('Invalid search resolution or diameter.');
    const sites = [], lookup = new Int32Array(size**3).fill(-1), half = (size - 1)/2;
    // Every cube, including its corners, stays within the search sphere.
    const radius = size/2 - Math.sqrt(3)/2;
    for (let z=0; z<size; z++) for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
      const p=[x-half,y-half,z-half];
      if (Math.hypot(...p) > radius) continue;
      lookup[(z*size+y)*size+x]=sites.length;
      sites.push({x,y,z,p:p.map(v=>v/size)});
    }
    const offsets=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const at=(x,y,z)=>x<0||y<0||z<0||x>=size||y>=size||z>=size ? -1 : lookup[(z*size+y)*size+x];
    const neighbors=sites.map(s=>offsets.map(([x,y,z])=>at(s.x+x,s.y+y,s.z+z)));
    return {size,diameter,sites,lookup,neighbors,at};
  }

  const validBlocks = Uint8Array.from({length:256}, (_, mask) => {
    // A checkerboard on any 2×2 face produces an edge with four incident
    // boundary quads, even when the full block is connected through its other face.
    for (const axis of [1,2,4]) for (let layer=0;layer<2;layer++) {
      const ids=Array.from({length:8},(_,i)=>i).filter(i=>Number(!!(i&axis))===layer);
      const bits=ids.map(i=>Number(!!(mask&(1<<i))));
      if(bits[0]===bits[3]&&bits[1]===bits[2]&&bits[0]!==bits[1])return 0;
    }
    function connected(bits) {
      if (!bits) return true;
      const queue=[Math.log2(bits & -bits)]; let seen=0;
      while(queue.length) {
        const i=queue.pop(), bit=1<<i;
        if (seen&bit) continue;
        seen|=bit;
        for(const axis of [1,2,4]) {const next=i^axis;if((bits&(1<<next))&&!(seen&(1<<next)))queue.push(next);}
      }
      return seen===bits;
    }
    return Number(connected(mask)&&connected(255^mask));
  });

  function localManifold(lattice, occupied, site) {
    const {x,y,z}=lattice.sites[site];
    for(let oz=-1;oz<=0;oz++)for(let oy=-1;oy<=0;oy++)for(let ox=-1;ox<=0;ox++) {
      let mask=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
        const i=lattice.at(x+ox+dx,y+oy+dy,z+oz+dz);
        if(i>=0&&occupied[i])mask|=1<<(dx+2*dy+4*dz);
      }
      if(!validBlocks[mask])return false;
    }
    return true;
  }

  function isConnected(lattice, occupied, count) {
    const first=occupied.indexOf(1);
    if(first<0)return false;
    const seen=new Uint8Array(occupied.length),queue=[first];seen[first]=1;let visited=0;
    while(queue.length) {const i=queue.pop();visited++;for(const j of lattice.neighbors[i])if(j>=0&&occupied[j]&&!seen[j]){seen[j]=1;queue.push(j);}}
    return visited===count;
  }

  function initialShape(lattice, rg, attempt) {
    const radius = Math.min(.39, rg ? Math.sqrt(5/3)*rg/lattice.diameter : .32);
    let axes=[radius,radius,radius];
    if(attempt%3===1) {const a=Math.min(.4,radius*1.35), b=Math.sqrt(Math.max(.02,3*radius*radius-a*a)/2);axes=[a,b,b];}
    if(attempt%3===2) {const c=radius*.65,a=Math.sqrt((3*radius*radius-c*c)/2);axes=[a,a,c];}
    let occupied=Uint8Array.from(lattice.sites,s=>Number(s.p.reduce((sum,v,i)=>sum+(v/axes[i])**2,0)<=1));
    if(occupied.reduce((a,b)=>a+b,0)<12) occupied=Uint8Array.from(lattice.sites,s=>Number(Math.hypot(...s.p)<.29));
    // The export must remain a closed cubical complex throughout the search.
    if(!occupied.every((value,i)=>!value||localManifold(lattice,occupied,i))) {
      occupied=Uint8Array.from(lattice.sites,s=>Number(s.p.every(v=>Math.abs(v)<=.2)));
    }
    return occupied;
  }

  function optimizationRule() {
    const {nodes,weights}=SAS.gaussLegendre(16), directions=[];
    let sum=0;for(let p=8;p<16;p++)sum+=weights[p];
    for(let p=8;p<16;p++)for(let a=0;a<32;a++) {
      const phi=2*Math.PI*a/32,r=Math.sqrt(1-nodes[p]**2);
      directions.push([r*Math.cos(phi),r*Math.sin(phi),nodes[p],weights[p]/(32*sum)]);
    }
    return directions;
  }

  function subset(profile, qmax, limit=64) {
    const eligible=Array.from(profile.q.keys()).filter(i=>profile.q[i]<=qmax*(1+1e-12));
    if(eligible.length<8)throw Error('The selected q range must contain at least 8 data points.');
    const indices=eligible.length<=limit ? eligible : Array.from({length:limit},(_,i)=>eligible[Math.round(i*(eligible.length-1)/(limit-1))]);
    return {...profile,q:Float64Array.from(indices,i=>profile.q[i]),intensity:Float64Array.from(indices,i=>profile.intensity[i]),sigma:Float64Array.from(indices,i=>profile.sigma[i])};
  }

  function interpolate(x, values, q) {
    if(q<=x[0])return values[0];
    if(q>=x.at(-1))return values.at(-1);
    let low=0,high=x.length-1;
    while(high-low>1){const mid=(high+low)>>1;if(x[mid]<=q)low=mid;else high=mid;}
    const fraction=(q-x[low])/(x[high]-x[low]);
    return values[low]*(1-fraction)+values[high]*fraction;
  }

  function centers(lattice, occupied) {
    return Float32Array.from(lattice.sites.flatMap((s,i)=>occupied[i]?s.p:[]));
  }

  function voxelSTL(lattice, occupied) {
    const faceVertices=[[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]];
    const normals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],triangles=[];
    for(let i=0;i<occupied.length;i++)if(occupied[i])for(let f=0;f<6;f++) {
      const neighbor=lattice.neighbors[i][f];if(neighbor>=0&&occupied[neighbor])continue;
      const site=lattice.sites[i],quad=faceVertices[f].map(v=>v.map((a,k)=>([site.x,site.y,site.z][k]+a-lattice.size/2)*lattice.diameter/lattice.size));
      for(const ids of [[0,1,2],[0,2,3]])triangles.push({normal:normals[f],vertices:ids.flatMap(j=>quad[j])});
    }
    const buffer=new ArrayBuffer(84+50*triangles.length),view=new DataView(buffer);
    new Uint8Array(buffer).set(new TextEncoder().encode('STL2SAS experimental inverse: connected uniform voxel envelope'));
    view.setUint32(80,triangles.length,true);
    triangles.forEach((triangle,i)=>[...triangle.normal,...triangle.vertices].forEach((value,k)=>view.setFloat32(84+i*50+k*4,value,true)));
    return buffer;
  }

  function reconstruct(profile, settings={}, progress=()=>{}) {
    const start=performance.now();
    const diameter=Number(settings.diameter),size=Number(settings.size||11),iterations=Number(settings.iterations||5000),attempts=Number(settings.attempts||3),seed=Number(settings.seed||42),regularization=Number(settings.regularization??.3),background=!!settings.background;
    const qmax=Math.min(Number(settings.qmax||profile.q.at(-1)),profile.q.at(-1));
    if(!Number.isFinite(qmax)||qmax<=0||qmax*diameter>30.00001)throw Error('This coarse envelope requires q max × search diameter ≤ 30. Lower q max or the search diameter.');
    if(!Number.isInteger(iterations)||iterations<500||iterations>20000||![1,3].includes(attempts)||!Number.isFinite(seed)||!Number.isFinite(regularization)||regularization<0||regularization>5)throw Error('Invalid reconstruction settings.');
    const used=subset(profile,qmax,5000),sample=subset(used,qmax),lattice=makeLattice(size,diameter),directions=optimizationRule();
    const nq=sample.q.length,nd=directions.length,width=nq*nd,cache=new Float32Array(lattice.sites.length*width*2),factors=new Float64Array(width);
    for(let q=0;q<nq;q++)for(let d=0;d<nd;d++) {
      const dir=directions[d],v=sample.q[q]*diameter/(2*size);
      factors[q*nd+d]=dir[3]*(sinc(v*dir[0])*sinc(v*dir[1])*sinc(v*dir[2]))**2;
    }
    progress({stage:'Preparing angular amplitudes',fraction:0});
    for(let i=0;i<lattice.sites.length;i++) {
      const p=lattice.sites[i].p;
      for(let q=0;q<nq;q++)for(let d=0;d<nd;d++) {
        const direction=directions[d],phase=sample.q[q]*diameter*(p[0]*direction[0]+p[1]*direction[1]+p[2]*direction[2]),index=(i*width+q*nd+d)*2;
        cache[index]=Math.cos(phase);cache[index+1]=Math.sin(phase);
      }
      if(i%32===0)progress({stage:'Preparing angular amplitudes',fraction:.1*i/lattice.sites.length});
    }
    const candidates=[];
    for(let attempt=0;attempt<attempts;attempt++) {
      const random=SAS.random(seed+attempt*7919),occupied=initialShape(lattice,profile.rg,attempt),amplitude=new Float64Array(width*2);
      let count=occupied.reduce((a,b)=>a+b,0),surface=0;
      for(let i=0;i<occupied.length;i++)if(occupied[i]) {
        for(let k=0;k<amplitude.length;k++)amplitude[k]+=cache[i*amplitude.length+k];
        for(const j of lattice.neighbors[i])if(j<0||!occupied[j])surface++;
      }
      function evaluate(site=-1,sign=0,n=count) {
        const curve=new Float64Array(nq),base=site*width*2;
        for(let q=0;q<nq;q++) {
          let intensity=0;
          for(let d=0;d<nd;d++) {
            const k=q*nd+d,index=k*2;
            const re=amplitude[index]+(sign?sign*cache[base+index]:0),im=amplitude[index+1]+(sign?sign*cache[base+index+1]:0);
            intensity+=factors[k]*(re*re+im*im);
          }
          curve[q]=intensity/(n*n);
        }
        return {...fitScale(sample,curve,background),curve};
      }
      const compactness=(area,n)=>area/(6*n**(2/3));
      let current=evaluate(),energy=current.score+regularization*compactness(surface,count),best={occupied:occupied.slice(),...current,energy,count,surface};
      for(let step=0;step<iterations;step++) {
        let site=-1,neighbors=0;
        for(let trial=0;trial<30;trial++) {
          const candidate=Math.floor(random()*occupied.length),near=lattice.neighbors[candidate].reduce((sum,j)=>sum+(j>=0?occupied[j]:0),0);
          if((occupied[candidate]&&near<6&&count>12)||(!occupied[candidate]&&near>0&&count<occupied.length*.9)){site=candidate;neighbors=near;break;}
        }
        if(site>=0) {
          const sign=occupied[site]?-1:1,nextCount=count+sign,nextSurface=surface+sign*(6-2*neighbors);
          occupied[site]=sign===1?1:0;
          const valid=localManifold(lattice,occupied,site)&&(sign===1||isConnected(lattice,occupied,nextCount));
          occupied[site]=sign===1?0:1;
          if(valid) {
            const proposal=evaluate(site,sign,nextCount),nextEnergy=proposal.score+regularization*compactness(nextSurface,nextCount);
            const temperature=Math.max(.002,Math.min(4,Math.max(.15,best.score*.08)))*(.003/.15)**(step/iterations);
            if(nextEnergy<energy||random()<Math.exp((energy-nextEnergy)/temperature)) {
              occupied[site]=sign===1?1:0;count=nextCount;surface=nextSurface;current=proposal;energy=nextEnergy;
              for(let k=0;k<amplitude.length;k++)amplitude[k]+=sign*cache[site*amplitude.length+k];
              if(energy<best.energy)best={occupied:occupied.slice(),...proposal,energy,count,surface};
            }
          }
        }
        if(step%100===0||step===iterations-1)progress({stage:`Searching candidate ${attempt+1}/${attempts}`,fraction:.1+.8*(attempt+step/iterations)/attempts,attempt:attempt+1,step:step+1,iterations,wrms:best.wrms,q:sample.q,curve:Float64Array.from(best.curve,v=>v*best.scale+best.background)});
      }
      const mesh=voxelSTL(lattice,best.occupied);
      // Independent dense angular/FFT evaluation includes each voxel's exact
      // uniform-cube amplitude, so it describes the exported cubical geometry.
      progress({stage:`Verifying candidate ${attempt+1}/${attempts}`,fraction:.1+.8*(attempt+1)/attempts});
      const verified=SAS.isotropicScattering(centers(lattice,best.occupied),Math.max(4,qmax*diameter),'balanced',()=>{},1/size);
      const rawCurve=Float64Array.from(used.q,q=>interpolate(verified.qD,verified.intensity,q*diameter)),fit=fitScale(used,rawCurve,background);
      candidates.push({attempt:attempt+1,seed:seed+attempt*7919,occupied:best.occupied,points:centers(lattice,best.occupied),mesh,voxelCount:best.count,volume:best.count*(diameter/size)**3,compactness:compactness(best.surface,best.count),...fit,curve:Float64Array.from(rawCurve,v=>v*fit.scale+fit.background),optimizationWRMS:best.wrms});
    }
    candidates.sort((a,b)=>(a.score+regularization*a.compactness)-(b.score+regularization*b.compactness));
    progress({stage:'Complete',fraction:1});
    return {candidates,data:used,settings:{diameter,size,iterations,attempts,seed,regularization,background,qmax},optimizedPoints:sample.q.length,optimizationDirections:nd,verificationDirections:2048,ms:performance.now()-start};
  }

  function sphereExample() {
    const random=SAS.random(1701),rows=[],radius=30;
    for(let i=0;i<100;i++) {
      const q=.004+i*.136/99,x=q*radius,a=3*(Math.sin(x)-x*Math.cos(x))/x**3,intensity=a*a,sigma=.03*intensity+.0002;
      const noise=Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random());
      rows.push([q,intensity+sigma*noise*.4,sigma]);
    }
    return prepareProfile(rows,true);
  }

  const api={parseProfile,prepareProfile,fitScale,makeLattice,localManifold,isConnected,initialShape,voxelSTL,centers,interpolate,reconstruct,sphereExample};
  root.SASInverse=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:self);
