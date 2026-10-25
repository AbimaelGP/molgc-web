"""
Criterio de enlace de MolGC.

Un par de átomos u-v se considera enlazado si 0.0001 < d(u,v) <= Dist_A(u,v), donde Dist_A es la
distancia interatómica máxima tabulada en el artículo (Tabla de la Fig. 3 / TablaEnlacesElemento.py).

Extensión para uso general: los pares que no aparecen en la tabla original (S, P, Br, I, metales,
etc.) usan el criterio de radios covalentes  d <= f * (r_u + r_v)  con f = 1.25 por defecto.
Los pares H-H nunca se consideran enlace (igual que en el MolGC original).
"""
from __future__ import annotations

from typing import Dict, FrozenSet, List, Optional, Tuple

import numpy as np

from .elements import COVALENT_RADII

# Tabla original de MolGC (Å)
MOLGC_TABLE: Dict[FrozenSet[str], float] = {
    frozenset(("C", "O")): 1.97249,
    frozenset(("C",)): 1.89002,        # C-C
    frozenset(("C", "N")): 1.79202,
    frozenset(("C", "H")): 1.20000,
    frozenset(("C", "F")): 1.76002,
    frozenset(("O", "H")): 1.20000,
    frozenset(("H", "N")): 1.20000,
    frozenset(("N",)): 1.88260,        # N-N
    frozenset(("N", "O")): 1.81746,
    frozenset(("Cl", "C")): 2.11002,
}

DEFAULT_COVALENT_FACTOR = 1.25


def threshold(a: str, b: str, mode: str = "molgc", factor: float = DEFAULT_COVALENT_FACTOR) -> Optional[float]:
    """Distancia máxima de enlace para el par (a, b) o None si el par nunca enlaza."""
    if a == "H" and b == "H":
        return None
    if mode in ("molgc", "molgc_strict"):
        t = MOLGC_TABLE.get(frozenset((a, b)))
        if t is not None:
            return t
        if mode == "molgc_strict":
            return None
    ra, rb = COVALENT_RADII.get(a), COVALENT_RADII.get(b)
    if ra is None or rb is None:
        return None
    return factor * (ra + rb)


def is_bonded_pair(a: str, b: str, d: float, mode: str = "molgc", factor: float = DEFAULT_COVALENT_FACTOR) -> bool:
    t = threshold(a, b, mode, factor)
    return t is not None and 0.0001 < d <= t


def detect_bonds(symbols: List[str], coords: np.ndarray, mode: str = "molgc",
                 factor: float = DEFAULT_COVALENT_FACTOR) -> List[Tuple[int, int]]:
    """Lista de enlaces (i, j) con i < j, en el orden fila-mayor de la matriz de adyacencia
    (el mismo orden que produce np.where en el código original)."""
    n = len(symbols)
    D = np.sqrt(((coords[:, None, :] - coords[None, :, :]) ** 2).sum(-1))
    cache: Dict[Tuple[str, str], Optional[float]] = {}
    out = []
    for i in range(n):
        for j in range(i + 1, n):
            key = (symbols[i], symbols[j])
            if key not in cache:
                cache[key] = threshold(symbols[i], symbols[j], mode, factor)
            t = cache[key]
            if t is not None and 0.0001 < D[i, j] <= t:
                out.append((i, j))
    return out


def table_rows(mode: str = "molgc", factor: float = DEFAULT_COVALENT_FACTOR):
    """Filas de la tabla de umbrales para mostrar en la interfaz."""
    rows = []
    for k, v in MOLGC_TABLE.items():
        els = sorted(k) if len(k) == 2 else [next(iter(k))] * 2
        rows.append({"pair": "–".join(els), "dist": v, "source": "MolGC"})
    return rows
