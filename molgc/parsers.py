"""
Lectores de geometrías para MolGC.

Formatos soportados (detección automática por contenido, no sólo por extensión):

* Gaussian (.log / .out)  -> bloque de archivo final "1\\1\\GINC..." (geometría optimizada).
                             Respaldo: última "Standard/Input orientation".
* CASTEP (.castep)        -> "BFGS : Final Configuration" (coordenadas fraccionarias x red real).
                             Respaldo: último bloque "Cell Contents".
* FHI-aims (.out)         -> "Final atomic structure". Respaldo: última "Updated atomic structure"
                             o la geometría de entrada.
* FHI-aims geometry.in    -> líneas "atom" / "atom_frac" (+ "lattice_vector").
* XYZ (.xyz)              -> XYZ estándar (N / comentario / El x y z) o sólo líneas "El x y z"
                             (formato aceptado por el MolGC original). Si el archivo contiene
                             varios cuadros (trayectoria) se toma el último.

Todos los lectores devuelven un objeto :class:`Geometry`.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from .elements import normalize_symbol, SYMBOL_BY_Z


class ParseError(ValueError):
    """Error legible para el usuario al leer un archivo de geometría."""


@dataclass
class Geometry:
    symbols: List[str]
    coords: np.ndarray                     # (N, 3) en Å
    software: str = "XYZ"
    functional: Optional[str] = None       # funcional detectado en el archivo (si existe)
    basis: Optional[str] = None
    source_name: str = ""
    warnings: List[str] = field(default_factory=list)
    lattice: Optional[np.ndarray] = None   # (3, 3) si el cálculo es periódico

    @property
    def natoms(self) -> int:
        return len(self.symbols)

    @property
    def formula(self) -> str:
        from collections import Counter
        c = Counter(self.symbols)
        order = (["C", "H"] if "C" in c else []) + sorted(k for k in c if k not in ("C", "H") or "C" not in c)
        return "".join(f"{el}{c[el] if c[el] > 1 else ''}" for el in order)

    def to_xyz(self, comment: str = "") -> str:
        lines = [str(self.natoms), comment or self.source_name]
        for s, (x, y, z) in zip(self.symbols, self.coords):
            lines.append(f"{s:<3s}{x:16.8f}{y:16.8f}{z:16.8f}")
        return "\n".join(lines) + "\n"


_FLOAT = r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[EeDd][-+]?\d+)?"


def _f(s: str) -> float:
    return float(s.replace("D", "E").replace("d", "e"))


def _decode(data: bytes | str) -> str:
    if isinstance(data, str):
        return data
    for enc in ("utf-8", "iso8859_15", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


# --------------------------------------------------------------------------------------
# Detección de formato
# --------------------------------------------------------------------------------------
def detect_format(text: str, filename: str = "") -> str:
    name = filename.lower()
    head = text[:20000]
    if "Entering Gaussian System" in head or "Gaussian, Inc." in head or "\\GINC-" in text[-200000:]:
        return "gaussian"
    if "Invoking FHI-aims" in head or "FHI-aims version" in head:
        return "fhiaims"
    if "CCC   AA    SSS  TTTTT  EEEEE  PPPP" in head or "CASTEP version" in head or name.endswith(".castep") \
            or "Final Configuration" in text and "Fractional coordinates of atoms" in text:
        return "castep"
    if re.search(r"^\s*atom(_frac)?\s+" + _FLOAT, text, re.M):
        return "fhiaims_in"
    if name.endswith(".xyz") or _looks_like_xyz(text):
        return "xyz"
    raise ParseError(
        "No se reconoció el formato del archivo. Formatos soportados: Gaussian (.log), CASTEP (.castep), "
        "FHI-aims (.out / geometry.in) y XYZ (.xyz)."
    )


def _looks_like_xyz(text: str) -> bool:
    pat = re.compile(r"^\s*([A-Za-z]{1,3}|\d{1,3})\s+" + r"\s+".join([_FLOAT] * 3) + r"\s*$")
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return False
    hits = sum(1 for l in lines[:200] if pat.match(l))
    return hits >= max(2, 0.6 * min(len(lines), 200) - 2)


# --------------------------------------------------------------------------------------
# Gaussian
# --------------------------------------------------------------------------------------
def _gaussian_archive(text: str):
    """Devuelve el último bloque de archivo (archive entry) como cadena continua."""
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if l.lstrip().startswith("1\\1\\")]
    if not starts:
        return None
    i = starts[-1]
    buf = []
    for l in lines[i:i + 400]:
        buf.append(l[1:] if l.startswith(" ") else l)
        if "\\\\@" in "".join(buf[-2:]):
            break
    return "".join(buf)


def parse_gaussian(text: str, name: str = "") -> Geometry:
    warnings: List[str] = []
    symbols: List[str] = []
    coords: List[List[float]] = []
    functional = basis = None
    arch = _gaussian_archive(text)
    if arch:
        sections = arch.split("\\\\")
        head = sections[0].split("\\")
        if len(head) > 5:
            method = head[4]
            if method.upper().startswith("RO") and len(method) > 3:
                method = method[2:]
            elif method[:1].upper() in ("R", "U") and len(method) > 2:
                method = method[1:]
            functional, basis = method, head[5]
            if "opt" not in head[3].lower():
                warnings.append("El cálculo de Gaussian no es una optimización de geometría (p. ej. punto simple).")
        if len(sections) > 3:
            geo = sections[3].split("\\")
            for atom in geo[1:]:          # geo[0] = carga,multiplicidad
                parts = atom.split(",")
                if len(parts) < 4:
                    continue
                try:
                    xyz = [_f(p) for p in parts[-3:]]
                except ValueError:
                    continue
                symbols.append(normalize_symbol(parts[0]))
                coords.append(xyz)
    if not symbols:
        # Respaldo: última orientación estándar / de entrada
        blocks = list(re.finditer(r"(Standard|Input) orientation:.*?-{5,}\n.*?-{5,}\n(.*?)\n\s*-{5,}", text, re.S))
        if not blocks:
            raise ParseError("No se encontraron coordenadas en el archivo de Gaussian.")
        for row in blocks[-1].group(2).splitlines():
            p = row.split()
            if len(p) >= 6:
                symbols.append(SYMBOL_BY_Z.get(int(p[1]), "X"))
                coords.append([_f(p[3]), _f(p[4]), _f(p[5])])
        warnings.append("No se encontró el bloque de archivo final (1\\1\\GINC); se usó la última "
                        "orientación impresa. Verifique que la optimización haya terminado.")
    if functional is None:
        m = re.search(r"^\s*#\S*\s*(?:opt\S*\s+)?([A-Za-z0-9+\-()]+)/(\S+)", text, re.M | re.I)
        if m:
            functional, basis = m.group(1), m.group(2)
    return Geometry(symbols, np.array(coords, float), "Gaussian", _clean_functional(functional), basis, name, warnings)


# --------------------------------------------------------------------------------------
# CASTEP
# --------------------------------------------------------------------------------------
_CASTEP_XC = {
    "local density approximation": "LDA",
    "perdew burke ernzerhof": "PBE",
    "perdew wang (1991)": "PW91",
    "pbe for solids (2008)": "PBEsol",
    "revised perdew burke ernzerhof": "RPBE",
    "wu-cohen": "WC",
    "hartree-fock": "HF",
    "hse06": "HSE06",
    "b3lyp": "B3LYP",
}


def parse_castep(text: str, name: str = "") -> Geometry:
    warnings: List[str] = []
    lines = text.splitlines()
    idx_final = [i for i, l in enumerate(lines) if "Final Configuration" in l]
    idx_cells = [i for i, l in enumerate(lines) if "Cell Contents" in l]
    if idx_final:
        start = idx_final[-1]
    elif idx_cells:
        start = idx_cells[-1]
        warnings.append("No se encontró 'BFGS : Final Configuration'; se usó el último bloque "
                        "'Cell Contents' (la optimización podría no haber convergido).")
    else:
        raise ParseError("No se encontraron coordenadas en el archivo CASTEP.")

    # red real: la última impresa antes del bloque elegido
    lat = None
    for i in range(start, -1, -1):
        if "Real Lattice" in lines[i]:
            try:
                lat = np.array([[_f(v) for v in lines[i + k].split()[:3]] for k in (1, 2, 3)])
            except (ValueError, IndexError):
                lat = None
            break
    if lat is None:
        raise ParseError("No se encontró la red real (Real Lattice) en el archivo CASTEP.")

    row = re.compile(r"^\s*x\s+([A-Za-z]{1,3})(?::\S*)?\s+\d+\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")\s+x")
    symbols, frac = [], []
    started = False
    for l in lines[start:start + 5000]:
        m = row.match(l)
        if m:
            started = True
            symbols.append(normalize_symbol(m.group(1)))
            frac.append([_f(m.group(2)), _f(m.group(3)), _f(m.group(4))])
        elif started and l.strip().startswith("xxxx"):
            break
    if not symbols:
        raise ParseError("No se pudieron leer las coordenadas fraccionarias del archivo CASTEP.")
    frac = np.array(frac)
    # Molécula en caja: reconstruir la molécula si quedó partida por condiciones periódicas
    frac, unwrapped = _unwrap_fractional(symbols, frac, lat)
    if unwrapped:
        warnings.append("La molécula cruzaba el borde de la celda periódica y se reconstruyó (imagen mínima).")
    cart = frac @ lat

    xc = None
    m = re.search(r"using functional\s*:\s*(.+)", text)
    if m:
        raw = m.group(1).strip()
        xc = _CASTEP_XC.get(raw.lower(), raw)
    m = re.search(r"Semi-empirical dispersion correction\s*:\s*on.*?SEDC with\s*:\s*(\S+)", text, re.S | re.I)
    if xc and m:
        xc = f"{xc}+{m.group(1)}"
    # El MolGC original invierte el orden de los átomos de CASTEP; se conserva para reproducibilidad
    symbols = symbols[::-1]
    cart = cart[::-1].copy()
    return Geometry(symbols, cart, "CASTEP", xc, None, name, warnings, lat)


def _unwrap_fractional(symbols, frac, lat):
    """Reconstruye una molécula partida por la frontera periódica usando imagen mínima."""
    from .bonds import is_bonded_pair  # import local para evitar ciclos
    n = len(symbols)
    if n < 2:
        return frac, False
    frac = frac.copy()
    visited = np.zeros(n, bool)
    moved = False
    for root in range(n):
        if visited[root]:
            continue
        visited[root] = True
        stack = [root]
        while stack:
            i = stack.pop()
            for j in range(n):
                if visited[j]:
                    continue
                d = frac[j] - frac[i]
                shift = np.round(d)
                dmin = (d - shift) @ lat
                if is_bonded_pair(symbols[i], symbols[j], float(np.linalg.norm(dmin))):
                    if np.any(shift != 0):
                        frac[j] -= shift
                        moved = True
                    visited[j] = True
                    stack.append(j)
    return frac, moved


# --------------------------------------------------------------------------------------
# FHI-aims
# --------------------------------------------------------------------------------------
def parse_fhiaims(text: str, name: str = "") -> Geometry:
    warnings: List[str] = []
    lines = text.splitlines()

    def block_after(idx):
        syms, xyz = [], []
        for l in lines[idx + 1: idx + 20000]:
            p = l.split()
            if not p:
                if syms:
                    break
                continue
            if p[0] == "atom" and len(p) >= 5:
                xyz.append([_f(p[1]), _f(p[2]), _f(p[3])])
                syms.append(normalize_symbol(p[4]))
            elif p[0] in ("lattice_vector", "x", "|") or l.strip().startswith("x [A]"):
                continue
            elif syms:
                break
        return syms, xyz

    symbols: List[str] = []
    coords: List[List[float]] = []
    fin = [i for i, l in enumerate(lines) if "Final atomic structure" in l]
    upd = [i for i, l in enumerate(lines) if "Updated atomic structure" in l]
    if fin:
        symbols, coords = block_after(fin[-1])
    if not symbols and upd:
        symbols, coords = block_after(upd[-1])
        warnings.append("No se encontró 'Final atomic structure'; se usó la última estructura actualizada.")
    if not symbols:
        rx = re.compile(r"\|\s*\d+:\s*Species\s+(\S+)\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")")
        for l in lines:
            m = rx.search(l)
            if m:
                symbols.append(normalize_symbol(m.group(1)))
                coords.append([_f(m.group(2)), _f(m.group(3)), _f(m.group(4))])
            elif symbols:
                break
        if symbols:
            warnings.append("No se encontró una estructura final; se usó la geometría de entrada.")
    if not symbols:
        raise ParseError("No se encontraron coordenadas en el archivo de FHI-aims.")
    xc = None
    m = re.search(r"^\s*xc\s+(\S+)", text, re.M)
    if m:
        xc = m.group(1)
    m2 = re.search(r"^\s*vdw_correction_hirshfeld|^\s*many_body_dispersion", text, re.M)
    if xc and m2:
        xc += "+TS" if "hirshfeld" in m2.group(0) else "+MBD"
    return Geometry(symbols, np.array(coords, float), "FHI-aims", _clean_functional(xc), None, name, warnings)


def parse_fhiaims_in(text: str, name: str = "") -> Geometry:
    symbols, coords, frac_rows, lat = [], [], [], []
    for l in text.splitlines():
        p = l.split("#")[0].split()
        if not p:
            continue
        if p[0] == "lattice_vector" and len(p) >= 4:
            lat.append([_f(v) for v in p[1:4]])
        elif p[0] == "atom" and len(p) >= 5:
            symbols.append(normalize_symbol(p[4]))
            coords.append([_f(v) for v in p[1:4]])
            frac_rows.append(None)
        elif p[0] == "atom_frac" and len(p) >= 5:
            symbols.append(normalize_symbol(p[4]))
            coords.append(None)
            frac_rows.append([_f(v) for v in p[1:4]])
    if not symbols:
        raise ParseError("No se encontraron líneas 'atom' en geometry.in.")
    lattice = np.array(lat) if len(lat) == 3 else None
    out = []
    for c, fr in zip(coords, frac_rows):
        if c is not None:
            out.append(c)
        else:
            if lattice is None:
                raise ParseError("geometry.in usa 'atom_frac' pero no define 'lattice_vector'.")
            out.append(list(np.array(fr) @ lattice))
    return Geometry(symbols, np.array(out, float), "FHI-aims", None, None, name, [], lattice)


# --------------------------------------------------------------------------------------
# XYZ
# --------------------------------------------------------------------------------------
def parse_xyz(text: str, name: str = "") -> Geometry:
    warnings: List[str] = []
    rx = re.compile(r"^\s*([A-Za-z]{1,3}|\d{1,3})[^\s]*\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")\s+(" + _FLOAT + r")")
    lines = text.splitlines()
    frames: List[tuple] = []
    i = 0
    # Intento 1: XYZ estándar, posiblemente con varios cuadros
    while i < len(lines):
        s = lines[i].strip()
        if re.fullmatch(r"\d+", s):
            n = int(s)
            body = lines[i + 2:i + 2 + n]
            if len(body) == n and all(rx.match(b) for b in body):
                frames.append((lines[i + 1].strip(), body))
                i += 2 + n
                continue
        i += 1
    if frames:
        comment, body = frames[-1]
        if len(frames) > 1:
            warnings.append(f"El archivo XYZ contiene {len(frames)} cuadros; se usó el último.")
    else:
        comment, body = "", [l for l in lines if rx.match(l)]
    symbols, coords = [], []
    for b in body:
        m = rx.match(b)
        if not m:
            continue
        tok = m.group(1)
        sym = SYMBOL_BY_Z.get(int(tok), "X") if tok.isdigit() else normalize_symbol(tok)
        symbols.append(sym)
        coords.append([_f(m.group(2)), _f(m.group(3)), _f(m.group(4))])
    if not symbols:
        raise ParseError("No se encontraron coordenadas en el archivo XYZ.")
    functional = None
    m = re.search(r"(?:functional|xc|method)\s*[=:]\s*([A-Za-z0-9+\-()]+)", comment, re.I)
    if m:
        functional = m.group(1)
    return Geometry(symbols, np.array(coords, float), "XYZ", functional, None, name, warnings)


def _clean_functional(f: Optional[str]) -> Optional[str]:
    if not f:
        return None
    f = f.strip()
    low = f.lower()
    table = {"pbe": "PBE", "pw-lda": "LDA", "pz-lda": "LDA", "b3lyp": "B3LYP", "m06": "M06", "pbe0": "PBE0",
             "hse06": "HSE06", "m062x": "M06-2X", "m06-2x": "M06-2X", "wb97xd": "ωB97X-D", "cam-b3lyp": "CAM-B3LYP"}
    return table.get(low, f.upper() if len(f) <= 8 else f)


# --------------------------------------------------------------------------------------
# API pública
# --------------------------------------------------------------------------------------
def read_geometry(data: bytes | str, filename: str = "", fmt: Optional[str] = None) -> Geometry:
    text = _decode(data)
    if not text.strip():
        raise ParseError(f"El archivo '{filename}' está vacío.")
    fmt = fmt or detect_format(text, filename)
    parser = {
        "gaussian": parse_gaussian,
        "castep": parse_castep,
        "fhiaims": parse_fhiaims,
        "fhiaims_in": parse_fhiaims_in,
        "xyz": parse_xyz,
    }[fmt]
    geo = parser(text, filename)
    if geo.natoms < 2:
        raise ParseError(f"'{filename}': se necesitan al menos 2 átomos.")
    if not np.all(np.isfinite(geo.coords)):
        raise ParseError(f"'{filename}': hay coordenadas no numéricas.")
    unknown = sorted({s for s in geo.symbols if s == "X"})
    if unknown:
        geo.warnings.append("Algunos símbolos atómicos no se reconocieron.")
    return geo


def read_geometry_file(path: str, fmt: Optional[str] = None) -> Geometry:
    import os
    with open(path, "rb") as fh:
        return read_geometry(fh.read(), os.path.basename(path), fmt)
