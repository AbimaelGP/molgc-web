/* MolGC — operaciones de la interfaz sobre el motor. Se usa dentro del Web Worker (worker.js)
   o, si el navegador no permite workers, directamente en la página. */
/* global MolGC, fflate */
(function (root) {
"use strict";

const GEOMETRY_EXT = /\.(log|out|castep|xyz|in)(\.txt)?$/i;
const MAX_ATOMS = 1000;

function decode(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { return new TextDecoder("windows-1252").decode(u8); }
}

function readOne(file) {
  const g = MolGC.readGeometry(file.text, file.name);
  if (g.natoms > MAX_ATOMS) throw new MolGC.ParseError(`tiene ${g.natoms} átomos; el máximo es ${MAX_ATOMS}.`);
  return g;
}
const base = (n) => String(n).split(/[\\/]/).pop().replace(/\.txt$/i, "");

function uniqueLabels(labels) {
  const seen = {};
  return labels.map((l) => { if (seen[l]) { seen[l]++; return `${l} #${seen[l]}`; } seen[l] = 1; return l; });
}

/** Ruta dentro del ZIP -> {family, molecule, software, functional} (últimos 5 niveles). */
function zipEntries(names) {
  const out = [];
  for (const raw of names) {
    const name = raw.replace(/\\/g, "/");
    const parts = name.split("/").filter(Boolean);
    if (!parts.length || parts.some((p) => p.startsWith("__MACOSX") || p.startsWith("."))) continue;
    if (!GEOMETRY_EXT.test(parts[parts.length - 1])) continue;
    let fam, mol, sw, fn;
    if (parts.length >= 5) [fam, mol, sw, fn] = parts.slice(-5, -1);
    else if (parts.length === 4) { fam = "General"; [mol, sw, fn] = parts.slice(-4, -1); }
    else continue;
    out.push({ family: fam, molecule: mol, software: sw, functional: fn, member: raw });
  }
  return out;
}
function scanSummary(entries) {
  const keys = {}, mols = new Set(), fams = new Set();
  entries.forEach((e) => { const k = `${e.functional} (${e.software})`; keys[k] = (keys[k] || 0) + 1; mols.add(e.family + "/" + e.molecule); fams.add(e.family); });
  return { n_geometries: entries.length, n_molecules: mols.size, families: [...fams].sort(),
    keys: Object.keys(keys).sort().map((k) => ({ key: k, count: keys[k] })) };
}

async function loadStudy(src) {
  // src: {zip: ArrayBuffer} | {files: [{member, url}]} (demo)
  if (src.zip) {
    const names = [];
    fflate.unzipSync(new Uint8Array(src.zip), { filter: (f) => { names.push(f.name); return false; } });
    const entries = zipEntries(names);
    if (!entries.length) throw new Error("No se encontraron geometrías con la estructura Familia/Molécula/Software/Funcional/archivo dentro del ZIP.");
    return { entries, read: () => {
      const wanted = new Set(entries.map((e) => e.member));
      const data = fflate.unzipSync(new Uint8Array(src.zip), { filter: (f) => wanted.has(f.name) });
      entries.forEach((e) => (e.text = decode(data[e.member])));
    } };
  }
  const entries = zipEntries(src.files.map((f) => f.member));
  const urlOf = Object.fromEntries(src.files.map((f) => [f.member, f.url]));
  return { entries, read: async () => {
    let i = 0;
    const work = async () => {
      while (i < entries.length) {
        const e = entries[i++];
        const r = await fetch(urlOf[e.member]);
        if (!r.ok) throw new Error(`No se pudo descargar ${e.member}`);
        e.text = decode(await r.arrayBuffer());
      }
    };
    await Promise.all(Array.from({ length: 8 }, work));
  } };
}

const handlers = {
  info: () => ({ version: MolGC.version, bond_table: MolGC.bondTableRows() }),

  parse: ({ files }) => ({ files: files.map((f) => {
    try {
      const g = readOne(f);
      return { ok: true, name: f.name, software: g.software, functional: g.functional, basis: g.basis, n_atoms: g.natoms,
        formula: g.formula, warnings: g.warnings, label: MolGC.suggestLabel(g, f.name) };
    } catch (e) { return { ok: false, name: f.name, error: e.message }; }
  }) }),

  compare: ({ files, ref_index, options }) => {
    const t0 = performance.now();
    if (files.length < 2) throw new Error("Seleccione al menos dos geometrías: una referencia y una a evaluar.");
    const geos = files.map((f) => { try { return readOne(f); } catch (e) { throw new Error(`«${base(f.name)}»: ${e.message}`); } });
    const labels = uniqueLabels(files.map((f, i) => (f.label || "").trim().slice(0, 60) || MolGC.suggestLabel(geos[i], f.name)));
    const res = MolGC.compareGeometries(geos, labels, ref_index, options);
    res.files = files.map((f) => base(f.name));
    res.elapsed_s = +((performance.now() - t0) / 1000).toFixed(3);
    return res;
  },

  studyScan: async ({ source }) => {
    const st = await loadStudy(source);
    return scanSummary(st.entries);
  },

  studyRun: async ({ source, reference, options }) => {
    const t0 = performance.now();
    const st = await loadStudy(source);
    await st.read();
    const parsed = [], errors = [];
    for (const e of st.entries) {
      try { parsed.push({ ...e, geometry: readOne({ text: e.text, name: e.member }) }); } catch (err) { errors.push(`${e.member}: ${err.message}`); }
      e.text = null;
    }
    const res = MolGC.runStudy(parsed, reference, options);
    res.warnings = errors.concat(res.warnings);
    res.summary = scanSummary(st.entries);
    res.elapsed_s = +((performance.now() - t0) / 1000).toFixed(2);
    return res;
  },
};

root.MolGCHandlers = handlers;
})(typeof self !== "undefined" ? self : this);
