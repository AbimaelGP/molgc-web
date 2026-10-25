"""Genera tests/data/python_reference.json con los resultados de la implementación Python,
usados por tools/validate_js.mjs para comprobar que el motor JavaScript da lo mismo."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from molgc import read_geometry_file, compare_geometries, Options

ROOT = sys.argv[1]   # carpeta Molecules (p. ej. docs/data/demo/Molecules)
out = {}
for fam in sorted(os.listdir(ROOT)):
    for mol in sorted(os.listdir(os.path.join(ROOT, fam))):
        d = os.path.join(ROOT, fam, mol)
        files, labels = [], []
        for sw in sorted(os.listdir(d)):
            for fn in sorted(os.listdir(os.path.join(d, sw))):
                for f in sorted(os.listdir(os.path.join(d, sw, fn))):
                    files.append(f"{fam}/{mol}/{sw}/{fn}/{f[:-4] if f.endswith('.txt') else f}")
                    labels.append(f"{fn} ({sw})")
        def rd(p):
            full = os.path.join(ROOT, p)
            if not os.path.exists(full):
                full += ".txt"
            g = read_geometry_file(full)
            return g
        geos = [rd(p) for p in files]
        ref = next(i for i, l in enumerate(labels) if l.startswith("M06"))
        entry = {"files": files, "labels": labels, "ref": ref, "modes": {}}
        for mode in ("molgc", "spatial"):
            for bm in ("molgc", "molgc_strict"):
                if mode == "spatial" and bm == "molgc_strict":
                    continue
                res = compare_geometries(geos, labels, ref, Options(matching=mode, bond_mode=bm), include_structures=False)
                entry["modes"][f"{mode}/{bm}"] = {
                    "results": [{k: r[k] for k in ("label", "MAE", "MAPE", "max_abs_error", "RMSD_ICP", "RMSD_matched",
                                                   "n_bonds", "n_matched", "label_check", "pairs")} for r in res["results"]],
                    "bonds": [{k: b[k] for k in ("B", "pair", "ref", "descriptor", "i", "j")} for b in res["bonds"]],
                }
        out[f"{fam}/{mol}"] = entry
json.dump(out, open(sys.argv[2], "w"))
print("ok", len(out))
