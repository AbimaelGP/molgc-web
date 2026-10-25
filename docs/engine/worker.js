/* MolGC — Web Worker: ejecuta el motor fuera del hilo de la interfaz. */
/* global MolGCHandlers */
importScripts("molgc.js", "../vendor/fflate.min.js", "handlers.js");

self.onmessage = async (ev) => {
  const { id, op, payload } = ev.data;
  try {
    const result = await MolGCHandlers[op](payload || {});
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e && e.message ? e.message : String(e) });
  }
};
