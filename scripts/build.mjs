import {readFile, writeFile, mkdir, rm, cp, readdir} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [template, styles, core, worker, drop, app] = await Promise.all(['src/template.html', 'src/styles.css', 'src/core.js', 'src/worker.js', 'src/file-drop.js', 'src/app.js'].map(read));
const escapeScript = text => text.replace(/<\/script/gi, '<\\/script');
const catalog = JSON.parse(await read('examples/catalog.json'));
const modelFiles = (await readdir(new URL('examples/', root))).filter(name => /\.(stl|obj)$/i.test(name)).sort();
if (JSON.stringify(modelFiles) !== JSON.stringify(catalog.map(entry => entry.filename).sort())) throw Error('Every bundled STL/OBJ must have exactly one entry in examples/catalog.json.');
const samples = {};
for (const entry of catalog) {
  const buffer = await readFile(new URL('examples/' + entry.filename, root));
  const license = entry.licenseFile ? await read('examples/' + entry.licenseFile) : '';
  samples[entry.id] = {...entry, base64: buffer.toString('base64'), license};
}
const escapeHTML = text => text.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const groups = new Map();
for (const entry of catalog) {
  if (!groups.has(entry.group)) groups.set(entry.group, []);
  groups.get(entry.group).push(`<option value="${escapeHTML(entry.id)}">${escapeHTML(entry.label)} · ${entry.filename.split('.').pop().toUpperCase()}</option>`);
}
const options = [...groups].map(([label, entries]) => `<optgroup label="${escapeHTML(label)}">${entries.join('')}</optgroup>`).join('');
const output = template.replace('/*__STYLES__*/', () => styles).replace('<!--__MODEL_OPTIONS__-->', () => options).replace('/*__EXAMPLES__*/', () => escapeScript(JSON.stringify(samples))).replace('/*__WORKER__*/', () => escapeScript(core + '\n' + worker)).replace('/*__CORE__*/', () => escapeScript(core)).replace('/*__DROP__*/', () => escapeScript(drop)).replace('/*__APP__*/', () => escapeScript(app));
await writeFile(new URL('index.html', root), output);
// Publish only the app and its example files, never the repository or dev files.
await rm(new URL('dist/', root), {recursive: true, force: true});
await mkdir(new URL('dist/', root), {recursive: true});
await writeFile(new URL('dist/index.html', root), output);
await cp(new URL('examples/', root), new URL('dist/examples/', root), {recursive: true, filter: path => !path.split(/[\\/]/).pop().startsWith('.')});
console.log(`Built standalone index.html (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB), including all ${catalog.length} offline mesh examples. Cloudflare assets: dist/.`);
