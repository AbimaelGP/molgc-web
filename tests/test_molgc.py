"""Pruebas de MolGC Web.  Ejecutar:  pytest -q"""
import json
import os
import subprocess
import shutil

import numpy as np
import pytest

from molgc import Options, compare_geometries, read_geometry, run_study
from molgc.analysis import topsis_uw

HERE = os.path.dirname(__file__)
DEMO = os.path.join(HERE, "..", "docs", "data", "demo", "Molecules")
EXPECTED = json.load(open(os.path.join(HERE, "data", "original_molgc_ref_M06.json")))


def _read(path):
    with open(path, "rb") as fh:
        return read_geometry(fh.read(), os.path.basename(path)[:-4])   # quita ".txt"


def _molecule(fam, mol):
    geos, labels = [], []
    d = os.path.join(DEMO, fam, mol)
    for sw in sorted(os.listdir(d)):
        for fn in sorted(os.listdir(os.path.join(d, sw))):
            for f in sorted(os.listdir(os.path.join(d, sw, fn))):
                geos.append(_read(os.path.join(d, sw, fn, f)))
                labels.append(f"{fn}-{sw}")
    return geos, labels


@pytest.mark.parametrize("key", sorted(EXPECTED))
def test_reproduces_original_molgc(key):
    """MAE y RMSD idénticos al código original de MolGC (referencia M06)."""
    fam, mol = key.split("/")
    geos, labels = _molecule(fam, mol)
    ref = next(i for i, l in enumerate(labels) if l.startswith("M06-"))
    res = compare_geometries(geos, labels, ref, Options(bond_mode="molgc_strict", matching="molgc"),
                             include_structures=False)
    for r in res["results"]:
        exp = EXPECTED[key][r["label"]]
        assert r["MAE"] == pytest.approx(exp["MAE"], abs=1e-6)
        assert r["RMSD_ICP"] == pytest.approx(exp["rmsd"], abs=1e-4)
        assert r["n_bonds"] == exp["nb"]


def test_spatial_matching_verifies_all_atoms():
    geos, labels = _molecule("FLUOROQUINOLONES", "enoxacin")
    ref = next(i for i, l in enumerate(labels) if l.startswith("M06-"))
    res = compare_geometries(geos, labels, ref, Options(matching="spatial"), include_structures=False)
    for r in res["results"]:
        lc = r["label_check"]
        assert lc["atoms_ok"] == lc["atoms_checked"] == r["n_matched"]


XYZ_STD = """3
water functional=PBE
O 0.000 0.000 0.117
H 0.000 0.757 -0.467
H 0.000 -0.757 -0.467
"""
XYZ_BARE = "O      0.000 0.000 0.117\nH      0.000 0.760 -0.470\nH      0.000 -0.760 -0.470\n"
GEOMETRY_IN = """lattice_vector 10 0 0
lattice_vector 0 10 0
lattice_vector 0 0 10
atom 0.0 0.0 0.117 O
atom_frac 0.0 0.0757 -0.0467 H
atom 0.0 -0.757 -0.467 H
"""


def test_xyz_and_geometry_in():
    a = read_geometry(XYZ_STD, "a.xyz")
    b = read_geometry(XYZ_BARE, "b.xyz")
    c = read_geometry(GEOMETRY_IN, "geometry.in")
    assert a.symbols == b.symbols == c.symbols == ["O", "H", "H"]
    assert a.functional == "PBE"
    assert np.allclose(a.coords, c.coords)
    res = compare_geometries([a, b], ["A", "B"], 0, include_structures=False)
    r = res["results"][0]
    assert r["n_matched"] == 2
    expected = np.mean([abs(np.linalg.norm([0, .760, -.587]) - np.linalg.norm([0, .757, -.584]))] * 2)
    assert r["MAE"] == pytest.approx(expected, abs=1e-6)


def test_multiframe_xyz_uses_last_frame():
    g = read_geometry(XYZ_STD + XYZ_STD.replace("0.757", "0.800"), "traj.xyz")
    assert g.coords[1, 1] == pytest.approx(0.8)
    assert g.warnings


def test_bad_file_message():
    from molgc import ParseError
    with pytest.raises(ParseError):
        read_geometry("esto no es una geometría\n", "x.txt")


def test_topsis_matches_paper_example():
    alts = ["PBE+TS-Castep", "PBE-Castep", "B3LYP-Gaussian", "PBE1-FHI-aims", "LDA-Castep", "LDA+OBS-Castep"]
    M = np.array([[0.006178519, 0.005235332, 0.005261416], [0.006150367, 0.005634317, 0.005263038],
                  [0.006416727, 0.009229532, 0.005331778], [0.006388377, 0.010135666, 0.006399936],
                  [0.016914411, 0.017201978, 0.015499639], [0.017241172, 0.017506669, 0.015667556]])
    ranking = [r["functional"] for r in topsis_uw(alts, ["F", "N", "Q"], M)]
    assert ranking[0] == "PBE+TS-Castep" and ranking[-1] == "LDA+OBS-Castep"


def test_study_end_to_end():
    entries = []
    for root, _, files in os.walk(DEMO):
        for f in files:
            p = os.path.relpath(os.path.join(root, f), DEMO).split(os.sep)
            entries.append({"family": p[0], "molecule": p[1], "software": p[2], "functional": p[3],
                            "geometry": _read(os.path.join(root, f))})
    st = run_study(entries, "M06 (Gaussian)")
    assert len(st["per_molecule"]) == 13
    assert st["topsis"][0]["functional"] in ("PBE+TS (Castep)", "PBE (Castep)")


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js no disponible")
def test_javascript_engine_matches_python():
    """El motor del navegador (docs/engine/molgc.js) debe dar exactamente lo mismo que Python."""
    root = os.path.join(HERE, "..")
    r = subprocess.run(["node", "tools/validate_js.mjs", DEMO, "tests/data/python_reference.json"], cwd=root,
                       capture_output=True, text=True)
    print(r.stdout)
    assert r.returncode == 0, r.stdout + r.stderr
