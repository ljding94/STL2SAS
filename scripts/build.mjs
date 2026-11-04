import {readFile, writeFile, mkdir, rm, cp} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [template, styles, core, worker, app] = await Promise.all(['src/template.html', 'src/styles.css', 'src/core.js', 'src/worker.js', 'src/app.js'].map(read));
const escapeScript = text => text.replace(/<\/script/gi, '<\\/script');
const license = await read('examples/TRIMESH-LICENSE.txt');
const samples = {};
for (const [key, filename] of [['stl-torus', 'trimesh-torus.stl'], ['stl-angle-block', 'trimesh-angle-block.stl']]) {
  const buffer = await readFile(new URL('examples/' + filename, root));
  samples[key] = {filename, base64: buffer.toString('base64'), license, source: 'https://github.com/mikedh/trimesh/tree/6c158cce226500fc64b12acd265af0cf01d1c212/models'};
}
const output = template.replace('/*__STYLES__*/', () => styles).replace('/*__EXAMPLES__*/', () => escapeScript(JSON.stringify(samples))).replace('/*__WORKER__*/', () => escapeScript(core + '\n' + worker)).replace('/*__CORE__*/', () => escapeScript(core)).replace('/*__APP__*/', () => escapeScript(app));
await writeFile(new URL('index.html', root), output);
// Publish only the app and its example files, never the repository or dev files.
await rm(new URL('dist/', root), {recursive: true, force: true});
await mkdir(new URL('dist/', root), {recursive: true});
await writeFile(new URL('dist/index.html', root), output);
await cp(new URL('examples/', root), new URL('dist/examples/', root), {recursive: true, filter: path => !path.split(/[\\/]/).pop().startsWith('.')});
console.log(`Built standalone index.html (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB), including two offline STL examples. Cloudflare assets: dist/.`);
