const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const quads = [[1,4,3,2],[5,6,7,8],[1,2,6,5],[2,3,7,6],[3,4,8,7],[4,1,5,8]];
const triangles = quads.flatMap(([a,b,c,d]) => [[a,b,c],[a,c,d]]);
const obj = vertices.map(v => `v ${v.join(' ')}`).concat(quads.map(q => `f ${q.join(' ')}`)).join('\n');
const ascii = 'solid cube\n' + triangles.map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(i => `vertex ${vertices[i-1].join(' ')}`).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid cube\n';
function bytes(text) { return new TextEncoder().encode(text).buffer; }
function binarySTL() {
  const buf = new ArrayBuffer(84 + triangles.length * 50), v = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode('solid binary-header-can-say-solid'));
  v.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => t.forEach((vert, j) => vertices[vert-1].forEach((coord, a) => v.setFloat32(84 + i * 50 + 12 + j * 12 + a * 4, coord, true))));
  return buf;
}
module.exports = {vertices, quads, triangles, obj, ascii, bytes, binarySTL};
