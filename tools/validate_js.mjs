// Comprueba que el motor JavaScript (docs/engine/molgc.js) reproduce la implementación Python.
// Uso: node tools/validate_js.mjs <carpeta Molecules> [tests/data/python_reference.json]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MolGC = require("../docs/engine/molgc.js");

const ROOT = process.argv[2];
const REF = JSON.parse(fs.readFileSync(process.argv[3] || "tests/data/python_reference.json", "utf8"));
let worstMae = 0, worstRmsd = 0, worstLen = 0, pairDiff = 0, labelDiff = 0, n = 0;
const t0 = Date.now();
for (const [key, e] of Object.entries(REF)) {
  const geos = e.files.map((f) => MolGC.readGeometry(fs.readFileSync(fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(ROOT, f + ".txt"), "latin1"), f));
  for (const [mk, exp] of Object.entries(e.modes)) {
    const [matching, bond_mode] = mk.split("/");
    const res = MolGC.compareGeometries(geos, e.labels, e.ref, { matching, bond_mode }, false);
    res.bonds.forEach((b, k) => {
      worstLen = Math.max(worstLen, Math.abs(b.ref - exp.bonds[k].ref));
      if (b.descriptor !== exp.bonds[k].descriptor || b.i !== exp.bonds[k].i || b.j !== exp.bonds[k].j) labelDiff++;
    });
    res.results.forEach((r, k) => {
      const x = exp.results[k];
      n++;
      worstMae = Math.max(worstMae, Math.abs(r.MAE - x.MAE));
      worstRmsd = Math.max(worstRmsd, Math.abs(r.RMSD_ICP - x.RMSD_ICP));
      if (JSON.stringify(r.pairs) !== JSON.stringify(x.pairs)) { pairDiff++; console.log("pairs differ", key, mk, r.label); }
      if (JSON.stringify(r.label_check) !== JSON.stringify(x.label_check)) console.log("label_check differs", key, mk, r.label, r.label_check, x.label_check);
      if (Math.abs(r.MAE - x.MAE) > 1e-6) console.log("MAE", key, mk, r.label, r.MAE, x.MAE);
      if (Math.abs((r.RMSD_matched ?? 0) - (x.RMSD_matched ?? 0)) > 1e-5) console.log("RMSDm", key, mk, r.label, r.RMSD_matched, x.RMSD_matched);
    });
  }
}
console.log(`${n} comparaciones | máx ΔMAE ${worstMae.toExponential(2)} Å | máx ΔRMSD ${worstRmsd.toExponential(2)} Å | ` +
  `máx Δlongitud ${worstLen.toExponential(2)} Å | etiquetas distintas ${labelDiff} | emparejamientos distintos ${pairDiff} | ${(Date.now() - t0) / 1000}s`);
process.exit(worstMae < 2e-6 && pairDiff === 0 && labelDiff === 0 ? 0 : 1);
