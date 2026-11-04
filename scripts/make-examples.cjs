const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'examples');
fs.mkdirSync(dir, {recursive: true});
const f = require('../tests/fixtures.cjs');
fs.writeFileSync(path.join(dir, 'cube.stl'), Buffer.from(f.binarySTL()));
fs.writeFileSync(path.join(dir, 'cube.obj'), f.obj + '\n');
const rings = 24, sectors = 48, vertices = [[0,0,18]], faces = [];
for (let r = 1; r < rings; r++) for (let s = 0; s < sectors; s++) {
  const phi = Math.PI * r / rings, theta = 2 * Math.PI * s / sectors;
  vertices.push([50 * Math.sin(phi) * Math.cos(theta),27 * Math.sin(phi) * Math.sin(theta),18 * Math.cos(phi)]);
}
const bottom = vertices.push([0,0,-18]) - 1;
const ring = (r,s) => 1 + (r-1) * sectors + (s + sectors) % sectors;
for (let s = 0; s < sectors; s++) {
  faces.push([0, ring(1,s), ring(1,s+1)], [bottom, ring(rings-1,s+1), ring(rings-1,s)]);
  for (let r = 1; r < rings-1; r++) faces.push([ring(r,s),ring(r+1,s),ring(r,s+1)], [ring(r,s+1),ring(r+1,s),ring(r+1,s+1)]);
}
const buffer = Buffer.alloc(84 + faces.length * 50);
buffer.write('STL2SAS triaxial ellipsoid, dimensions 100 x 54 x 36'); buffer.writeUInt32LE(faces.length,80);
faces.forEach((face,i) => face.forEach((v,j) => vertices[v].forEach((x,a) => buffer.writeFloatLE(x,84 + i*50 + 12 + j*12 + a*4))));
fs.writeFileSync(path.join(dir,'ellipsoid.stl'),buffer);
const xy = [[-1,-1],[1,-1],[1,0],[0,0],[0,1],[-1,1]];
const prismVertices = [-.5,.5].flatMap(z => xy.map(([x,y]) => `v ${x} ${y} ${z}`));
const prismFaces = ['f 6 5 4 3 2 1','f 7 8 9 10 11 12'];
for(let i=0;i<6;i++){const a=i+1,b=(i+1)%6+1;prismFaces.push(`f ${a} ${b} ${b+6} ${a+6}`);}
fs.writeFileSync(path.join(dir,'concave-L.obj'), [...prismVertices,...prismFaces].join('\n')+'\n');
console.log('Wrote example cube STL/OBJ, ellipsoid STL, and concave L-prism OBJ.');
