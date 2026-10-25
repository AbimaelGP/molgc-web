"""Uso por línea de comandos:

    python -m molgc referencia.log evaluada.castep [otra.xyz ...] [--spatial] [--xlsx salida.xlsx]

La primera geometría es la referencia.
"""
import argparse
import sys

from . import Options, compare_geometries, read_geometry_file
from .export import comparison_workbook


def main(argv=None):
    p = argparse.ArgumentParser(prog="molgc", description="MolGC: MAE de longitudes de enlace frente a una referencia.")
    p.add_argument("files", nargs="+", help="geometrías (la primera es la referencia)")
    p.add_argument("--spatial", action="store_true", help="emparejamiento por correspondencia atómica")
    p.add_argument("--strict", action="store_true", help="sólo la tabla de enlaces de MolGC (idéntico al artículo)")
    p.add_argument("--xlsx", help="guardar resultados en Excel")
    a = p.parse_args(argv)
    if len(a.files) < 2:
        p.error("se necesitan al menos dos geometrías")
    geos = [read_geometry_file(f) for f in a.files]
    labels = [f"{g.functional or g.source_name} ({g.software})" for g in geos]
    seen = {}
    for i, l in enumerate(labels):
        seen[l] = seen.get(l, 0) + 1
        if seen[l] > 1:
            labels[i] = f"{l} #{seen[l]}"
    opt = Options(bond_mode="molgc_strict" if a.strict else "molgc", matching="spatial" if a.spatial else "molgc")
    res = compare_geometries(geos, labels, 0, opt)
    print(f"Referencia: {labels[0]}  ({res['reference']['formula']}, {res['reference']['n_bonds']} enlaces)")
    print(f"{'Geometría':32s} {'MAE (Å)':>10s} {'MAPE (%)':>9s} {'RMSD ICP':>9s} {'enlaces':>8s}")
    for r in res["results"]:
        print(f"{r['label'][:32]:32s} {r['MAE']:10.6f} {r['MAPE']:9.4f} {r['RMSD_ICP']:9.5f} {r['n_matched']:>4d}/{res['reference']['n_bonds']}")
    for w in res["warnings"]:
        print("Aviso:", w, file=sys.stderr)
    if a.xlsx:
        with open(a.xlsx, "wb") as fh:
            fh.write(comparison_workbook(res))
        print("Excel guardado en", a.xlsx)


if __name__ == "__main__":
    main()
