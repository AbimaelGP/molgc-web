"""Datos de elementos: símbolos, números atómicos, radios covalentes y colores CPK."""

_SYMBOLS = (
    "X H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr "
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb "
    "Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn"
).split()

SYMBOL_BY_Z = {i: s for i, s in enumerate(_SYMBOLS)}
Z_BY_SYMBOL = {s: i for i, s in enumerate(_SYMBOLS)}

# Radios covalentes (Å). B. Cordero et al., Dalton Trans. 2008, 2832-2838.
COVALENT_RADII = {
    "H": 0.31, "He": 0.28, "Li": 1.28, "Be": 0.96, "B": 0.84, "C": 0.76, "N": 0.71, "O": 0.66, "F": 0.57,
    "Ne": 0.58, "Na": 1.66, "Mg": 1.41, "Al": 1.21, "Si": 1.11, "P": 1.07, "S": 1.05, "Cl": 1.02, "Ar": 1.06,
    "K": 2.03, "Ca": 1.76, "Sc": 1.70, "Ti": 1.60, "V": 1.53, "Cr": 1.39, "Mn": 1.39, "Fe": 1.32, "Co": 1.26,
    "Ni": 1.24, "Cu": 1.32, "Zn": 1.22, "Ga": 1.22, "Ge": 1.20, "As": 1.19, "Se": 1.20, "Br": 1.20, "Kr": 1.16,
    "Rb": 2.20, "Sr": 1.95, "Y": 1.90, "Zr": 1.75, "Nb": 1.64, "Mo": 1.54, "Tc": 1.47, "Ru": 1.46, "Rh": 1.42,
    "Pd": 1.39, "Ag": 1.45, "Cd": 1.44, "In": 1.42, "Sn": 1.39, "Sb": 1.39, "Te": 1.38, "I": 1.39, "Xe": 1.40,
    "Cs": 2.44, "Ba": 2.15, "La": 2.07, "Pt": 1.36, "Au": 1.36, "Hg": 1.32, "Pb": 1.46, "Bi": 1.48,
}

CPK_COLORS = {
    "H": "#E8E8E8", "C": "#4A4A4A", "N": "#3050F8", "O": "#FF0D0D", "F": "#90E050", "Cl": "#1FF01F",
    "Br": "#A62929", "I": "#940094", "S": "#FFC832", "P": "#FF8000", "B": "#FFB5B5", "Si": "#F0C8A0",
}


def normalize_symbol(token: str) -> str:
    """'C1' -> 'C', 'CL' -> 'Cl', 'h' -> 'H', '6' -> 'C'."""
    t = token.strip()
    if t.isdigit():
        return SYMBOL_BY_Z.get(int(t), "X")
    letters = "".join(ch for ch in t if ch.isalpha())
    if not letters:
        return "X"
    two = letters[:2].capitalize()
    if len(letters) >= 2 and two in Z_BY_SYMBOL:
        # evitar confundir p. ej. "CA" (carbono alfa en PDB) — en estos formatos el símbolo va solo
        return two
    one = letters[0].upper()
    return one if one in Z_BY_SYMBOL else "X"
