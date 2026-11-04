const {test} = require('node:test');
const assert = require('node:assert/strict');
const drop = require('../src/file-drop.js');

class Surface {
  constructor() { this.handlers = new Map(); this.classes = new Set(); this.classList = {toggle: (key, active) => active ? this.classes.add(key) : this.classes.delete(key)}; }
  addEventListener(type, handler, capture) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push({handler, capture}); }
  removeEventListener(type, handler) { this.handlers.set(type, this.handlers.get(type).filter(x => x.handler !== handler)); }
  fire(type, event) { for (const {handler} of this.handlers.get(type) || []) handler(event); }
}
function dragEvent(transfer) { return {dataTransfer: transfer, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }}; }
function setup() {
  const zone = new Surface(), surface = new Surface(), received = [], highlighted = [];
  const dispose = drop.install({zone, surface, onFiles: files => received.push(files), onDragState: active => highlighted.push(active)});
  return {zone, surface, received, highlighted, dispose};
}
test('Dropping a native STL on the upload area imports it once and cancels file navigation', () => {
  const {zone, surface, received} = setup(), file = {name:'car.STL'}, transfer = {types:['Files'], files:[file]};
  const over = dragEvent(transfer); surface.fire('dragover', over); zone.fire('dragover', over);
  assert.ok(over.prevented); assert.equal(transfer.dropEffect, 'copy'); assert.ok(zone.classes.has('dragging'));
  const event = dragEvent(transfer); zone.fire('drop', event); if (!event.stopped) surface.fire('drop', event);
  assert.ok(event.prevented); assert.ok(event.stopped); assert.deepEqual(received, [[file]]); assert.ok(!zone.classes.has('dragging'));
  assert.ok(surface.handlers.get('dragover').some(x => x.capture === true));
});
test('Drag metadata can expose items before files, even with an empty types list', () => {
  const {surface, received} = setup(), file = {name:'car.stl'};
  const transfer = {types:[], files:[], items:[{kind:'file', getAsFile:() => file}]};
  const event = dragEvent(transfer); surface.fire('dragover', event); assert.ok(event.prevented);
  surface.fire('drop', event); assert.deepEqual(received, [[file]]);
});
test('Files dropped elsewhere in the page use the same import path', () => {
  const {surface, received} = setup(), file = {name:'cube.obj'};
  const event = dragEvent({types:['Files'], files:[file]}); surface.fire('drop', event);
  assert.ok(event.prevented); assert.deepEqual(received, [[file]]);
});
test('Text drags are untouched; Escape, window exit, and blur clear the file highlight', () => {
  const {zone, surface, received} = setup();
  const text = dragEvent({types:['text/plain'], files:[]}); surface.fire('dragover', text); surface.fire('drop', text);
  assert.ok(!text.prevented); assert.equal(received.length, 0);
  for (const [type, cancellation] of [['keydown',{key:'Escape'}], ['dragleave',{relatedTarget:null,clientX:0,clientY:0}], ['blur',{}]]) {
    surface.fire('dragenter', dragEvent({types:['Files'], files:[]})); assert.ok(zone.classes.has('dragging'));
    surface.fire(type, cancellation); assert.ok(!zone.classes.has('dragging'));
  }
});
test('Disposing drop listeners leaves no importer attached', () => {
  const {zone, surface, received, dispose} = setup(); dispose();
  const event = dragEvent({types:['Files'], files:[{name:'car.stl'}]}); zone.fire('drop',event); surface.fire('drop',event);
  assert.deepEqual(received, []);
});
