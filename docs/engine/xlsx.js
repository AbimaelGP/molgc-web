/*! MolGC — generador mínimo de archivos .xlsx (Office Open XML) usando fflate.zipSync. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MolGCXlsx = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const enc = (s) => new TextEncoder().encode(s);
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // estilos: 0 normal, 1 encabezado, 2 0.000000, 3 0.00000, 4 0.0000, 5 negrita, 6 negrita+relleno
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="0.000000"/><numFmt numFmtId="165" formatCode="0.00000"/><numFmt numFmtId="166" formatCode="0.0000"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A8A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const FMT = { "0.000000": 2, "0.00000": 3, "0.0000": 4 };

  /** sheet = {name, header, rows, widths:{colIndex1: w}, formats:[[fromCol1,toCol1,fmt]], boldLastRow} */
  function sheetXml(sh) {
    const all = [sh.header].concat(sh.rows);
    const ncol = Math.max(...all.map((r) => r.length), 1);
    const cols = [];
    for (let i = 1; i <= ncol; i++) {
      const w = (sh.widths && sh.widths[i]) || Math.min(Math.max(10, String(sh.header[i - 1] ?? "").length * 0.9), 42);
      cols.push(`<col min="${i}" max="${i}" width="${w}" customWidth="1"/>`);
    }
    const styleFor = (ci, ri) => {
      if (ri === 0) return 1;
      if (sh.boldLastRow && ri === all.length - 1) return 6;
      for (const [a, b, fmt] of sh.formats || []) if (ci + 1 >= a && ci + 1 <= b) return FMT[fmt] || 0;
      return 0;
    };
    const rowsXml = all.map((row, ri) => {
      const cells = row.map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        let s = styleFor(ci, ri);
        if (v === null || v === undefined || v === "") return s && ri ? "" : (ri === 0 ? `<c r="${ref}" s="1"/>` : "");
        if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        if (s >= 2 && s <= 4) s = 0;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
      }).join("");
      return `<row r="${ri + 1}"${ri === 0 ? ' ht="36" customHeight="1"' : ""}>${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols.join("")}</cols><sheetData>${rowsXml}</sheetData></worksheet>`;
  }

  function workbook(sheets) {
    const fflate = root.fflate || (typeof require === "function" ? require("fflate") : null);
    const used = new Set();
    const names = sheets.map((s) => {
      let n = String(s.name).replace(/[\[\]:*?/\\]/g, "_").slice(0, 31) || "Hoja";
      let k = 1, base = n;
      while (used.has(n.toLowerCase())) n = (base.slice(0, 28) + "_" + ++k);
      used.add(n.toLowerCase());
      return n;
    });
    const files = {
      "[Content_Types].xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
      "_rels/.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      "xl/workbook.xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
      "xl/styles.xml": enc(STYLES),
    };
    sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = enc(sheetXml(s))));
    return fflate.zipSync(files, { level: 6 });
  }

  const CITE = "Cite: Camarillo-Cisneros J. et al. MolGC: molecular geometry comparator algorithm for bond length mean absolute error " +
    "computation on molecules. Mol. Divers. (2024). doi:10.1007/s11030-024-10945-2";

  function comparisonWorkbook(res) {
    const labels = res.labels, ref = res.reference.label, R = res.results;
    const summaryRows = R.map((r) => {
      const lc = r.label_check;
      return [r.label, r.software, r.functional || "", r.n_bonds, r.n_matched, r.MAE, r.MAPE, r.max_abs_error, r.RMSE_bonds,
        r.RMSD_ICP, r.RMSD_matched, lc.atoms_checked ? `${lc.atoms_ok}/${lc.atoms_checked}` : "n/d"];
    });
    summaryRows.push([], [`Referencia: ${ref}  |  ${res.reference.formula}  |  ${res.reference.n_bonds} enlaces`],
      [`Criterio de enlace: ${res.options.bond_mode}  |  Emparejamiento: ${res.options.matching}`],
      ["MAE = (1/|E|) Σ |L_B(g) − L_B(ref)|   (ec. 33 del artículo).  MAPE = MAE relativo a la longitud de referencia."], [CITE]);
    const sheets = [{
      name: "Resumen",
      header: ["Geometría evaluada", "Software", "Funcional detectado", "Enlaces", "Enlaces emparejados", "MAE (Å)", "MAPE (%)",
        "Error abs. máx. (Å)", "RMSE enlaces (Å)", "RMSD ICP (Å)", "RMSD con correspondencia (Å)", "Enlaces verificados"],
      rows: summaryRows, widths: { 1: 30 }, formats: [[6, 11, "0.000000"]],
    }];
    const rows = res.bonds.map((b) => [b.B, b.atom1, b.atom2, `${b.i}-${b.j}`, b.ref]
      .concat(labels.map((l) => b[`len::${l}`] ?? null))
      .concat(labels.map((l) => (b[`err::${l}`] === null || b[`err::${l}`] === undefined ? null : Math.abs(b[`err::${l}`])))));
    rows.push(["MAE", "", "", "", ""].concat(labels.map(() => "")).concat(R.map((r) => r.MAE)));
    sheets.push({ name: "Comparación y MAE", header: ["Etiqueta B", "Átomo 1", "Átomo 2", "Índices (ref)", `Ref: ${ref} (Å)`]
      .concat(labels.map((l) => `${l} (Å)`)).concat(labels.map((l) => `|${l} − ref| (Å)`)),
      rows, widths: { 4: 12 }, formats: [[5, 5 + 2 * labels.length, "0.00000"]], boldLastRow: true });
    const pairs = [...new Set(R.flatMap((r) => Object.keys(r.per_pair)))].sort();
    sheets.push({ name: "MAE por tipo de enlace", header: ["Tipo de enlace"].concat(labels.map((l) => `MAE ${l} (Å)`), ["n"]),
      rows: pairs.map((p) => [p].concat(R.map((r) => (r.per_pair[p] ? r.per_pair[p].MAE : null)),
        [(R.find((r) => r.per_pair[p]) || { per_pair: { [p]: { n: "" } } }).per_pair[p].n])),
      formats: [[2, 1 + labels.length, "0.000000"]] });
    sheets.push({ name: "Descriptores", header: ["Etiqueta B", "Enlace", "Descriptor de cadena S_uv (referencia)"],
      rows: res.bonds.map((b) => [b.B, b.pair, b.descriptor]), widths: { 3: 90 } });
    if (res.warnings && res.warnings.length) sheets.push({ name: "Avisos", header: ["Aviso"], rows: res.warnings.map((w) => [w]), widths: { 1: 120 } });
    return workbook(sheets);
  }

  function studyWorkbook(st) {
    const F = st.functionals;
    const sheets = [{
      name: "MAE por molécula", header: ["Familia", "Molécula", "Enlaces"].concat(F.map((f) => `MAE ${f} (Å)`)),
      rows: st.per_molecule.map((r) => [r.family, r.molecule, r.n_bonds].concat(F.map((f) => r[f] ?? null))).concat([[], [`Referencia: ${st.reference}`], [CITE]]),
      widths: { 1: 20, 2: 22 }, formats: [[4, 3 + F.length, "0.000000"]],
    }, {
      name: "RMSD por molécula", header: ["Familia", "Molécula"].concat(F.map((f) => `RMSD ICP ${f} (Å)`)),
      rows: st.per_molecule.map((r) => [r.family, r.molecule].concat(F.map((f) => r[`RMSD::${f}`] ?? null))),
      widths: { 1: 20, 2: 22 }, formats: [[3, 2 + F.length, "0.00000"]],
    }, {
      name: "MAE por familia", header: ["Funcional"].concat(st.families, ["Promedio"]),
      rows: F.map((f) => [f].concat(st.families.map((fam) => st.family_mae[fam][f]), [st.overall_mae[f]])),
      widths: { 1: 26 }, formats: [[2, 2 + st.families.length, "0.000000"]],
    }];
    if (st.topsis.length) sheets.push({ name: "UW-TOPSIS", header: ["Ranking", "Funcional", "Cercanía relativa C*", "Distancia a la ideal", "Distancia a la anti-ideal"],
      rows: st.topsis.map((t) => [t.rank, t.functional, t.closeness, t.d_ideal, t.d_anti_ideal])
        .concat([[], ["Alternativas: funcionales; criterios: familias (sin pesos). C* = d⁻/(d⁺+d⁻); 1 = solución ideal."]]),
      widths: { 2: 26 }, formats: [[3, 5, "0.0000"]] });
    for (const m of st.molecules) {
      const labels = m.labels;
      const rows = m.bonds.map((b) => [b.B, b.atom1, b.atom2, b.ref].concat(labels.map((l) => b[`len::${l}`] ?? null)));
      rows.push(["MAE", "", "", ""].concat(m.results.map((r) => r.MAE)));
      sheets.push({ name: m.molecule, header: ["B", "Átomo 1", "Átomo 2", "Ref (Å)"].concat(labels.map((l) => `${l} (Å)`)),
        rows, formats: [[4, 4 + labels.length, "0.00000"]], boldLastRow: true });
    }
    if (st.warnings && st.warnings.length) sheets.push({ name: "Avisos", header: ["Aviso"], rows: st.warnings.map((w) => [w]), widths: { 1: 120 } });
    return workbook(sheets);
  }

  return { workbook, comparisonWorkbook, studyWorkbook };
});
