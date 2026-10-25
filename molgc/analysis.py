"""
Análisis de alto nivel de MolGC:

* compare_geometries  -> N geometrías de una misma molécula contra una referencia
                         (el caso N = 2 es la comparación directa molécula vs molécula).
* run_study           -> estudio completo Familia/Molécula/Software/Funcional (como Main1.py),
                         con promedios por familia y análisis UW-TOPSIS.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from .bonds import DEFAULT_COVALENT_FACTOR
from .core import (ProcessedGeometry, atom_mapping, canonical_orientation, match_bonds, process_geometry,
                   rmsd_matched, verify_pairs)
from .parsers import Geometry


@dataclass
class Options:
    bond_mode: str = "molgc"          # 'molgc' | 'molgc_strict' | 'covalent'
    covalent_factor: float = DEFAULT_COVALENT_FACTOR
    matching: str = "molgc"           # 'molgc' | 'spatial'

    @classmethod
    def from_dict(cls, d: Optional[Dict]) -> "Options":
        d = d or {}
        o = cls()
        if d.get("bond_mode") in ("molgc", "molgc_strict", "covalent"):
            o.bond_mode = d["bond_mode"]
        try:
            f = float(d.get("covalent_factor", o.covalent_factor))
            if 1.0 <= f <= 1.6:
                o.covalent_factor = f
        except (TypeError, ValueError):
            pass
        if d.get("matching") in ("molgc", "spatial"):
            o.matching = d["matching"]
        return o


def _r(x, n=6):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), n)


def compare_geometries(geos: List[Geometry], labels: List[str], ref_index: int,
                       options: Optional[Options] = None, include_structures: bool = True) -> Dict:
    """Compara todas las geometrías contra geos[ref_index]."""
    opt = options or Options()
    if len(geos) < 2:
        raise ValueError("Se necesitan al menos dos geometrías.")
    if not 0 <= ref_index < len(geos):
        raise ValueError("Índice de referencia inválido.")
    ref_geo = geos[ref_index]
    warnings: List[str] = []
    ref_oriented = canonical_orientation(ref_geo.symbols, ref_geo.coords)
    processed: List[ProcessedGeometry] = []
    for g in geos:
        processed.append(process_geometry(g.symbols, g.coords, ref_oriented, opt.bond_mode, opt.covalent_factor))
    ref = processed[ref_index]
    if not ref.bonds:
        raise ValueError("No se detectaron enlaces en la geometría de referencia.")

    # tabla base: un renglón por enlace de la referencia (etiqueta B)
    rows = [{"B": b.label, "atom1": b.el1, "atom2": b.el2, "i": b.i + 1, "j": b.j + 1, "pair": b.pair,
             "descriptor": b.descriptor, "ref": _r(b.length)} for b in ref.bonds]
    results = []
    for gi, (g, p) in enumerate(zip(geos, processed)):
        if gi == ref_index:
            continue
        lab = labels[gi]
        same_formula = sorted(g.symbols) == sorted(ref_geo.symbols)
        if not same_formula:
            warnings.append(f"«{lab}» tiene una composición química distinta a la referencia "
                            f"({g.formula} vs {ref_geo.formula}); la comparación puede no ser válida.")
        mapping = atom_mapping(ref, p)
        m = match_bonds(ref, p, opt.matching, mapping)
        if m["note"]:
            warnings.append(f"«{lab}»: {m['note']}")
        checks = verify_pairs(ref, p, m["pairs"], mapping)
        errs, rel = [], []
        per_pair: Dict[str, List[float]] = {}
        for (rk, tk), chk in zip(m["pairs"], checks):
            row = rows[rk]
            if tk is None:
                row[f"len::{lab}"] = None
                row[f"err::{lab}"] = None
                continue
            L, Lr = p.bonds[tk].length, ref.bonds[rk].length
            d = L - Lr
            row[f"len::{lab}"] = _r(L)
            row[f"err::{lab}"] = _r(d)
            row[f"chk::{lab}"] = chk
            errs.append(abs(d))
            rel.append(abs(d) / Lr)
            per_pair.setdefault(ref.bonds[rk].pair, []).append(abs(d))
        n_atoms_ok = [c["atoms"] for c in checks if c["atoms"] is not None]
        n_elem_ok = sum(1 for c in checks if c["elements"])
        matched = len(errs)
        res = {
            "label": lab,
            "software": g.software,
            "functional": g.functional,
            "n_atoms": g.natoms,
            "formula": g.formula,
            "n_bonds": len(p.bonds),
            "n_matched": matched,
            "n_unmatched_ref": len(ref.bonds) - matched,
            "n_unmatched_tgt": len(m["unmatched_tgt"]),
            "MAE": _r(np.mean(errs)) if errs else None,
            "MAPE": _r(100 * np.mean(rel), 5) if rel else None,
            "max_abs_error": _r(np.max(errs)) if errs else None,
            "RMSE_bonds": _r(np.sqrt(np.mean(np.square(errs)))) if errs else None,
            "RMSD_ICP": _r(p.rmsd_icp),
            "RMSD_matched": _r(rmsd_matched(ref, p, mapping)),
            "label_check": {
                "elements_ok": n_elem_ok,
                "atoms_ok": int(sum(n_atoms_ok)) if n_atoms_ok else None,
                "atoms_checked": len(n_atoms_ok),
                "total": len(checks),
            },
            "per_pair": {k: {"MAE": _r(np.mean(v)), "n": len(v)} for k, v in sorted(per_pair.items())},
            "pairs": [[int(a), None if b is None else int(b)] for a, b in m["pairs"]],
            "struct_index": gi,
            "warnings": list(g.warnings),
        }
        results.append(res)

    out = {
        "reference": {"label": labels[ref_index], "software": ref_geo.software, "functional": ref_geo.functional,
                      "n_atoms": ref_geo.natoms, "formula": ref_geo.formula, "n_bonds": len(ref.bonds),
                      "warnings": list(ref_geo.warnings)},
        "results": results,
        "bonds": rows,
        "labels": [labels[i] for i in range(len(geos)) if i != ref_index],
        "options": opt.__dict__,
        "warnings": warnings,
    }
    if include_structures:
        out["structures"] = [
            {"label": labels[i], "is_ref": i == ref_index, "symbols": p.symbols,
             "coords": np.round(p.coords, 5).tolist(), "bonds": [[b.i, b.j, b.label] for b in p.bonds]}
            for i, p in enumerate(processed)
        ]
    return out


# ======================================================================================
# UW-TOPSIS (TOPSIS_uw.py)
# ======================================================================================
def topsis_uw(alternatives: List[str], criteria: List[str], M: np.ndarray) -> List[Dict]:
    """TOPSIS sin pesos. M[i, j] = MAE de la alternativa i bajo el criterio j (menor es mejor)."""
    M = np.asarray(M, float)
    norm = M / np.sqrt((M ** 2).sum(axis=0))
    best, worst = norm.min(axis=0), norm.max(axis=0)
    d_best = np.sqrt(((norm - best) ** 2).sum(axis=1))
    d_worst = np.sqrt(((norm - worst) ** 2).sum(axis=1))
    with np.errstate(invalid="ignore", divide="ignore"):
        closeness = d_worst / (d_best + d_worst)            # 1 = ideal
    closeness = np.nan_to_num(closeness, nan=1.0)
    order = np.argsort(-closeness, kind="stable")
    rank = np.empty(len(order), int)
    rank[order] = np.arange(1, len(order) + 1)
    return [{"functional": alternatives[i], "d_ideal": _r(d_best[i]), "d_anti_ideal": _r(d_worst[i]),
             "closeness": _r(closeness[i]), "rank": int(rank[i]),
             "values": {c: _r(M[i, j]) for j, c in enumerate(criteria)}} for i in order]


# ======================================================================================
# Estudio completo
# ======================================================================================
def run_study(entries: List[Dict], reference_key: str, options: Optional[Options] = None) -> Dict:
    """entries: [{'family','molecule','software','functional','geometry': Geometry}, ...]
    reference_key: 'Funcional (Software)' usado como referencia en todas las moléculas."""
    opt = options or Options()
    by_mol: Dict[tuple, List[Dict]] = {}
    for e in entries:
        by_mol.setdefault((e["family"], e["molecule"]), []).append(e)
    molecules = []
    warnings: List[str] = []
    for (fam, mol), items in sorted(by_mol.items()):
        keys = [f"{e['functional']} ({e['software']})" for e in items]
        if reference_key not in keys:
            warnings.append(f"{fam}/{mol}: no contiene la referencia {reference_key}; se omitió.")
            continue
        if len(items) < 2:
            warnings.append(f"{fam}/{mol}: sólo tiene una geometría; se omitió.")
            continue
        try:
            res = compare_geometries([e["geometry"] for e in items], keys, keys.index(reference_key), opt,
                                     include_structures=False)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"{fam}/{mol}: {exc}")
            continue
        molecules.append({"family": fam, "molecule": mol, "result": res})
        warnings.extend(f"{fam}/{mol}: {w}" for w in res["warnings"])

    functionals = sorted({r["label"] for m in molecules for r in m["result"]["results"]})
    families = sorted({m["family"] for m in molecules})
    # MAE por molécula
    per_molecule = []
    for m in molecules:
        row = {"family": m["family"], "molecule": m["molecule"], "n_bonds": m["result"]["reference"]["n_bonds"]}
        for r in m["result"]["results"]:
            row[r["label"]] = r["MAE"]
            row[f"RMSD::{r['label']}"] = r["RMSD_ICP"]
        per_molecule.append(row)
    # promedio por familia
    fam_table = {}
    for fam in families:
        fam_table[fam] = {}
        for f in functionals:
            vals = [row[f] for row in per_molecule if row["family"] == fam and row.get(f) is not None]
            fam_table[fam][f] = _r(np.mean(vals)) if vals else None
    overall = {}
    for f in functionals:
        vals = [fam_table[fam][f] for fam in families if fam_table[fam][f] is not None]
        overall[f] = _r(np.mean(vals)) if vals else None
    # TOPSIS: alternativas = funcionales, criterios = familias (sólo funcionales completos)
    complete = [f for f in functionals if all(fam_table[fam][f] is not None for fam in families)]
    topsis = []
    if len(complete) >= 2 and families:
        M = np.array([[fam_table[fam][f] for fam in families] for f in complete])
        topsis = topsis_uw(complete, families, M)
    return {
        "reference": reference_key,
        "functionals": functionals,
        "families": families,
        "per_molecule": per_molecule,
        "family_mae": fam_table,
        "overall_mae": overall,
        "topsis": topsis,
        "molecules": [{"family": m["family"], "molecule": m["molecule"], "bonds": m["result"]["bonds"],
                       "results": m["result"]["results"], "labels": m["result"]["labels"],
                       "reference": m["result"]["reference"]} for m in molecules],
        "warnings": warnings,
        "options": opt.__dict__,
    }
