/* Browser file-drop handling, isolated so OS drag metadata has regression tests. */
(function (root) {
  'use strict';
  function filesFrom(transfer) {
    if (!transfer) return [];
    const files = Array.from(transfer.files || []);
    if (files.length) return files;
    return Array.from(transfer.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  }
  function isFileDrag(transfer) {
    return !!transfer && (Array.from(transfer.types || []).some(type => type.toLowerCase() === 'files') || Array.from(transfer.items || []).some(item => item.kind === 'file') || !!transfer.files?.length);
  }
  function install({zone, surface, onFiles, onDragState = () => {}, shouldHandle = () => true}) {
    const listeners = [];
    const listen = (target, type, fn, capture = false) => { target.addEventListener(type, fn, capture); listeners.push(() => target.removeEventListener(type, fn, capture)); };
    let active = false;
    function highlight(value) {
      if (value === active) return;
      active = value; zone.classList.toggle('dragging', value); onDragState(value);
    }
    function allow(event) {
      if (!shouldHandle(event)) { highlight(false); return; }
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      highlight(true);
    }
    function receive(event) {
      if (!shouldHandle(event)) { highlight(false); return; }
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault(); event.stopPropagation(); highlight(false);
      const files = filesFrom(event.dataTransfer);
      if (files.length) onFiles(files);
    }
    // Capture prevents the browser opening a dropped STL instead of importing it.
    // The upload area also owns its drop handler; it does not depend on bubbling.
    listen(surface, 'dragenter', allow, true);
    listen(surface, 'dragover', allow, true);
    listen(zone, 'dragenter', allow);
    listen(zone, 'dragover', allow);
    listen(zone, 'drop', receive);
    listen(surface, 'drop', receive);
    listen(surface, 'dragend', () => highlight(false), true);
    listen(surface, 'blur', () => highlight(false));
    listen(surface, 'keydown', event => { if (event.key === 'Escape') highlight(false); });
    listen(surface, 'dragleave', event => {
      if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= surface.innerWidth || event.clientY >= surface.innerHeight)) highlight(false);
    }, true);
    return () => { listeners.forEach(remove => remove()); highlight(false); };
  }
  const api = {filesFrom, isFileDrag, install};
  root.ModelFileDrop = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
