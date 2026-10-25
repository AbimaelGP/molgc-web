"""
Núcleo del algoritmo MolGC (Camarillo-Cisneros et al., Molecular Diversity, 2024,
doi:10.1007/s11030-024-10945-2).

Reimplementación limpia y vectorizada del código original (transformaciones_m.py,
kabsch_algorithm.py y Function_*.py). Cada paso conserva la lógica del original para que los
resultados sean reproducibles (validado contra el código original con el conjunto de antibióticos
del artículo; ver tests/test_validation.py):

  1. Orientación canónica con matrices homogéneas 4x4 (traslación + rotaciones Z e Y).
  2. Refinamiento ICP + Kabsch con pesos de Huber y 8 combinaciones de reflexión.
  3. Detección de enlaces con la tabla de distancias de MolGC.
  4. Descriptor de cadena S_uv (primer y segundo nivel de conexión).
  5. Descriptor espacial SD_uv (coordenadas esféricas) para desempatar descriptores repetidos.
  6. Ordenamiento (S_uv, SD_uv) -> número de etiqueta B de cada enlace.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

from .bonds import DEFAULT_COVALENT_FACTOR, detect_bonds


# ======================================================================================
# 1. Orientación canónica (transformaciones_m.transformacionpuntos)
# ======================================================================================
def _metric(P: np.ndarray, q: np.ndarray) -> np.ndarray:
    # El código original usa sqrt(|dx|+|dy|+|dz|) como medida de cercanía; se conserva.
    return np.sqrt(np.abs(P - q).sum(axis=-1))


def _rot_z_row(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def _rot_y_row(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def _safe_atan(num: float, den: float) -> float:
    with np.errstate(divide="ignore", invalid="ignore"):
        v = np.arctan(num / den)
    return 0.0 if not np.isfinite(v) else float(v)


def canonical_orientation(symbols: List[str], coords: np.ndarray) -> np.ndarray:
    """Traslada y rota la molécula a un marco de referencia reproducible.

    a) átomo de referencia *a*: el más cercano al centro geométrico dentro del elemento menos
       frecuente (desempate alfabético);  b) traslación de *a* al origen;  c) rotación sobre Z
       para llevar al vecino *q* al plano XZ;  d) rotación sobre Y.
    Las rotaciones se aplican como vector fila  p' = p · M  igual que con las matrices 4x4.
    """
    X = np.asarray(coords, float).copy()
    sym = np.asarray(symbols)
    elems = list(dict.fromkeys(symbols))            # orden de aparición (pandas.unique)
    idx_by_el = {el: np.flatnonzero(sym == el) for el in elems}

    # (a) átomo de referencia
    center = X.mean(axis=0)
    rows = []
    for el in elems:
        ids = idx_by_el[el]
        d = _metric(X[ids], center)
        k = int(np.argmin(d))
        rows.append((len(ids), el, int(ids[k]), float(d[k])))
    rows.sort(key=lambda r: (r[0], r[1]))
    ind = rows[0][2]

    # (b) traslación
    X = X - X[ind]
    if len(elems) < 2:
        return X

    # (c) rotación sobre Z
    rows = []
    for el in elems:
        ids = idx_by_el[el]
        d = _metric(X[ids], X[ind])
        k = int(np.argmin(d))
        rows.append((len(ids), el, int(ids[k]), float(d[k]), float(X[ids[k], 0] - X[ind, 0])))
    rows.sort(key=lambda r: r[3])
    ind2, dx2 = rows[1][2], rows[1][4]
    ang = _safe_atan(X[ind2, 1], X[ind2, 0])
    if dx2 < 0:
        ang += np.pi
    X = X @ _rot_z_row(ang)

    # (d) rotación sobre Y
    rows = []
    for el in elems:
        ids = idx_by_el[el]
        d = _metric(X[ids], X[ind2])
        k = int(np.argmin(d))
        rows.append((len(ids), el, int(ids[k]), float(d[k])))
    rows.sort(key=lambda r: r[3])
    ind3 = rows[-1][2]
    ang = _safe_atan(X[ind3, 2], X[ind3, 0])
    X = X @ _rot_y_row(ang)
    return X


# ======================================================================================
# 2. ICP + Kabsch con pesos de Huber (kabsch_algorithm.align_molecules)
# ======================================================================================
_REFLECTIONS = [(False, False, False), (True, False, False), (False, True, False), (False, False, True),
                (True, True, False), (True, False, True), (False, True, True), (True, True, True)]


def icp_kabsch(target: np.ndarray, source: np.ndarray, max_iterations: int = 200,
               tolerance: float = 1e-10, delta: float = 1.0) -> Tuple[np.ndarray, float]:
    """Alinea `source` sobre `target`. Devuelve (source alineado, RMSD mínimo ICP)."""
    tree = cKDTree(target)
    best, min_rmsd = None, np.inf
    for refl in _REFLECTIONS:
        src = source * np.where(refl, -1.0, 1.0)
        prev_error = np.inf
        for _ in range(max_iterations):
            dist, idx = tree.query(src)
            tgt = target[idx]
            w = np.where(np.abs(dist) <= delta, 1.0, delta / np.where(dist == 0, 1, np.abs(dist)))[:, None]
            ws, wt = src * w, tgt * w
            sc, tc = ws.mean(axis=0), wt.mean(axis=0)
            C = (ws - sc).T @ (wt - tc)
            V, _, W = np.linalg.svd(C)
            R = V @ W
            src = (src - sc) @ R + tc
            mean_error = float(dist.mean())
            if abs(prev_error - mean_error) < tolerance:
                break
            prev_error = mean_error
            rmsd = float(np.sqrt(np.mean(np.sum((src - tgt) ** 2, axis=1))))
            if rmsd < min_rmsd:
                min_rmsd, best = rmsd, src
    if best is None:
        best, min_rmsd = source.copy(), float("nan")
    return best, float(min_rmsd)


# ======================================================================================
# 3-6. Enlaces, descriptores y etiquetado
# ======================================================================================
@dataclass
class Bond:
    i: int
    j: int
    el1: str
    el2: str
    length: float
    descriptor: str
    spatial: float = 0.0
    mid: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    label: int = -1

    @property
    def pair(self) -> str:
        return "–".join(sorted((self.el1, self.el2)))


@dataclass
class ProcessedGeometry:
    symbols: List[str]
    coords: np.ndarray            # coordenadas en el marco de la referencia (alineadas)
    bonds: List[Bond]             # ordenadas por etiqueta B
    rmsd_icp: float
    neighbors: List[List[int]] = field(default_factory=list)
    input_coords: Optional[np.ndarray] = None   # coordenadas originales (sin reflexiones)


def _cart2sp(v: np.ndarray) -> Tuple[float, float, float]:
    r = float(np.linalg.norm(v))
    theta = float(np.arcsin(v[2] / r)) if r > 0 else 0.0
    phi = float(np.arctan2(v[1], v[0]))
    return r, theta, phi


def string_descriptors(symbols: List[str], bonds: List[Tuple[int, int]]) -> Tuple[List[str], List[List[int]]]:
    """Descriptor de cadena S_uv = S1_uv + 'x' + S2_uv (ecs. 24-31 del artículo)."""
    n = len(symbols)
    nb: List[List[int]] = [[] for _ in range(n)]
    for i, j in bonds:
        nb[i].append(j)
        nb[j].append(i)
    # "bolsa de enlaces" de cada átomo: el átomo seguido de sus vecinos
    bag = [[symbols[a]] + [symbols[k] for k in nb[a]] for a in range(n)]
    out = []
    for i, j in bonds:
        s_i = "-".join(sorted(bag[i]))
        s_j = "-".join(sorted(bag[j]))
        s1 = "-".join(sorted([s_i, s_j]))
        second = ["".join(sorted(bag[k])) for k in nb[i]] + ["".join(sorted(bag[k])) for k in nb[j]]
        s2 = ".".join(sorted(second))
        out.append(s1 + "x" + s2)
    return out, nb


def label_bonds(symbols: List[str], coords: np.ndarray, bond_mode: str = "molgc",
                factor: float = DEFAULT_COVALENT_FACTOR) -> Tuple[List[Bond], List[List[int]]]:
    pairs = detect_bonds(symbols, coords, bond_mode, factor)
    if not pairs:
        return [], [[] for _ in symbols]
    desc, nb = string_descriptors(symbols, pairs)
    counts: Dict[str, int] = {}
    for d in desc:
        counts[d] = counts.get(d, 0) + 1
    bonds = []
    for (i, j), d in zip(pairs, desc):
        v = coords[j] - coords[i]
        sp = sum(_cart2sp(v)) if counts[d] > 1 else 0.0
        bonds.append(Bond(i, j, symbols[i], symbols[j], float(np.linalg.norm(v)), d, sp,
                          tuple(((coords[i] + coords[j]) / 2).tolist())))
    bonds.sort(key=lambda b: (b.descriptor, b.spatial))      # orden estable como pandas
    for k, b in enumerate(bonds):
        b.label = k
    return bonds, nb


def process_geometry(symbols: List[str], coords: np.ndarray, ref_oriented: Optional[np.ndarray] = None,
                     bond_mode: str = "molgc", factor: float = DEFAULT_COVALENT_FACTOR) -> ProcessedGeometry:
    """Orienta, alinea con la referencia (ya orientada) y etiqueta los enlaces de una geometría."""
    oriented = canonical_orientation(symbols, coords)
    if ref_oriented is None:
        ref_oriented = oriented
    aligned, rmsd = icp_kabsch(ref_oriented, oriented)
    bonds, nb = label_bonds(symbols, aligned, bond_mode, factor)
    return ProcessedGeometry(list(symbols), aligned, bonds, rmsd, nb, np.asarray(coords, float).copy())


# ======================================================================================
# Correspondencia entre geometrías
# ======================================================================================
def _hungarian_by_element(ref_xyz, tgt_xyz, groups):
    m = np.full(len(ref_xyz), -1)
    for ri, ti in groups:
        cost = np.linalg.norm(ref_xyz[ri][:, None, :] - tgt_xyz[ti][None, :, :], axis=-1)
        a, b = linear_sum_assignment(cost)
        m[ri[a]] = ti[b]
    return m


def _superpose(P, Q, allow_reflection=True):
    """Transformación óptima (R, t) que lleva P sobre Q (filas correspondientes)."""
    pc, qc = P.mean(0), Q.mean(0)
    H = (P - pc).T @ (Q - qc)
    U, S, Vt = np.linalg.svd(H)
    R = U @ Vt
    if not allow_reflection and np.linalg.det(R) < 0:
        U[:, -1] *= -1
        R = U @ Vt
    return R, qc - pc @ R


def atom_mapping(ref: ProcessedGeometry, tgt: ProcessedGeometry) -> Optional[np.ndarray]:
    """Mapeo átomo-a-átomo ref -> tgt (sólo para verificación y emparejamiento espacial).

    1) Átomos del "esqueleto" (grado >= 2): asignación húngara por elemento + superposición de
       Kabsch, iterada desde la alineación ICP de MolGC y desde 8 alineaciones por ejes principales.
    2) Átomos terminales (H, F, O carbonílico...): se asignan entre los terminales del átomo padre ya
       mapeado, lo que mantiene la consistencia con la conectividad (p. ej. hidrógenos de metilos).
    Devuelve None si la composición química difiere."""
    if sorted(ref.symbols) != sorted(tgt.symbols):
        return None
    n = len(ref.symbols)
    rs, ts = np.asarray(ref.symbols), np.asarray(tgt.symbols)
    deg_r = np.array([len(x) for x in ref.neighbors]) if ref.neighbors else np.zeros(n, int)
    deg_t = np.array([len(x) for x in tgt.neighbors]) if tgt.neighbors else np.zeros(n, int)
    core_r, core_t = np.flatnonzero(deg_r != 1), np.flatnonzero(deg_t != 1)
    use_core = (len(core_r) >= 3 and sorted(rs[core_r]) == sorted(ts[core_t]))
    if not use_core:
        core_r, core_t = np.arange(n), np.arange(n)

    Q = ref.coords - ref.coords[core_r].mean(0)
    P0 = tgt.coords - tgt.coords[core_t].mean(0)
    groups = []
    for el in sorted(set(rs[core_r])):
        groups.append((core_r[rs[core_r] == el], core_t[ts[core_t] == el]))

    def axes(X):
        w, v = np.linalg.eigh(X.T @ X)
        return v[:, ::-1]

    starts = [P0]
    Aq, Ap = axes(Q[core_r]), axes(P0[core_t])
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                starts.append(P0 @ (Ap * np.array([sx, sy, sz])) @ Aq.T)
    best_m, best_r, best_X = None, np.inf, None
    for X in starts:
        m = None
        for _ in range(25):
            new_m = _hungarian_by_element(Q, X, groups)
            if m is not None and np.array_equal(new_m[core_r], m[core_r]):
                break
            m = new_m
            R, t = _superpose(X[m[core_r]], Q[core_r])
            X = X @ R + t
        r = float(np.sqrt(((X[m[core_r]] - Q[core_r]) ** 2).sum(1).mean()))
        if r < best_r - 1e-9:
            best_r, best_m, best_X = r, m, X
    m, X = best_m, best_X
    if not use_core:
        return m

    # 2) terminales por átomo padre
    used = set(int(v) for v in m[core_r])
    for a in core_r:
        tr = [k for k in ref.neighbors[a] if deg_r[k] == 1 and m[k] < 0]
        if not tr:
            continue
        tt = [k for k in tgt.neighbors[int(m[a])] if deg_t[k] == 1 and k not in used]
        for el in set(rs[tr]):
            ri = np.array([k for k in tr if rs[k] == el])
            ti = np.array([k for k in tt if ts[k] == el])
            if len(ti) == 0:
                continue
            cost = np.linalg.norm(Q[ri][:, None, :] - X[ti][None, :, :], axis=-1)
            aa, bb = linear_sum_assignment(cost)
            for x, y in zip(aa, bb):
                m[ri[x]] = ti[y]
                used.add(int(ti[y]))
    # 3) cualquier átomo restante: húngaro global por elemento
    rest_r = np.flatnonzero(m < 0)
    if len(rest_r):
        rest_t = np.array([k for k in range(n) if k not in used])
        for el in set(rs[rest_r]):
            ri = rest_r[rs[rest_r] == el]
            ti = rest_t[ts[rest_t] == el]
            cost = np.linalg.norm(Q[ri][:, None, :] - X[ti][None, :, :], axis=-1)
            aa, bb = linear_sum_assignment(cost)
            m[ri[aa]] = ti[bb]
    return m


def rmsd_matched(ref: ProcessedGeometry, tgt: ProcessedGeometry, mapping: Optional[np.ndarray]) -> Optional[float]:
    """RMSD con correspondencia atómica explícita y superposición óptima de Kabsch (rotación propia)."""
    if mapping is None:
        return None
    src = tgt.input_coords if tgt.input_coords is not None else tgt.coords
    dst = ref.input_coords if ref.input_coords is not None else ref.coords
    P = src[mapping]
    R, t = _superpose(P, dst, allow_reflection=False)
    diff = P @ R + t - dst
    return float(np.sqrt((diff ** 2).sum(1).mean()))


def match_bonds(ref: ProcessedGeometry, tgt: ProcessedGeometry, method: str = "molgc",
                mapping: Optional[np.ndarray] = None) -> Dict:
    """Empareja enlaces de `tgt` con los de `ref`.

    method='molgc'   -> criterio del artículo: el enlace con etiqueta B en tgt corresponde al
                        enlace con la misma etiqueta B en ref (requiere el mismo número de enlaces).
    method='spatial' -> extensión robusta: el enlace (u, v) de la referencia corresponde al enlace
                        (m(u), m(v)) de la geometría evaluada, donde m es el mapeo átomo-a-átomo
                        (húngaro + Kabsch). Si la composición difiere, se agrupa por descriptor S_uv
                        y se empareja por cercanía de puntos medios. Tolera enlaces faltantes/sobrantes.
    """
    pairs: List[Tuple[int, Optional[int]]] = []
    unmatched_tgt: List[int] = []
    note = None
    if method == "molgc" and len(ref.bonds) == len(tgt.bonds):
        pairs = [(k, k) for k in range(len(ref.bonds))]
    elif method == "spatial" and mapping is not None:
        index = {frozenset((b.i, b.j)): k for k, b in enumerate(tgt.bonds)}
        used = set()
        for k, b in enumerate(ref.bonds):
            tk = index.get(frozenset((int(mapping[b.i]), int(mapping[b.j]))))
            pairs.append((k, tk))
            if tk is not None:
                used.add(tk)
        unmatched_tgt = [k for k in range(len(tgt.bonds)) if k not in used]
    else:
        if method == "molgc":
            note = ("El número de enlaces difiere ({} vs {}); se usó el emparejamiento espacial por "
                    "descriptor.".format(len(ref.bonds), len(tgt.bonds)))
        groups_r: Dict[str, List[int]] = {}
        groups_t: Dict[str, List[int]] = {}
        for k, b in enumerate(ref.bonds):
            groups_r.setdefault(b.descriptor, []).append(k)
        for k, b in enumerate(tgt.bonds):
            groups_t.setdefault(b.descriptor, []).append(k)
        used_t = set()
        leftover_r = []
        for d, rk in groups_r.items():
            tk = groups_t.get(d, [])
            if not tk:
                leftover_r.extend(rk)
                continue
            cost = np.array([[np.linalg.norm(np.subtract(ref.bonds[a].mid, tgt.bonds[b].mid)) for b in tk] for a in rk])
            ra, cb = linear_sum_assignment(cost)
            got = set()
            for a, b in zip(ra, cb):
                pairs.append((rk[a], tk[b]))
                used_t.add(tk[b])
                got.add(rk[a])
            leftover_r.extend(k for k in rk if k not in got)
        # Segundo pase: enlaces con descriptor distinto (p. ej. un vecino cambió) -> mismo par de
        # elementos y punto medio cercano (< 0.6 Å)
        rest_t = [k for k in range(len(tgt.bonds)) if k not in used_t]
        if leftover_r and rest_t:
            cost = np.full((len(leftover_r), len(rest_t)), 1e6)
            for a, rk_ in enumerate(leftover_r):
                for b, tk_ in enumerate(rest_t):
                    if ref.bonds[rk_].pair == tgt.bonds[tk_].pair:
                        cost[a, b] = np.linalg.norm(np.subtract(ref.bonds[rk_].mid, tgt.bonds[tk_].mid))
            ra, cb = linear_sum_assignment(cost)
            still = set(leftover_r)
            for a, b in zip(ra, cb):
                if cost[a, b] < 0.6:
                    pairs.append((leftover_r[a], rest_t[b]))
                    used_t.add(rest_t[b])
                    still.discard(leftover_r[a])
            leftover_r = sorted(still)
        pairs.extend((k, None) for k in leftover_r)
        pairs.sort(key=lambda p: p[0])
        unmatched_tgt = [k for k in range(len(tgt.bonds)) if k not in used_t]
    return {"pairs": pairs, "unmatched_tgt": unmatched_tgt, "note": note}


def verify_pairs(ref: ProcessedGeometry, tgt: ProcessedGeometry, pairs, mapping) -> List[Dict]:
    """Para cada par (ref, tgt) indica si coinciden el par de elementos, el descriptor y los átomos
    (según el mapeo húngaro)."""
    out = []
    for rk, tk in pairs:
        if tk is None:
            out.append({"elements": False, "descriptor": False, "atoms": None})
            continue
        rb, tb = ref.bonds[rk], tgt.bonds[tk]
        atoms = None
        if mapping is not None:
            atoms = {int(mapping[rb.i]), int(mapping[rb.j])} == {tb.i, tb.j}
        out.append({"elements": rb.pair == tb.pair, "descriptor": rb.descriptor == tb.descriptor, "atoms": atoms})
    return out
