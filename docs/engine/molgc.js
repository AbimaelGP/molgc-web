/*!
 * MolGC engine (JavaScript) — Molecular Geometry Comparator
 * Camarillo-Cisneros J., Ramírez-Alonso G., Arzate-Quintana C., Varela-Rodríguez H., Guzmán-Pando A.
 * Molecular Diversity (2024). doi:10.1007/s11030-024-10945-2
 *
 * Port 1:1 de la implementación de referencia en Python (carpeta /molgc del repositorio). Su
 * equivalencia numérica se verifica con tools/validate_js.mjs sobre el conjunto de antibióticos.
 * Funciona en el navegador (window / Web Worker) y en Node.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MolGC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // =================================================================================
  // Elementos
  // =================================================================================
  const SYMBOLS = ("X H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb " +
    "Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn").split(" ");
  const Z_BY_SYMBOL = {};
  SYMBOLS.forEach((s, i) => (Z_BY_SYMBOL[s] = i));
  // Radios covalentes (Å). Cordero et al., Dalton Trans. 2008, 2832-2838.
  const COVALENT_RADII = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41,
    Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39,
    Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20,
    Kr: 1.16, Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75, Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39,
    Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15, La: 2.07,
    Pt: 1.36, Au: 1.36, Hg: 1.32, Pb: 1.46, Bi: 1.48,
  };

  function normalizeSymbol(token) {
    const t = String(token).trim();
    if (/^\d+$/.test(t)) return SYMBOLS[parseInt(t, 10)] || "X";
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (!letters) return "X";
    const two = letters[0].toUpperCase() + (letters[1] || "").toLowerCase();
    if (letters.length >= 2 && Z_BY_SYMBOL[two] !== undefined) return two;
    const one = letters[0].toUpperCase();
    return Z_BY_SYMBOL[one] !== undefined ? one : "X";
  }

  // =================================================================================
  // Criterio de enlace (tabla de MolGC + radios covalentes)
  // =================================================================================
  const MOLGC_TABLE = { "C|O": 1.97249, "C|C": 1.89002, "C|N": 1.79202, "C|H": 1.20000, "C|F": 1.76002,
    "H|O": 1.20000, "H|N": 1.20000, "N|N": 1.88260, "N|O": 1.81746, "C|Cl": 2.11002 };
  const DEFAULT_COVALENT_FACTOR = 1.25;
  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);

  function threshold(a, b, mode = "molgc", factor = DEFAULT_COVALENT_FACTOR) {
    if (a === "H" && b === "H") return null;
    if (mode === "molgc" || mode === "molgc_strict") {
      const t = MOLGC_TABLE[pairKey(a, b)];
      if (t !== undefined) return t;
      if (mode === "molgc_strict") return null;
    }
    const ra = COVALENT_RADII[a], rb = COVALENT_RADII[b];
    if (ra === undefined || rb === undefined) return null;
    return factor * (ra + rb);
  }
  function isBondedPair(a, b, d, mode, factor) {
    const t = threshold(a, b, mode, factor);
    return t !== null && d > 0.0001 && d <= t;
  }
  function dist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function detectBonds(symbols, coords, mode = "molgc", factor = DEFAULT_COVALENT_FACTOR) {
    const n = symbols.length, cache = {}, out = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = symbols[i] + "|" + symbols[j];
        if (!(key in cache)) cache[key] = threshold(symbols[i], symbols[j], mode, factor);
        const t = cache[key];
        if (t === null) continue;
        const d = dist(coords[i], coords[j]);
        if (d > 0.0001 && d <= t) out.push([i, j]);
      }
    }
    return out;
  }
  function bondTableRows() {
    return Object.entries(MOLGC_TABLE).map(([k, v]) => ({ pair: k.split("|").join("–"), dist: v }));
  }

  // =================================================================================
  // Álgebra lineal 3x3
  // =================================================================================
  const T = (A) => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

  /** Autovalores/autovectores de una matriz simétrica 3x3 (Jacobi). Devuelve {w, V} con V[:,k]. */
  function eigSym3(S) {
    const A = S.map((r) => r.slice());
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      const off = A[0][1] * A[0][1] + A[0][2] * A[0][2] + A[1][2] * A[1][2];
      if (off < 1e-30) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    return { w: [A[0][0], A[1][1], A[2][2]], V };
  }

  /** SVD 3x3: C = U diag(s) Vt con s descendente (como numpy.linalg.svd). */
  function svd3(C) {
    const { w, V } = eigSym3(mm(T(C), C));
    const order = [0, 1, 2].sort((a, b) => w[b] - w[a]);
    const Vs = [0, 1, 2].map((k) => [V[0][order[k]], V[1][order[k]], V[2][order[k]]]); // columnas
    const s = [], U = [];
    for (let k = 0; k < 3; k++) {
      const v = Vs[k];
      const b = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]);
      s.push(norm(b));
      U.push(b);
    }
    const tol = Math.max(s[0], 1e-300) * 1e-12;
    for (let k = 0; k < 3; k++) {
      if (s[k] > tol) U[k] = U[k].map((x) => x / s[k]);
      else U[k] = null;
    }
    // completar columnas degeneradas
    if (!U[0]) U[0] = [1, 0, 0];
    if (!U[1]) { const a = Math.abs(U[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = cross(U[0], a); const n = norm(c); U[1] = c.map((x) => x / n); }
    if (!U[2]) {
      const c = cross(U[0], U[1]);
      // misma orientación relativa que C (det(U)·det(V) = signo de det(C) aproximado)
      U[2] = c;
    }
    const Um = [[U[0][0], U[1][0], U[2][0]], [U[0][1], U[1][1], U[2][1]], [U[0][2], U[1][2], U[2][2]]];
    const Vt = Vs.map((v) => v.slice());
    return { U: Um, s, Vt };
  }

  // =================================================================================
  // Lectores de archivos
  // =================================================================================
  class ParseError extends Error {}
  const FLOAT = "[-+]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[EeDd][-+]?\\d+)?";
  const f = (s) => parseFloat(String(s).replace(/[Dd]/, "E"));
  const isNum = (s) => new RegExp("^" + FLOAT + "$").test(String(s).trim());

  function formula(symbols) {
    const c = {};
    symbols.forEach((s) => (c[s] = (c[s] || 0) + 1));
    const keys = Object.keys(c);
    const hasC = "C" in c;
    const order = (hasC ? ["C", "H"].filter((k) => k in c) : []).concat(keys.filter((k) => !hasC || (k !== "C" && k !== "H")).sort());
    return order.map((el) => el + (c[el] > 1 ? c[el] : "")).join("");
  }
  function geometry(symbols, coords, software, functional, basis, name, warnings, lattice) {
    return { symbols, coords, software, functional: functional || null, basis: basis || null, source_name: name || "",
      warnings: warnings || [], lattice: lattice || null, natoms: symbols.length, formula: formula(symbols) };
  }
  function toXyz(g, comment) {
    const lines = [String(g.symbols.length), comment || g.source_name];
    g.symbols.forEach((s, k) => lines.push(s.padEnd(3) + g.coords[k].map((x) => x.toFixed(8).padStart(16)).join("")));
    return lines.join("\n") + "\n";
  }

  function looksLikeXyz(text) {
    const pat = new RegExp("^\\s*([A-Za-z]{1,3}|\\d{1,3})\\s+" + [FLOAT, FLOAT, FLOAT].join("\\s+") + "\\s*$");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return false;
    const sample = lines.slice(0, 200);
    const hits = sample.filter((l) => pat.test(l)).length;
    return hits >= Math.max(2, 0.6 * Math.min(lines.length, 200) - 2);
  }

  function detectFormat(text, filename = "") {
    const name = filename.toLowerCase();
    const head = text.slice(0, 20000);
    if (head.includes("Entering Gaussian System") || head.includes("Gaussian, Inc.") || text.slice(-200000).includes("\\GINC-")) return "gaussian";
    if (head.includes("Invoking FHI-aims") || head.includes("FHI-aims version")) return "fhiaims";
    if (head.includes("CCC   AA    SSS  TTTTT  EEEEE  PPPP") || head.includes("CASTEP version") || name.endsWith(".castep") ||
      (text.includes("Final Configuration") && text.includes("Fractional coordinates of atoms"))) return "castep";
    if (new RegExp("^\\s*atom(_frac)?\\s+" + FLOAT, "m").test(text)) return "fhiaims_in";
    if (name.endsWith(".xyz") || looksLikeXyz(text)) return "xyz";
    throw new ParseError("No se reconoció el formato del archivo. Formatos soportados: Gaussian (.log), CASTEP (.castep), " +
      "FHI-aims (.out / geometry.in) y XYZ (.xyz).");
  }

  const FUNC_TABLE = { pbe: "PBE", "pw-lda": "LDA", "pz-lda": "LDA", b3lyp: "B3LYP", m06: "M06", pbe0: "PBE0", hse06: "HSE06",
    m062x: "M06-2X", "m06-2x": "M06-2X", wb97xd: "ωB97X-D", "cam-b3lyp": "CAM-B3LYP" };
  function cleanFunctional(fn) {
    if (!fn) return null;
    fn = fn.trim();
    const low = fn.toLowerCase();
    return FUNC_TABLE[low] || (fn.length <= 8 ? fn.toUpperCase() : fn);
  }

  function gaussianArchive(text) {
    const lines = text.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].replace(/^\s+/, "").startsWith("1\\1\\")) start = i;
    if (start < 0) return null;
    const buf = [];
    for (const l of lines.slice(start, start + 400)) {
      buf.push(l.startsWith(" ") ? l.slice(1) : l);
      if (buf.slice(-2).join("").includes("\\\\@")) break;
    }
    return buf.join("");
  }

  function parseGaussian(text, name) {
    const warnings = [], symbols = [], coords = [];
    let functional = null, basis = null;
    const arch = gaussianArchive(text);
    if (arch) {
      const sections = arch.split("\\\\");
      const head = sections[0].split("\\");
      if (head.length > 5) {
        let method = head[4];
        if (method.toUpperCase().startsWith("RO") && method.length > 3) method = method.slice(2);
        else if ("RU".includes(method.slice(0, 1).toUpperCase()) && method.length > 2) method = method.slice(1);
        functional = method; basis = head[5];
        if (!head[3].toLowerCase().includes("opt")) warnings.push("El cálculo de Gaussian no es una optimización de geometría (p. ej. punto simple).");
      }
      if (sections.length > 3) {
        const geo = sections[3].split("\\");
        for (const atom of geo.slice(1)) {
          const parts = atom.split(",");
          if (parts.length < 4) continue;
          const last = parts.slice(-3);
          if (!last.every(isNum)) continue;
          symbols.push(normalizeSymbol(parts[0]));
          coords.push(last.map(f));
        }
      }
    }
    if (!symbols.length) {
      const re = /(Standard|Input) orientation:[\s\S]*?-{5,}\n[\s\S]*?-{5,}\n([\s\S]*?)\n\s*-{5,}/g;
      let m, last = null;
      while ((m = re.exec(text))) last = m;
      if (!last) throw new ParseError("No se encontraron coordenadas en el archivo de Gaussian.");
      for (const row of last[2].split(/\r?\n/)) {
        const p = row.trim().split(/\s+/);
        if (p.length >= 6) { symbols.push(SYMBOLS[parseInt(p[1], 10)] || "X"); coords.push([f(p[3]), f(p[4]), f(p[5])]); }
      }
      warnings.push("No se encontró el bloque de archivo final (1\\1\\GINC); se usó la última orientación impresa. " +
        "Verifique que la optimización haya terminado.");
    }
    if (functional === null) {
      const m = /^\s*#\S*\s*(?:opt\S*\s+)?([A-Za-z0-9+\-()]+)\/(\S+)/im.exec(text);
      if (m) { functional = m[1]; basis = m[2]; }
    }
    return geometry(symbols, coords, "Gaussian", cleanFunctional(functional), basis, name, warnings);
  }

  const CASTEP_XC = { "local density approximation": "LDA", "perdew burke ernzerhof": "PBE", "perdew wang (1991)": "PW91",
    "pbe for solids (2008)": "PBEsol", "revised perdew burke ernzerhof": "RPBE", "wu-cohen": "WC", "hartree-fock": "HF",
    hse06: "HSE06", b3lyp: "B3LYP" };

  function unwrapFractional(symbols, frac, lat) {
    const n = symbols.length;
    if (n < 2) return { frac, moved: false };
    frac = frac.map((r) => r.slice());
    const visited = new Array(n).fill(false);
    let moved = false;
    const toCart = (v) => [0, 1, 2].map((j) => v[0] * lat[0][j] + v[1] * lat[1][j] + v[2] * lat[2][j]);
    // numpy.round redondea a par en .5; Math.round no. Se usa redondeo a par para igualar.
    const rnd = (x) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r; };
    for (let root = 0; root < n; root++) {
      if (visited[root]) continue;
      visited[root] = true;
      const stack = [root];
      while (stack.length) {
        const i = stack.pop();
        for (let j = 0; j < n; j++) {
          if (visited[j]) continue;
          const d = [0, 1, 2].map((k) => frac[j][k] - frac[i][k]);
          const shift = d.map(rnd);
          const dmin = toCart(d.map((x, k) => x - shift[k]));
          if (isBondedPair(symbols[i], symbols[j], norm(dmin), "molgc", DEFAULT_COVALENT_FACTOR)) {
            if (shift.some((x) => x !== 0)) { for (let k = 0; k < 3; k++) frac[j][k] -= shift[k]; moved = true; }
            visited[j] = true;
            stack.push(j);
          }
        }
      }
    }
    return { frac, moved };
  }

  function parseCastep(text, name) {
    const warnings = [];
    const lines = text.split(/\r?\n/);
    const idxFinal = [], idxCells = [];
    lines.forEach((l, i) => { if (l.includes("Final Configuration")) idxFinal.push(i); if (l.includes("Cell Contents")) idxCells.push(i); });
    let start;
    if (idxFinal.length) start = idxFinal[idxFinal.length - 1];
    else if (idxCells.length) {
      start = idxCells[idxCells.length - 1];
      warnings.push("No se encontró 'BFGS : Final Configuration'; se usó el último bloque 'Cell Contents' (la optimización podría no haber convergido).");
    } else throw new ParseError("No se encontraron coordenadas en el archivo CASTEP.");
    let lat = null;
    for (let i = start; i >= 0; i--) {
      if (lines[i].includes("Real Lattice")) {
        try {
          lat = [1, 2, 3].map((k) => lines[i + k].trim().split(/\s+/).slice(0, 3).map(f));
          if (lat.some((r) => r.length < 3 || r.some((x) => !Number.isFinite(x)))) lat = null;
        } catch (e) { lat = null; }
        break;
      }
    }
    if (!lat) throw new ParseError("No se encontró la red real (Real Lattice) en el archivo CASTEP.");
    const row = new RegExp("^\\s*x\\s+([A-Za-z]{1,3})(?::\\S*)?\\s+\\d+\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")\\s+x");
    let symbols = [], frac = [], started = false;
    for (const l of lines.slice(start, start + 5000)) {
      const m = row.exec(l);
      if (m) { started = true; symbols.push(normalizeSymbol(m[1])); frac.push([f(m[2]), f(m[3]), f(m[4])]); }
      else if (started && l.trim().startsWith("xxxx")) break;
    }
    if (!symbols.length) throw new ParseError("No se pudieron leer las coordenadas fraccionarias del archivo CASTEP.");
    const uw = unwrapFractional(symbols, frac, lat);
    if (uw.moved) warnings.push("La molécula cruzaba el borde de la celda periódica y se reconstruyó (imagen mínima).");
    let cart = uw.frac.map((v) => [0, 1, 2].map((j) => v[0] * lat[0][j] + v[1] * lat[1][j] + v[2] * lat[2][j]));
    let xc = null;
    let m = /using functional\s*:\s*(.+)/.exec(text);
    if (m) { const raw = m[1].trim(); xc = CASTEP_XC[raw.toLowerCase()] || raw; }
    m = /Semi-empirical dispersion correction\s*:\s*on[\s\S]*?SEDC with\s*:\s*(\S+)/i.exec(text);
    if (xc && m) xc = `${xc}+${m[1]}`;
    // El MolGC original invierte el orden de los átomos de CASTEP; se conserva para reproducibilidad
    symbols = symbols.reverse();
    cart = cart.reverse();
    return geometry(symbols, cart, "CASTEP", xc, null, name, warnings, lat);
  }

  function parseFhiaims(text, name) {
    const warnings = [];
    const lines = text.split(/\r?\n/);
    const blockAfter = (idx) => {
      const syms = [], xyz = [];
      for (const l of lines.slice(idx + 1, idx + 20000)) {
        const p = l.trim().split(/\s+/).filter(Boolean);
        if (!p.length) { if (syms.length) break; continue; }
        if (p[0] === "atom" && p.length >= 5) { xyz.push([f(p[1]), f(p[2]), f(p[3])]); syms.push(normalizeSymbol(p[4])); }
        else if (["lattice_vector", "x", "|"].includes(p[0]) || l.trim().startsWith("x [A]")) continue;
        else if (syms.length) break;
      }
      return [syms, xyz];
    };
    let symbols = [], coords = [];
    const fin = [], upd = [];
    lines.forEach((l, i) => { if (l.includes("Final atomic structure")) fin.push(i); if (l.includes("Updated atomic structure")) upd.push(i); });
    if (fin.length) [symbols, coords] = blockAfter(fin[fin.length - 1]);
    if (!symbols.length && upd.length) {
      [symbols, coords] = blockAfter(upd[upd.length - 1]);
      warnings.push("No se encontró 'Final atomic structure'; se usó la última estructura actualizada.");
    }
    if (!symbols.length) {
      const rx = new RegExp("\\|\\s*\\d+:\\s*Species\\s+(\\S+)\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")");
      for (const l of lines) {
        const m = rx.exec(l);
        if (m) { symbols.push(normalizeSymbol(m[1])); coords.push([f(m[2]), f(m[3]), f(m[4])]); }
        else if (symbols.length) break;
      }
      if (symbols.length) warnings.push("No se encontró una estructura final; se usó la geometría de entrada.");
    }
    if (!symbols.length) throw new ParseError("No se encontraron coordenadas en el archivo de FHI-aims.");
    let xc = null;
    const m = /^\s*xc\s+(\S+)/m.exec(text);
    if (m) xc = m[1];
    const m2 = /^\s*vdw_correction_hirshfeld|^\s*many_body_dispersion/m.exec(text);
    if (xc && m2) xc += m2[0].includes("hirshfeld") ? "+TS" : "+MBD";
    return geometry(symbols, coords, "FHI-aims", cleanFunctional(xc), null, name, warnings);
  }

  function parseFhiaimsIn(text, name) {
    const symbols = [], rows = [], lat = [];
    for (const l of text.split(/\r?\n/)) {
      const p = l.split("#")[0].trim().split(/\s+/).filter(Boolean);
      if (!p.length) continue;
      if (p[0] === "lattice_vector" && p.length >= 4) lat.push(p.slice(1, 4).map(f));
      else if (p[0] === "atom" && p.length >= 5) { symbols.push(normalizeSymbol(p[4])); rows.push({ c: p.slice(1, 4).map(f) }); }
      else if (p[0] === "atom_frac" && p.length >= 5) { symbols.push(normalizeSymbol(p[4])); rows.push({ fr: p.slice(1, 4).map(f) }); }
    }
    if (!symbols.length) throw new ParseError("No se encontraron líneas 'atom' en geometry.in.");
    const lattice = lat.length === 3 ? lat : null;
    const coords = rows.map((r) => {
      if (r.c) return r.c;
      if (!lattice) throw new ParseError("geometry.in usa 'atom_frac' pero no define 'lattice_vector'.");
      return [0, 1, 2].map((j) => r.fr[0] * lattice[0][j] + r.fr[1] * lattice[1][j] + r.fr[2] * lattice[2][j]);
    });
    return geometry(symbols, coords, "FHI-aims", null, null, name, [], lattice);
  }

  function parseXyz(text, name) {
    const warnings = [];
    const rx = new RegExp("^\\s*([A-Za-z]{1,3}|\\d{1,3})[^\\s]*\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")\\s+(" + FLOAT + ")");
    const lines = text.split(/\r?\n/);
    const frames = [];
    let i = 0;
    while (i < lines.length) {
      const s = lines[i].trim();
      if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        const body = lines.slice(i + 2, i + 2 + n);
        if (body.length === n && n > 0 && body.every((b) => rx.test(b))) { frames.push([(lines[i + 1] || "").trim(), body]); i += 2 + n; continue; }
      }
      i++;
    }
    let comment = "", body;
    if (frames.length) {
      [comment, body] = frames[frames.length - 1];
      if (frames.length > 1) warnings.push(`El archivo XYZ contiene ${frames.length} cuadros; se usó el último.`);
    } else body = lines.filter((l) => rx.test(l));
    const symbols = [], coords = [];
    for (const b of body) {
      const m = rx.exec(b);
      if (!m) continue;
      const tok = m[1];
      symbols.push(/^\d+$/.test(tok) ? (SYMBOLS[parseInt(tok, 10)] || "X") : normalizeSymbol(tok));
      coords.push([f(m[2]), f(m[3]), f(m[4])]);
    }
    if (!symbols.length) throw new ParseError("No se encontraron coordenadas en el archivo XYZ.");
    let functional = null;
    const m = /(?:functional|xc|method)\s*[=:]\s*([A-Za-z0-9+\-()]+)/i.exec(comment);
    if (m) functional = m[1];
    return geometry(symbols, coords, "XYZ", functional, null, name, warnings);
  }

  function readGeometry(text, filename = "", fmt = null) {
    if (!text || !text.trim()) throw new ParseError(`El archivo '${filename}' está vacío.`);
    fmt = fmt || detectFormat(text, filename);
    const parser = { gaussian: parseGaussian, castep: parseCastep, fhiaims: parseFhiaims, fhiaims_in: parseFhiaimsIn, xyz: parseXyz }[fmt];
    const g = parser(text, filename);
    if (g.natoms < 2) throw new ParseError(`'${filename}': se necesitan al menos 2 átomos.`);
    if (!g.coords.every((c) => c.every(Number.isFinite))) throw new ParseError(`'${filename}': hay coordenadas no numéricas.`);
    if (g.symbols.includes("X")) g.warnings.push("Algunos símbolos atómicos no se reconocieron.");
    return g;
  }

  // =================================================================================
  // 1. Orientación canónica (transformaciones_m.transformacionpuntos)
  // =================================================================================
  const metric = (p, q) => Math.sqrt(Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]));
  const safeAtan = (num, den) => { const v = Math.atan(num / den); return Number.isFinite(v) ? v : 0; };
  const applyRow = (X, M) => X.map((p) => [0, 1, 2].map((j) => p[0] * M[0][j] + p[1] * M[1][j] + p[2] * M[2][j]));
  const rotZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const argmin = (arr) => { let k = 0; for (let i = 1; i < arr.length; i++) if (arr[i] < arr[k]) k = i; return k; };
  const stableSort = (arr, cmp) => arr.map((v, i) => [v, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0]);
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function canonicalOrientation(symbols, coords) {
    let X = coords.map((c) => c.slice());
    const elems = [...new Set(symbols)];
    const idxBy = {};
    elems.forEach((el) => (idxBy[el] = symbols.map((s, i) => (s === el ? i : -1)).filter((i) => i >= 0)));
    const n = X.length;
    const center = [0, 1, 2].map((j) => X.reduce((a, p) => a + p[j], 0) / n);
    let rows = elems.map((el) => {
      const ids = idxBy[el];
      const d = ids.map((i) => metric(X[i], center));
      const k = argmin(d);
      return [ids.length, el, ids[k], d[k]];
    });
    rows = stableSort(rows, (a, b) => a[0] - b[0] || cmpStr(a[1], b[1]));
    const ind = rows[0][2];
    const a0 = X[ind].slice();
    X = X.map((p) => [p[0] - a0[0], p[1] - a0[1], p[2] - a0[2]]);
    if (elems.length < 2) return X;

    rows = elems.map((el) => {
      const ids = idxBy[el];
      const d = ids.map((i) => metric(X[i], X[ind]));
      const k = argmin(d);
      return [ids.length, el, ids[k], d[k], X[ids[k]][0] - X[ind][0]];
    });
    rows = stableSort(rows, (a, b) => a[3] - b[3]);
    const ind2 = rows[1][2], dx2 = rows[1][4];
    let ang = safeAtan(X[ind2][1], X[ind2][0]);
    if (dx2 < 0) ang += Math.PI;
    X = applyRow(X, rotZ(ang));

    rows = elems.map((el) => {
      const ids = idxBy[el];
      const d = ids.map((i) => metric(X[i], X[ind2]));
      const k = argmin(d);
      return [ids.length, el, ids[k], d[k]];
    });
    rows = stableSort(rows, (a, b) => a[3] - b[3]);
    const ind3 = rows[rows.length - 1][2];
    ang = safeAtan(X[ind3][2], X[ind3][0]);
    return applyRow(X, rotY(ang));
  }

  // =================================================================================
  // 2. ICP + Kabsch con pesos de Huber
  // =================================================================================
  const REFLECTIONS = [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]];

  function icpKabsch(target, source, maxIterations = 200, tolerance = 1e-10, delta = 1.0) {
    const n = source.length, m = target.length;
    let best = null, minRmsd = Infinity;
    for (const refl of REFLECTIONS) {
      let src = source.map((p) => [p[0] * refl[0], p[1] * refl[1], p[2] * refl[2]]);
      let prevError = Infinity;
      for (let it = 0; it < maxIterations; it++) {
        const dists = new Array(n), tgt = new Array(n);
        for (let i = 0; i < n; i++) {
          let bd = Infinity, bk = 0;
          const p = src[i];
          for (let k = 0; k < m; k++) {
            const q = target[k];
            const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bd) { bd = d2; bk = k; }
          }
          dists[i] = Math.sqrt(bd); tgt[i] = target[bk];
        }
        const w = dists.map((d) => (Math.abs(d) <= delta ? 1 : delta / Math.abs(d)));
        const ws = src.map((p, i) => [p[0] * w[i], p[1] * w[i], p[2] * w[i]]);
        const wt = tgt.map((p, i) => [p[0] * w[i], p[1] * w[i], p[2] * w[i]]);
        const sc = [0, 1, 2].map((j) => ws.reduce((a, p) => a + p[j], 0) / n);
        const tc = [0, 1, 2].map((j) => wt.reduce((a, p) => a + p[j], 0) / n);
        const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < n; i++) {
          const a = [ws[i][0] - sc[0], ws[i][1] - sc[1], ws[i][2] - sc[2]];
          const b = [wt[i][0] - tc[0], wt[i][1] - tc[1], wt[i][2] - tc[2]];
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += a[r] * b[c];
        }
        const { U, Vt } = svd3(C);
        const R = mm(U, Vt);
        src = src.map((p) => {
          const a = [p[0] - sc[0], p[1] - sc[1], p[2] - sc[2]];
          return [0, 1, 2].map((j) => a[0] * R[0][j] + a[1] * R[1][j] + a[2] * R[2][j] + tc[j]);
        });
        const meanError = dists.reduce((a, b) => a + b, 0) / n;
        if (Math.abs(prevError - meanError) < tolerance) break;
        prevError = meanError;
        let s = 0;
        for (let i = 0; i < n; i++) { const dx = src[i][0] - tgt[i][0], dy = src[i][1] - tgt[i][1], dz = src[i][2] - tgt[i][2]; s += dx * dx + dy * dy + dz * dz; }
        const rmsd = Math.sqrt(s / n);
        if (rmsd < minRmsd) { minRmsd = rmsd; best = src; }
      }
    }
    if (!best) return { aligned: source.map((p) => p.slice()), rmsd: NaN };
    return { aligned: best, rmsd: minRmsd };
  }

  // =================================================================================
  // 3-6. Enlaces, descriptores y etiquetado
  // =================================================================================
  function stringDescriptors(symbols, bonds) {
    const n = symbols.length;
    const nb = Array.from({ length: n }, () => []);
    for (const [i, j] of bonds) { nb[i].push(j); nb[j].push(i); }
    const bag = nb.map((list, a) => [symbols[a]].concat(list.map((k) => symbols[k])));
    const sorted = (arr) => arr.slice().sort(cmpStr);
    const desc = bonds.map(([i, j]) => {
      const si = sorted(bag[i]).join("-"), sj = sorted(bag[j]).join("-");
      const s1 = sorted([si, sj]).join("-");
      const second = nb[i].map((k) => sorted(bag[k]).join("")).concat(nb[j].map((k) => sorted(bag[k]).join("")));
      return s1 + "x" + sorted(second).join(".");
    });
    return { desc, nb };
  }

  function cart2spSum(v) {
    const r = norm(v);
    const theta = r > 0 ? Math.asin(v[2] / r) : 0;
    return r + theta + Math.atan2(v[1], v[0]);
  }

  function labelBonds(symbols, coords, bondMode = "molgc", factor = DEFAULT_COVALENT_FACTOR) {
    const pairs = detectBonds(symbols, coords, bondMode, factor);
    if (!pairs.length) return { bonds: [], nb: symbols.map(() => []) };
    const { desc, nb } = stringDescriptors(symbols, pairs);
    const counts = {};
    desc.forEach((d) => (counts[d] = (counts[d] || 0) + 1));
    let bonds = pairs.map(([i, j], k) => {
      const v = [coords[j][0] - coords[i][0], coords[j][1] - coords[i][1], coords[j][2] - coords[i][2]];
      const d = desc[k];
      return { i, j, el1: symbols[i], el2: symbols[j], length: norm(v), descriptor: d,
        spatial: counts[d] > 1 ? cart2spSum(v) : 0,
        mid: [(coords[i][0] + coords[j][0]) / 2, (coords[i][1] + coords[j][1]) / 2, (coords[i][2] + coords[j][2]) / 2],
        pair: [symbols[i], symbols[j]].sort(cmpStr).join("–") };
    });
    bonds = stableSort(bonds, (a, b) => cmpStr(a.descriptor, b.descriptor) || (a.spatial < b.spatial ? -1 : a.spatial > b.spatial ? 1 : 0));
    bonds.forEach((b, k) => (b.label = k));
    return { bonds, nb };
  }

  function processGeometry(symbols, coords, refOriented, bondMode, factor) {
    const oriented = canonicalOrientation(symbols, coords);
    const { aligned, rmsd } = icpKabsch(refOriented || oriented, oriented);
    const { bonds, nb } = labelBonds(symbols, aligned, bondMode, factor);
    return { symbols: symbols.slice(), coords: aligned, bonds, rmsd_icp: rmsd, neighbors: nb, input_coords: coords.map((c) => c.slice()) };
  }

  // ------------------------------------------------------------------ asignación húngara
  /** Asignación de costo mínimo (rectangular). Devuelve [rows, cols] como scipy.optimize.linear_sum_assignment. */
  function linearSumAssignment(cost) {
    const nr = cost.length, nc = nr ? cost[0].length : 0;
    if (!nr || !nc) return [[], []];
    const transpose = nr > nc;
    const C = transpose ? cost[0].map((_, j) => cost.map((r) => r[j])) : cost;
    const n = C.length, m = C[0].length; // n <= m
    const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
    const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(m + 1).fill(Infinity);
      const used = new Uint8Array(m + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = C[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const pairs = [];
    for (let j = 1; j <= m; j++) if (p[j]) pairs.push(transpose ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]);
    pairs.sort((a, b) => a[0] - b[0]);
    return [pairs.map((x) => x[0]), pairs.map((x) => x[1])];
  }

  function superpose(P, Q, allowReflection = true) {
    const n = P.length;
    const pc = [0, 1, 2].map((j) => P.reduce((a, x) => a + x[j], 0) / n);
    const qc = [0, 1, 2].map((j) => Q.reduce((a, x) => a + x[j], 0) / n);
    const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] += (P[i][r] - pc[r]) * (Q[i][c] - qc[c]);
    const { U, Vt } = svd3(H);
    let R = mm(U, Vt);
    if (!allowReflection && det3(R) < 0) {
      const U2 = U.map((r) => [r[0], r[1], -r[2]]);
      R = mm(U2, Vt);
    }
    const t = [0, 1, 2].map((j) => qc[j] - (pc[0] * R[0][j] + pc[1] * R[1][j] + pc[2] * R[2][j]));
    return { R, t };
  }
  const transform = (X, R, t) => X.map((p) => [0, 1, 2].map((j) => p[0] * R[0][j] + p[1] * R[1][j] + p[2] * R[2][j] + t[j]));

  function hungarianByElement(Q, X, groups, n) {
    const m = new Array(n).fill(-1);
    for (const [ri, ti] of groups) {
      const cost = ri.map((a) => ti.map((b) => dist(Q[a], X[b])));
      const [ra, cb] = linearSumAssignment(cost);
      ra.forEach((x, k) => (m[ri[x]] = ti[cb[k]]));
    }
    return m;
  }
  const sortedCopy = (a) => a.slice().sort(cmpStr);
  const sameMultiset = (a, b) => a.length === b.length && sortedCopy(a).every((x, i) => x === sortedCopy(b)[i]);

  /** Mapeo átomo-a-átomo ref -> tgt (verificación y emparejamiento espacial). */
  function atomMapping(ref, tgt) {
    if (!sameMultiset(ref.symbols, tgt.symbols)) return null;
    const n = ref.symbols.length;
    const rs = ref.symbols, ts = tgt.symbols;
    const degR = ref.neighbors.map((x) => x.length), degT = tgt.neighbors.map((x) => x.length);
    let coreR = [...Array(n).keys()].filter((i) => degR[i] !== 1);
    let coreT = [...Array(n).keys()].filter((i) => degT[i] !== 1);
    const useCore = coreR.length >= 3 && sameMultiset(coreR.map((i) => rs[i]), coreT.map((i) => ts[i]));
    if (!useCore) { coreR = [...Array(n).keys()]; coreT = [...Array(n).keys()]; }
    const mean = (X, idx) => [0, 1, 2].map((j) => idx.reduce((a, i) => a + X[i][j], 0) / idx.length);
    const cr = mean(ref.coords, coreR), ct = mean(tgt.coords, coreT);
    const Q = ref.coords.map((p) => [p[0] - cr[0], p[1] - cr[1], p[2] - cr[2]]);
    const P0 = tgt.coords.map((p) => [p[0] - ct[0], p[1] - ct[1], p[2] - ct[2]]);
    const groups = [...new Set(coreR.map((i) => rs[i]))].sort(cmpStr).map((el) => [coreR.filter((i) => rs[i] === el), coreT.filter((i) => ts[i] === el)]);
    const axes = (X, idx) => {
      const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const i of idx) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += X[i][r] * X[i][c];
      const { w, V } = eigSym3(S);
      const order = [0, 1, 2].sort((a, b) => w[b] - w[a]);
      return [0, 1, 2].map((r) => order.map((k) => V[r][k]));
    };
    const Aq = axes(Q, coreR), Ap = axes(P0, coreT);
    const starts = [P0];
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const As = Ap.map((r) => [r[0] * sx, r[1] * sy, r[2] * sz]);
      const M = mm(As, T(Aq));
      starts.push(applyRow(P0, M));
    }
    let bestM = null, bestR = Infinity, bestX = null;
    for (let X of starts) {
      let mp = null;
      for (let it = 0; it < 25; it++) {
        const newM = hungarianByElement(Q, X, groups, n);
        if (mp && coreR.every((i) => newM[i] === mp[i])) break;
        mp = newM;
        const { R, t } = superpose(coreR.map((i) => X[mp[i]]), coreR.map((i) => Q[i]));
        X = transform(X, R, t);
      }
      let s = 0;
      for (const i of coreR) { const a = X[mp[i]], b = Q[i]; s += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; }
      const r = Math.sqrt(s / coreR.length);
      if (r < bestR - 1e-9) { bestR = r; bestM = mp; bestX = X; }
    }
    const m = bestM.slice(), X = bestX;
    if (!useCore) return m;
    const used = new Set(coreR.map((i) => m[i]));
    for (const a of coreR) {
      const tr = ref.neighbors[a].filter((k) => degR[k] === 1 && m[k] < 0);
      if (!tr.length) continue;
      const tt = tgt.neighbors[m[a]].filter((k) => degT[k] === 1 && !used.has(k));
      for (const el of [...new Set(tr.map((k) => rs[k]))]) {
        const ri = tr.filter((k) => rs[k] === el), ti = tt.filter((k) => ts[k] === el);
        if (!ti.length) continue;
        const [aa, bb] = linearSumAssignment(ri.map((x) => ti.map((y) => dist(Q[x], X[y]))));
        aa.forEach((x, k) => { m[ri[x]] = ti[bb[k]]; used.add(ti[bb[k]]); });
      }
    }
    const restR = [...Array(n).keys()].filter((i) => m[i] < 0);
    if (restR.length) {
      const restT = [...Array(n).keys()].filter((k) => !used.has(k));
      for (const el of [...new Set(restR.map((i) => rs[i]))]) {
        const ri = restR.filter((i) => rs[i] === el), ti = restT.filter((k) => ts[k] === el);
        const [aa, bb] = linearSumAssignment(ri.map((x) => ti.map((y) => dist(Q[x], X[y]))));
        aa.forEach((x, k) => (m[ri[x]] = ti[bb[k]]));
      }
    }
    return m;
  }

  function rmsdMatched(ref, tgt, mapping) {
    if (!mapping) return null;
    const P = mapping.map((k) => tgt.input_coords[k]);
    const D = ref.input_coords;
    const { R, t } = superpose(P, D, false);
    const Y = transform(P, R, t);
    let s = 0;
    Y.forEach((p, i) => (s += (p[0] - D[i][0]) ** 2 + (p[1] - D[i][1]) ** 2 + (p[2] - D[i][2]) ** 2));
    return Math.sqrt(s / Y.length);
  }

  function matchBonds(ref, tgt, method = "molgc", mapping = null) {
    let pairs = [], unmatchedTgt = [], note = null;
    if (method === "molgc" && ref.bonds.length === tgt.bonds.length) {
      pairs = ref.bonds.map((_, k) => [k, k]);
    } else if (method === "spatial" && mapping) {
      const index = {};
      tgt.bonds.forEach((b, k) => (index[Math.min(b.i, b.j) + "-" + Math.max(b.i, b.j)] = k));
      const used = new Set();
      ref.bonds.forEach((b, k) => {
        const a = mapping[b.i], c = mapping[b.j];
        const tk = index[Math.min(a, c) + "-" + Math.max(a, c)];
        pairs.push([k, tk === undefined ? null : tk]);
        if (tk !== undefined) used.add(tk);
      });
      unmatchedTgt = tgt.bonds.map((_, k) => k).filter((k) => !used.has(k));
    } else {
      if (method === "molgc") note = `El número de enlaces difiere (${ref.bonds.length} vs ${tgt.bonds.length}); se usó el emparejamiento espacial por descriptor.`;
      const gr = new Map(), gt = new Map();
      ref.bonds.forEach((b, k) => { if (!gr.has(b.descriptor)) gr.set(b.descriptor, []); gr.get(b.descriptor).push(k); });
      tgt.bonds.forEach((b, k) => { if (!gt.has(b.descriptor)) gt.set(b.descriptor, []); gt.get(b.descriptor).push(k); });
      const usedT = new Set();
      let leftover = [];
      for (const [d, rk] of gr) {
        const tk = gt.get(d) || [];
        if (!tk.length) { leftover.push(...rk); continue; }
        const [ra, cb] = linearSumAssignment(rk.map((a) => tk.map((b) => dist(ref.bonds[a].mid, tgt.bonds[b].mid))));
        const got = new Set();
        ra.forEach((a, k) => { pairs.push([rk[a], tk[cb[k]]]); usedT.add(tk[cb[k]]); got.add(rk[a]); });
        leftover.push(...rk.filter((k) => !got.has(k)));
      }
      const restT = tgt.bonds.map((_, k) => k).filter((k) => !usedT.has(k));
      if (leftover.length && restT.length) {
        const cost = leftover.map((a) => restT.map((b) => (ref.bonds[a].pair === tgt.bonds[b].pair ? dist(ref.bonds[a].mid, tgt.bonds[b].mid) : 1e6)));
        const [ra, cb] = linearSumAssignment(cost);
        const still = new Set(leftover);
        ra.forEach((a, k) => { if (cost[a][cb[k]] < 0.6) { pairs.push([leftover[a], restT[cb[k]]]); usedT.add(restT[cb[k]]); still.delete(leftover[a]); } });
        leftover = [...still].sort((a, b) => a - b);
      }
      leftover.forEach((k) => pairs.push([k, null]));
      pairs.sort((a, b) => a[0] - b[0]);
      unmatchedTgt = tgt.bonds.map((_, k) => k).filter((k) => !usedT.has(k));
    }
    return { pairs, unmatched_tgt: unmatchedTgt, note };
  }

  function verifyPairs(ref, tgt, pairs, mapping) {
    return pairs.map(([rk, tk]) => {
      if (tk === null) return { elements: false, descriptor: false, atoms: null };
      const rb = ref.bonds[rk], tb = tgt.bonds[tk];
      let atoms = null;
      if (mapping) { const a = mapping[rb.i], b = mapping[rb.j]; atoms = (a === tb.i && b === tb.j) || (a === tb.j && b === tb.i); }
      return { elements: rb.pair === tb.pair, descriptor: rb.descriptor === tb.descriptor, atoms };
    });
  }

  // =================================================================================
  // Análisis
  // =================================================================================
  function options(d) {
    d = d || {};
    const o = { bond_mode: "molgc", covalent_factor: DEFAULT_COVALENT_FACTOR, matching: "molgc" };
    if (["molgc", "molgc_strict", "covalent"].includes(d.bond_mode)) o.bond_mode = d.bond_mode;
    const fct = parseFloat(d.covalent_factor);
    if (Number.isFinite(fct) && fct >= 1 && fct <= 1.6) o.covalent_factor = fct;
    if (["molgc", "spatial"].includes(d.matching)) o.matching = d.matching;
    return o;
  }
  const r = (x, n = 6) => (x === null || x === undefined || !Number.isFinite(x) ? null : parseFloat(x.toFixed(n)));
  const meanOf = (a) => a.reduce((s, x) => s + x, 0) / a.length;

  function compareGeometries(geos, labels, refIndex, opts, includeStructures = true) {
    const opt = options(opts);
    if (geos.length < 2) throw new Error("Se necesitan al menos dos geometrías.");
    if (!(refIndex >= 0 && refIndex < geos.length)) throw new Error("Índice de referencia inválido.");
    const refGeo = geos[refIndex];
    const warnings = [];
    const refOriented = canonicalOrientation(refGeo.symbols, refGeo.coords);
    const processed = geos.map((g) => processGeometry(g.symbols, g.coords, refOriented, opt.bond_mode, opt.covalent_factor));
    const ref = processed[refIndex];
    if (!ref.bonds.length) throw new Error("No se detectaron enlaces en la geometría de referencia.");
    const rows = ref.bonds.map((b) => ({ B: b.label, atom1: b.el1, atom2: b.el2, i: b.i + 1, j: b.j + 1, pair: b.pair,
      descriptor: b.descriptor, ref: r(b.length) }));
    const results = [];
    geos.forEach((g, gi) => {
      if (gi === refIndex) return;
      const p = processed[gi], lab = labels[gi];
      if (!sameMultiset(g.symbols, refGeo.symbols)) warnings.push(`«${lab}» tiene una composición química distinta a la referencia (${g.formula} vs ${refGeo.formula}); la comparación puede no ser válida.`);
      const mapping = atomMapping(ref, p);
      const m = matchBonds(ref, p, opt.matching, mapping);
      if (m.note) warnings.push(`«${lab}»: ${m.note}`);
      const checks = verifyPairs(ref, p, m.pairs, mapping);
      const errs = [], rel = [], perPair = {};
      m.pairs.forEach(([rk, tk], k) => {
        const row = rows[rk];
        if (tk === null) { row[`len::${lab}`] = null; row[`err::${lab}`] = null; return; }
        const L = p.bonds[tk].length, Lr = ref.bonds[rk].length, d = L - Lr;
        row[`len::${lab}`] = r(L); row[`err::${lab}`] = r(d); row[`chk::${lab}`] = checks[k];
        errs.push(Math.abs(d)); rel.push(Math.abs(d) / Lr);
        (perPair[ref.bonds[rk].pair] = perPair[ref.bonds[rk].pair] || []).push(Math.abs(d));
      });
      const atomsChecked = checks.filter((c) => c.atoms !== null);
      const pp = {};
      Object.keys(perPair).sort(cmpStr).forEach((k) => (pp[k] = { MAE: r(meanOf(perPair[k])), n: perPair[k].length }));
      results.push({
        label: lab, software: g.software, functional: g.functional, n_atoms: g.natoms, formula: g.formula,
        n_bonds: p.bonds.length, n_matched: errs.length, n_unmatched_ref: ref.bonds.length - errs.length,
        n_unmatched_tgt: m.unmatched_tgt.length,
        MAE: errs.length ? r(meanOf(errs)) : null, MAPE: rel.length ? r(100 * meanOf(rel), 5) : null,
        max_abs_error: errs.length ? r(Math.max(...errs)) : null,
        RMSE_bonds: errs.length ? r(Math.sqrt(meanOf(errs.map((x) => x * x)))) : null,
        RMSD_ICP: r(p.rmsd_icp), RMSD_matched: r(rmsdMatched(ref, p, mapping)),
        label_check: { elements_ok: checks.filter((c) => c.elements).length,
          atoms_ok: atomsChecked.length ? atomsChecked.filter((c) => c.atoms).length : null,
          atoms_checked: atomsChecked.length, total: checks.length },
        per_pair: pp, pairs: m.pairs, struct_index: gi, warnings: g.warnings.slice(),
      });
    });
    const out = {
      reference: { label: labels[refIndex], software: refGeo.software, functional: refGeo.functional, n_atoms: refGeo.natoms,
        formula: refGeo.formula, n_bonds: ref.bonds.length, warnings: refGeo.warnings.slice() },
      results, bonds: rows, labels: labels.filter((_, i) => i !== refIndex), options: opt, warnings,
    };
    if (includeStructures) {
      out.structures = processed.map((p, i) => ({ label: labels[i], is_ref: i === refIndex, symbols: p.symbols,
        coords: p.coords.map((c) => c.map((x) => r(x, 5))), bonds: p.bonds.map((b) => [b.i, b.j, b.label]) }));
      out.aligned_xyz = {};
      out.structures.forEach((s) => {
        const lines = [String(s.symbols.length), `${s.label} — alineada al marco de la referencia por MolGC`];
        s.symbols.forEach((e, k) => lines.push(e.padEnd(3) + s.coords[k].map((x) => x.toFixed(6).padStart(14)).join("")));
        out.aligned_xyz[s.label] = lines.join("\n") + "\n";
      });
    }
    return out;
  }

  function topsisUw(alternatives, criteria, M) {
    const nc = criteria.length;
    const colNorm = [...Array(nc).keys()].map((j) => Math.sqrt(M.reduce((a, row) => a + row[j] * row[j], 0)));
    const N = M.map((row) => row.map((v, j) => v / colNorm[j]));
    const best = [...Array(nc).keys()].map((j) => Math.min(...N.map((row) => row[j])));
    const worst = [...Array(nc).keys()].map((j) => Math.max(...N.map((row) => row[j])));
    const dB = N.map((row) => Math.sqrt(row.reduce((a, v, j) => a + (v - best[j]) ** 2, 0)));
    const dW = N.map((row) => Math.sqrt(row.reduce((a, v, j) => a + (v - worst[j]) ** 2, 0)));
    const clos = dB.map((b, i) => { const c = dW[i] / (b + dW[i]); return Number.isFinite(c) ? c : 1; });
    const order = stableSort([...Array(M.length).keys()], (a, b) => clos[b] - clos[a]);
    const rank = {};
    order.forEach((i, k) => (rank[i] = k + 1));
    return order.map((i) => ({ functional: alternatives[i], d_ideal: r(dB[i]), d_anti_ideal: r(dW[i]), closeness: r(clos[i]),
      rank: rank[i], values: Object.fromEntries(criteria.map((c, j) => [c, r(M[i][j])])) }));
  }

  function runStudy(entries, referenceKey, opts) {
    const opt = options(opts);
    const byMol = new Map();
    for (const e of entries) {
      const k = e.family + "\u0000" + e.molecule;
      if (!byMol.has(k)) byMol.set(k, []);
      byMol.get(k).push(e);
    }
    const molecules = [], warnings = [];
    for (const k of [...byMol.keys()].sort(cmpStr)) {
      const items = byMol.get(k);
      const [fam, mol] = k.split("\u0000");
      const keys = items.map((e) => `${e.functional} (${e.software})`);
      if (!keys.includes(referenceKey)) { warnings.push(`${fam}/${mol}: no contiene la referencia ${referenceKey}; se omitió.`); continue; }
      if (items.length < 2) { warnings.push(`${fam}/${mol}: sólo tiene una geometría; se omitió.`); continue; }
      try {
        const res = compareGeometries(items.map((e) => e.geometry), keys, keys.indexOf(referenceKey), opt, false);
        molecules.push({ family: fam, molecule: mol, result: res });
        res.warnings.forEach((w) => warnings.push(`${fam}/${mol}: ${w}`));
      } catch (exc) { warnings.push(`${fam}/${mol}: ${exc.message}`); }
    }
    const functionals = [...new Set(molecules.flatMap((m) => m.result.results.map((x) => x.label)))].sort(cmpStr);
    const families = [...new Set(molecules.map((m) => m.family))].sort(cmpStr);
    const perMolecule = molecules.map((m) => {
      const row = { family: m.family, molecule: m.molecule, n_bonds: m.result.reference.n_bonds };
      m.result.results.forEach((x) => { row[x.label] = x.MAE; row[`RMSD::${x.label}`] = x.RMSD_ICP; });
      return row;
    });
    const famTable = {};
    families.forEach((fam) => {
      famTable[fam] = {};
      functionals.forEach((fn) => {
        const vals = perMolecule.filter((row) => row.family === fam && row[fn] !== null && row[fn] !== undefined).map((row) => row[fn]);
        famTable[fam][fn] = vals.length ? r(meanOf(vals)) : null;
      });
    });
    const overall = {};
    functionals.forEach((fn) => {
      const vals = families.map((fam) => famTable[fam][fn]).filter((v) => v !== null);
      overall[fn] = vals.length ? r(meanOf(vals)) : null;
    });
    const complete = functionals.filter((fn) => families.every((fam) => famTable[fam][fn] !== null));
    const topsis = complete.length >= 2 && families.length ? topsisUw(complete, families, complete.map((fn) => families.map((fam) => famTable[fam][fn]))) : [];
    return {
      reference: referenceKey, functionals, families, per_molecule: perMolecule, family_mae: famTable, overall_mae: overall, topsis,
      molecules: molecules.map((m) => ({ family: m.family, molecule: m.molecule, bonds: m.result.bonds, results: m.result.results,
        labels: m.result.labels, reference: m.result.reference })),
      warnings, options: opt,
    };
  }

  /** Etiqueta sugerida para un archivo: "Funcional (Software)" si viene de la jerarquía, si no el nombre. */
  function suggestLabel(g, filename) {
    const parts = String(filename).split(/[\\/]/).filter(Boolean);
    const base = parts.length ? parts[parts.length - 1] : "";
    const stem = base.replace(/\.txt$/i, "").replace(/\.[^.]+$/, "");
    if (stem.toLowerCase() === "geometry" && parts.length >= 3) return `${parts[parts.length - 2]} (${parts[parts.length - 3]})`;
    if (g.functional && (stem.toLowerCase() === "geometry" || !stem)) return `${g.functional} (${g.software})`;
    return stem || g.software;
  }

  return {
    version: "2.0.0",
    ParseError, readGeometry, detectFormat, toXyz, suggestLabel,
    canonicalOrientation, icpKabsch, labelBonds, processGeometry, atomMapping, matchBonds,
    compareGeometries, runStudy, topsisUw, options, bondTableRows, linearSumAssignment, svd3,
  };
});
