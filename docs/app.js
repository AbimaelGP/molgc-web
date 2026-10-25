/* MolGC Web — interfaz */
(() => {
  "use strict";

  // ------------------------------------------------------------------ estado
  const S = {
    lang: "es",
    pair: [null, null],          // {kind:'upload'|'demo', file?, path?, info?, label?}
    multi: [],
    multiRef: 0,
    study: { file: null, demo: false, scan: null },
    last: null,                  // {type:'compare'|'study', data, mode}
    demoSets: null,
    viewers: {},
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };

  function t(key, vars) {
    let s = (I18N.js[S.lang] && I18N.js[S.lang][key]) || I18N.js.es[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  }
  const fmt = (v, d = 5) => (v === null || v === undefined || Number.isNaN(v) ? t("none") : Number(v).toFixed(d));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const seriesColor = (i) => css(`--s${(i % 8) + 1}`);

  // ------------------------------------------------------------------ idioma y tema
  function applyLang(lang) {
    S.lang = lang;
    document.documentElement.lang = lang;
    $$("[data-i18n]").forEach((el) => {
      if (el.dataset.es === undefined) el.dataset.es = el.innerHTML;
      const k = el.dataset.i18n;
      el.innerHTML = lang === "en" && I18N.en[k] ? I18N.en[k] : el.dataset.es;
    });
    $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    store.set("molgc.lang", lang);
    renderPairSlots();
    renderMulti();
    renderExamples();
    if (S.study.scan) renderScan();
    if (S.last) rerender();
    renderHeroCaption();
  }

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    store.set("molgc.theme", theme || "");
    if (S.last) rerender();
    if (S.hero) drawHero();
  }
  function currentDark() {
    const th = document.documentElement.dataset.theme;
    if (th) return th === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // ------------------------------------------------------------------ motor de cálculo
  // Todo se calcula en el navegador: los archivos nunca salen de la computadora del usuario.
  const Engine = (() => {
    let worker = null, seq = 0;
    const pending = new Map();
    const failAll = (msg) => { pending.forEach((p) => p.reject(new Error(msg))); pending.clear(); };
    try {
      worker = new Worker("engine/worker.js");
      worker.onmessage = (ev) => {
        const p = pending.get(ev.data.id);
        if (!p) return;
        pending.delete(ev.data.id);
        if (ev.data.ok) p.resolve(ev.data.result); else p.reject(new Error(ev.data.error));
      };
      worker.onerror = (e) => { e.preventDefault(); worker = null; failAll(e.message || "Error en el motor de cálculo"); };
    } catch (e) { worker = null; }
    let mainLoaded = null;
    const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    async function main(op, payload) {        // respaldo sin Web Worker (p. ej. abierto como archivo local)
      if (!mainLoaded) mainLoaded = Promise.all([loadScript("engine/molgc.js"), loadScript("vendor/fflate.min.js")]).then(() => loadScript("engine/handlers.js"));
      await mainLoaded;
      return window.MolGCHandlers[op](payload);
    }
    return {
      call(op, payload, transfer) {
        if (!worker) return main(op, payload);
        return new Promise((resolve, reject) => {
          const id = ++seq;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, op, payload }, transfer || []);
        });
      },
    };
  })();

  const absUrl = (u) => new URL(u, location.href).href;
  function decodeBuf(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
  }
  async function itemText(it) {
    if (it.text !== undefined) return it.text;
    if (it.kind === "demo") {
      const r = await fetch(it.url);
      if (!r.ok) throw new Error(`No se pudo descargar ${it.path}`);
      it.text = decodeBuf(await r.arrayBuffer());
    } else {
      it.text = decodeBuf(await it.file.arrayBuffer());
    }
    return it.text;
  }
  const itemName = (it) => (it.kind === "demo" ? it.path : it.file.name);
  async function filesPayload(items) {
    const texts = await Promise.all(items.map(itemText));
    return items.map((it, k) => ({ name: itemName(it), text: texts[k], label: it.label || "" }));
  }

  async function parseItems(items) {
    const todo = items.filter((it) => !it.info);
    if (!todo.length) return;
    const res = await Engine.call("parse", { files: (await filesPayload(todo)).map(({ name, text }) => ({ name, text })) });
    res.files.forEach((info, k) => {
      todo[k].info = info;
      if (!todo[k].label && info.ok) todo[k].label = info.label;
    });
  }
  async function compareItems(items, refIndex) {
    return Engine.call("compare", { files: await filesPayload(items), ref_index: refIndex, options: getOptions() });
  }

  function getOptions() {
    const v = (n) => ($(`input[name="${n}"]:checked`) || {}).value;
    return { bond_mode: v("bond_mode"), matching: v("matching"),
      covalent_factor: parseFloat($('input[name="covalent_factor"]').value) || 1.25 };
  }

  // ------------------------------------------------------------------ estado / mensajes
  function setStatus(kind, text) {
    const el = $("#status");
    if (!kind) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="msg ${kind === "error" ? "error" : ""}">${kind === "busy" ? '<span class="spinner" aria-hidden="true"></span>' : ""}<div>${esc(text)}</div></div>`;
  }
  async function busy(text, fn) {
    setStatus("busy", text);
    $$(".btn.primary").forEach((b) => (b.dataset.wasDisabled = b.disabled, b.disabled = true));
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setStatus("error", e.message || String(e));
      return null;
    } finally {
      $$(".btn.primary").forEach((b) => { b.disabled = b.dataset.wasDisabled === "true"; });
      updateButtons();
    }
  }

  // ------------------------------------------------------------------ pestañas
  function setupTabs() {
    const tabs = $$('[role="tab"]');
    const select = (tab) => {
      tabs.forEach((x) => {
        const on = x === tab;
        x.setAttribute("aria-selected", String(on));
        x.tabIndex = on ? 0 : -1;
        $("#" + x.getAttribute("aria-controls")).hidden = !on;
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(n); n.focus();
      });
    });
  }

  // ------------------------------------------------------------------ zonas de arrastre
  function setupDrop(label, onFiles) {
    const input = $("input[type=file]", label);
    input.addEventListener("change", () => { if (input.files.length) onFiles(Array.from(input.files)); input.value = ""; });
    label.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragenter", "dragover"].forEach((ev) => label.addEventListener(ev, (e) => { e.preventDefault(); label.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => label.addEventListener(ev, (e) => { e.preventDefault(); label.classList.remove("over"); }));
    label.addEventListener("drop", (e) => { const f = Array.from(e.dataTransfer.files || []); if (f.length) onFiles(f); });
  }

  // ------------------------------------------------------------------ modo par
  function infoBlock(it) {
    if (!it) return "";
    const name = it.kind === "demo" ? it.path.split("/").slice(-3).join("/") : it.file.name;
    if (!it.info) return `<div class="fname">${esc(name)}</div>`;
    if (!it.info.ok) return `<div class="fname">${esc(name)}</div><div class="err">${esc(it.info.error)}</div>`;
    const i = it.info;
    return `<div class="fname">${esc(name)}</div>
      <dl><dt>${t("software")}</dt><dd>${esc(i.software)}</dd>
      <dt>${t("functional")}</dt><dd>${esc(i.functional || t("notDetected"))}${i.basis ? " / " + esc(i.basis) : ""}</dd>
      <dt>${t("formula")}</dt><dd>${esc(i.formula)} · ${i.n_atoms} ${t("atoms").toLowerCase()}</dd></dl>
      <label class="hint">${t("label")}<input type="text" maxlength="60" value="${esc(it.label || "")}" data-role="label"></label>
      ${(i.warnings || []).map((w) => `<div class="warn hint">${esc(w)}</div>`).join("")}`;
  }

  function renderPairSlots() {
    $$("#panel-pair .slot").forEach((slot) => {
      const k = +slot.dataset.slot;
      const it = S.pair[k];
      const box = $(".file-info", slot);
      const drop = $(".drop", slot);
      box.hidden = !it;
      drop.classList.toggle("has-file", !!it);
      box.innerHTML = infoBlock(it);
      const inp = $('input[data-role="label"]', box);
      if (inp) inp.addEventListener("input", () => { it.label = inp.value; });
    });
    updateButtons();
  }

  async function setPair(k, it) {
    S.pair[k] = it;
    renderPairSlots();
    await busy(t("reading"), async () => { await parseItems([it]); setStatus(null); });
    renderPairSlots();
  }

  function updateButtons() {
    $("#runPair").disabled = !(S.pair[0] && S.pair[1] && S.pair.every((x) => !x.info || x.info.ok));
    const okMulti = S.multi.filter((x) => !x.info || x.info.ok).length;
    $("#runMulti").disabled = okMulti < 2;
    $("#runMulti").textContent = S.multi.length >= 2 ? t("compareN", { n: S.multi.length }) : t("compareGeoms");
    $("#runStudy").disabled = !(S.study.scan && $("#studyRef").value);
  }

  async function runPair() {
    const items = S.pair.slice();
    const res = await busy(t("running"), () => compareItems(items, 0));
    if (res) { setStatus("done", t("done", { s: res.elapsed_s })); S.last = { type: "compare", data: res, mode: "pair" }; rerender(true); }
  }

  // ------------------------------------------------------------------ modo multi
  function renderMulti() {
    const wrap = $("#multiTableWrap");
    wrap.hidden = !S.multi.length;
    const tb = $("#multiTable tbody");
    if (S.multiRef >= S.multi.length) S.multiRef = 0;
    tb.innerHTML = S.multi.map((it, k) => {
      const name = it.kind === "demo" ? it.path.split("/").slice(-3).join("/") : it.file.name;
      const i = it.info;
      if (i && !i.ok) {
        return `<tr><td></td><td colspan="6"><b>${esc(name)}</b> — <span class="err">${esc(i.error)}</span></td>
          <td><button class="rm" data-k="${k}" aria-label="${t("remove")}">×</button></td></tr>`;
      }
      return `<tr class="${k === S.multiRef ? "is-ref" : ""}">
        <td><input type="radio" name="multiRef" value="${k}" ${k === S.multiRef ? "checked" : ""} aria-label="${t("refHint")}"></td>
        <td><input type="text" maxlength="60" data-k="${k}" value="${esc(it.label || "")}"></td>
        <td title="${esc(name)}">${esc(name.length > 40 ? "…" + name.slice(-38) : name)}</td>
        <td>${esc(i ? i.software : "…")}</td><td>${esc(i ? (i.functional || t("notDetected")) : "…")}</td>
        <td>${esc(i ? i.formula : "")}</td><td class="num">${i ? i.n_atoms : ""}</td>
        <td><button class="rm" data-k="${k}" aria-label="${t("remove")}">×</button></td></tr>`;
    }).join("");
    $$('input[name="multiRef"]', tb).forEach((r) => r.addEventListener("change", () => { S.multiRef = +r.value; renderMulti(); }));
    $$('input[type="text"]', tb).forEach((inp) => inp.addEventListener("input", () => { S.multi[+inp.dataset.k].label = inp.value; }));
    $$(".rm", tb).forEach((b) => b.addEventListener("click", () => { S.multi.splice(+b.dataset.k, 1); renderMulti(); }));
    updateButtons();
  }

  async function addMulti(items) {
    S.multi.push(...items);
    renderMulti();
    await busy(t("reading"), async () => { await parseItems(items); setStatus(null); });
    // referencia por defecto: un archivo cuyo funcional sea M06 si existe (como en el artículo)
    const k = S.multi.findIndex((x) => x.info && x.info.ok && /m06/i.test(x.label || ""));
    if (k >= 0 && items.length === S.multi.length) S.multiRef = k;
    renderMulti();
  }

  async function runMulti() {
    const items = S.multi.filter((x) => !x.info || x.info.ok);
    if (items.length < 2) { setStatus("error", t("needTwo")); return; }
    const refItem = S.multi[S.multiRef];
    const ref = Math.max(0, items.indexOf(refItem));
    const res = await busy(t("running"), () => compareItems(items, ref));
    if (res) { setStatus("done", t("done", { s: res.elapsed_s })); S.last = { type: "compare", data: res, mode: "multi" }; rerender(true); }
  }

  // ------------------------------------------------------------------ ejemplos
  async function loadDemoSets() {
    try {
      const r = await fetch("data/demo/manifest.json");
      S.demoSets = await r.json();
      renderExamples();
    } catch (e) { /* sin ejemplos */ }
  }
  function renderExamples() {
    const d = S.demoSets;
    if (!d) return;
    const list = $("#pairExamples");
    list.innerHTML = d.pair.map((p) => `<button type="button" data-id="${p.id}">${esc(p.id === "xyz" ? t("exampleXyz") : t("exampleMixed"))}</button>`).join("");
    $$("button", list).forEach((b) => b.addEventListener("click", async () => {
      const set = d.pair.find((p) => p.id === b.dataset.id);
      S.pair = set.files.map((f) => ({ kind: "demo", path: f.name, url: f.url }));
      renderPairSlots();
      await busy(t("reading"), async () => { await parseItems(S.pair); setStatus(null); });
      renderPairSlots();
    }));
    const sel = $("#multiExample");
    const cur = sel.value;
    sel.innerHTML = `<option value="">${S.lang === "en" ? I18N.en["examples.pick"] : "Elegir molécula del artículo…"}</option>` +
      d.multi.map((m) => `<option value="${esc(m.id)}">${esc(m.title)} (${esc(m.family.toLowerCase())})</option>`).join("");
    sel.value = cur;
  }

  // ------------------------------------------------------------------ estudio
  async function studySource() {
    if (S.study.demo) {
      if (!S.demoSets) await loadDemoSets();
      return { source: { files: S.demoSets.study.map((f) => ({ member: f.member, url: absUrl(f.url) })) }, transfer: [] };
    }
    const buf = await S.study.file.arrayBuffer();
    return { source: { zip: buf }, transfer: [buf] };
  }
  async function scanStudy() {
    const res = await busy(t("scanning"), async () => {
      const { source, transfer } = await studySource();
      return Engine.call("studyScan", { source }, transfer);
    });
    if (!res) return;
    setStatus(null);
    S.study.scan = res;
    renderScan();
  }
  function renderScan() {
    const sc = S.study.scan;
    const box = $("#studyScan");
    box.hidden = false;
    const name = S.study.demo ? (S.lang === "en" ? "Antibiotics dataset (MolGC paper)" : "Conjunto de antibióticos (artículo MolGC)") : S.study.file.name;
    box.innerHTML = `<p><b>${esc(name)}</b> — ${t("scanFound", { g: sc.n_geometries, m: sc.n_molecules, f: sc.families.length })}
      ${esc(sc.families.join(", "))}. ${t("pickRef")}</p>`;
    const sel = $("#studyRef");
    const prev = sel.value;
    sel.innerHTML = sc.keys.map((k) => `<option value="${esc(k.key)}">${esc(k.key)} — ${k.count}</option>`).join("");
    const m06 = sc.keys.find((k) => /^m06\b/i.test(k.key));
    sel.value = prev && sc.keys.some((k) => k.key === prev) ? prev : (m06 ? m06.key : sc.keys[0].key);
    sel.disabled = false;
    updateButtons();
  }
  async function runStudy() {
    const reference = $("#studyRef").value;
    const res = await busy(t("studyRunning"), async () => {
      const { source, transfer } = await studySource();
      return Engine.call("studyRun", { source, reference, options: getOptions() }, transfer);
    });
    if (res) { setStatus("done", t("done", { s: res.elapsed_s })); S.last = { type: "study", data: res }; rerender(true); }
  }

  // ------------------------------------------------------------------ gráficos
  function plotLayout(extra = {}) {
    const ink = css("--ink"), muted = css("--muted"), line = css("--line");
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Public Sans, system-ui, sans-serif", size: 13, color: ink },
      margin: { l: 64, r: 16, t: 28, b: 64 },
      xaxis: { gridcolor: line, linecolor: line, tickfont: { color: muted }, automargin: true, zeroline: false },
      yaxis: { gridcolor: line, linecolor: line, tickfont: { color: muted }, automargin: true, zerolinecolor: css("--line-strong") },
      legend: { orientation: "h", y: -0.22, font: { color: ink } },
      hoverlabel: { font: { family: "Public Sans, sans-serif" } },
      barcornerradius: 3, bargap: 0.35,
    }, extra);
  }
  const plotConfig = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    toImageButtonOptions: { format: "png", scale: 3 } };
  function plot(el, data, layout) { if (window.Plotly) Plotly.newPlot(el, data, plotLayout(layout), plotConfig); }

  // ------------------------------------------------------------------ visor 3D
  const RAMP = ["#fde3c8", "#f9b67f", "#ef8343", "#d4511f", "#a12c12"];
  function rampColor(x) {             // x en [0,1]
    const v = Math.max(0, Math.min(1, x)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(v)), f = v - i;
    const a = RAMP[i], b = RAMP[i + 1];
    const h = (s, o) => parseInt(s.slice(o, o + 2), 16);
    const mix = (o) => Math.round(h(a, o) + (h(b, o) - h(a, o)) * f).toString(16).padStart(2, "0");
    return "#" + mix(1) + mix(3) + mix(5);
  }
  const CPK = { H: "#d9dde3", C: "#5d6670", N: "#3050f8", O: "#ff2a1a", F: "#7ccf3c", Cl: "#1fbf1f", S: "#e8b900", P: "#ff8000", Br: "#a62929", I: "#940094" };

  function drawMolecule(viewer, st, opts) {
    const { errOf, color, alpha = 1, radius = 0.12, atomScale = 0.24, hover, labels } = opts;
    const xyz = st.coords;
    st.symbols.forEach((el, k) => {
      const p = { x: xyz[k][0], y: xyz[k][1], z: xyz[k][2] };
      viewer.addSphere({ center: p, radius: el === "H" ? atomScale * 0.7 : atomScale, color: color || CPK[el] || "#b08ae0", alpha });
    });
    st.bonds.forEach(([i, j, lab]) => {
      const a = xyz[i], b = xyz[j];
      const e = errOf ? errOf(lab) : null;
      const c = e === null || e === undefined ? (color || "#9aa3ae") : rampColor(e.norm);
      const spec = {
        start: { x: a[0], y: a[1], z: a[2] }, end: { x: b[0], y: b[1], z: b[2] },
        radius: e ? radius * 1.25 : radius, color: c, alpha, fromCap: 1, toCap: 1,
      };
      if (hover) {
        spec.hoverable = true;
        spec.hover_callback = () => hover(lab, true);
        spec.unhover_callback = () => hover(lab, false);
      }
      viewer.addCylinder(spec);
      if (labels) {
        viewer.addLabel(String(e && e.B !== undefined ? e.B : lab), {
          position: { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2 },
          fontSize: 11, fontColor: currentDark() ? "white" : "black", showBackground: false, inFront: true,
        });
      }
    });
  }

  function makeViewer(el) {
    if (!window.$3Dmol) return null;
    el.innerHTML = "";
    const v = $3Dmol.createViewer(el, { backgroundColor: css("--surface-2") || "white", antialias: true });
    return v;
  }

  function errLookup(res, result) {
    // etiqueta del enlace en la geometría evaluada -> {abs, norm, B, row}
    const lab = result.label;
    const map = {};
    let max = 0;
    result.pairs.forEach(([rk, tk]) => {
      if (tk === null) return;
      const row = res.bonds[rk];
      const e = row[`err::${lab}`];
      if (e === null || e === undefined) return;
      map[tk] = { abs: Math.abs(e), err: e, B: row.B, row };
      max = Math.max(max, Math.abs(e));
    });
    return { map, max };
  }

  // ------------------------------------------------------------------ hero
  async function loadHero() {
    try {
      S.hero = await compareItems([
        { kind: "demo", path: "ciprofloxacin_M06.xyz", url: "data/demo/xyz/ciprofloxacin_M06.xyz", label: "M06" },
        { kind: "demo", path: "ciprofloxacin_B3LYP.xyz", url: "data/demo/xyz/ciprofloxacin_B3LYP.xyz", label: "B3LYP" }], 0);
      drawHero();
      renderHeroCaption();
    } catch (e) { /* el hero es decorativo */ }
  }
  function renderHeroCaption() {
    if (!S.hero) return;
    $("#heroMae").textContent = t("heroMae", { v: fmt(S.hero.results[0].MAE, 4) });
  }
  function drawHero() {
    const el = $("#heroViewer");
    const v = makeViewer(el);
    if (!v) return;
    const res = S.hero, r = res.results[0];
    const { map, max } = errLookup(res, r);
    const ev = res.structures.find((s) => s.label === r.label);
    const ref = res.structures.find((s) => s.is_ref);
    drawMolecule(v, ref, { color: css("--ref"), alpha: 0.35, radius: 0.1, atomScale: 0.2 });
    drawMolecule(v, ev, { errOf: (lab) => (map[lab] ? { ...map[lab], norm: map[lab].abs / (max || 1) } : null) });
    v.zoomTo(); v.zoom(1.15); v.render();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) v.spin("y", 0.4);
    S.viewers.hero = v;
  }

  // ------------------------------------------------------------------ resultados: comparación
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  function b64ToBlob(b64, type) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }
  const slug = (s) => String(s).replace(/[^\w.+-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "molgc";

  function bondsCsv(res) {
    const labs = res.labels;
    const head = ["B", "atom1", "atom2", "i", "j", "ref_" + res.reference.label, ...labs.flatMap((l) => [l, "err_" + l])];
    const rows = res.bonds.map((b) => [b.B, b.atom1, b.atom2, b.i, b.j, b.ref, ...labs.flatMap((l) => [b[`len::${l}`] ?? "", b[`err::${l}`] ?? ""])]);
    const q = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    return [head, ...rows].map((r) => r.map(q).join(",")).join("\n");
  }

  function renderCompare(res, mode, scroll) {
    const out = $("#results");
    const ref = res.reference;
    const R = res.results;
    const isPair = R.length === 1;
    const title = isPair ? t("resPairTitle", { a: R[0].label, b: ref.label }) : t("resMultiTitle", { n: R.length, ref: ref.label });
    const allWarn = [...res.warnings, ...ref.warnings.map((w) => `${ref.label}: ${w}`), ...R.flatMap((r) => r.warnings.map((w) => `${r.label}: ${w}`))];
    const colorOf = {}; R.forEach((r, i) => (colorOf[r.label] = seriesColor(i)));

    const verifiedTxt = (r) => {
      const lc = r.label_check;
      if (!lc.atoms_checked) return t("none");
      const cls = lc.atoms_ok === lc.atoms_checked ? "ok" : "warn";
      return `<span class="${cls}">${t("ofTotal", { a: lc.atoms_ok, b: lc.atoms_checked })}</span>`;
    };

    let html = `<div class="res-head"><div><h2>${esc(title)}</h2>
      <p>${esc(t("resSub", { ref: ref.label, formula: ref.formula, nb: ref.n_bonds }))}</p></div>
      <div class="downloads">
        <button class="btn primary" type="button" data-dl="xlsx">${t("xlsx")}</button>
        <button class="ghost" type="button" data-dl="csv">${t("csv")}</button>
        <button class="ghost" type="button" data-dl="xyz">${t("xyz")}</button>
        <button class="ghost" type="button" data-dl="json">${t("json")}</button>
      </div></div>`;

    if (isPair) {
      const r = R[0];
      html += `<div class="card headline"><div><div class="big">${fmt(r.MAE, 4)}<small>Å</small></div>
        <div class="caption">MAE · ${esc(t("maeCaption", { n: r.n_matched }))}</div></div>
        <dl class="metrics">
          <div><dt>${t("mape")}</dt><dd>${fmt(r.MAPE, 3)} %</dd></div>
          <div><dt>${t("maxErr")}</dt><dd>${fmt(r.max_abs_error, 4)} Å</dd></div>
          <div><dt>${t("rmsdIcp")}</dt><dd>${fmt(r.RMSD_ICP, 4)} Å</dd></div>
          <div><dt>${t("rmsdM")}</dt><dd>${fmt(r.RMSD_matched, 4)} Å</dd></div>
          <div><dt>${t("matched")}</dt><dd>${t("ofTotal", { a: r.n_matched, b: ref.n_bonds })}</dd></div>
          <div><dt>${t("verified")}</dt><dd>${verifiedTxt(r)}</dd></div>
        </dl></div>`;
    } else {
      html += `<div class="card"><h3>${t("summaryTitle")}</h3><p class="sub">${t("summarySub")}</p>
        <div class="table-scroll"><table><thead><tr><th>${t("geometry")}</th><th>${t("software")}</th>
        <th class="num">MAE (Å)</th><th class="num">${t("mape")} (%)</th><th class="num">${t("maxErr")} (Å)</th>
        <th class="num">${t("rmsdIcp")} (Å)</th><th class="num">${t("rmsdM")} (Å)</th><th class="num">${t("matched")}</th><th class="num">${t("verified")}</th></tr></thead><tbody>
        ${R.map((r) => `<tr><td><span class="swatch" style="background:${colorOf[r.label]}"></span>${esc(r.label)}</td><td>${esc(r.software)}</td>
          <td class="num"><b>${fmt(r.MAE, 6)}</b></td><td class="num">${fmt(r.MAPE, 3)}</td><td class="num">${fmt(r.max_abs_error, 4)}</td>
          <td class="num">${fmt(r.RMSD_ICP, 5)}</td><td class="num">${fmt(r.RMSD_matched, 5)}</td>
          <td class="num">${t("ofTotal", { a: r.n_matched, b: ref.n_bonds })}</td><td class="num">${verifiedTxt(r)}</td></tr>`).join("")}
        </tbody></table></div></div>
        <div class="grid-2">
          <div class="card"><h3>${esc(t("chartMae", { ref: ref.label }))}</h3><div class="chart" id="chMae"></div></div>
          <div class="card"><h3>${esc(t("chartRmsd", { ref: ref.label }))}</h3><div class="chart" id="chRmsd"></div></div>
        </div>`;
    }

    if (R.some((r) => r.label_check.atoms_checked && r.label_check.atoms_ok < r.label_check.atoms_checked))
      html += `<p class="hint ver-note">${esc(t("verNote"))}</p>`;
    if (allWarn.length) html += `<div class="card warnings"><h3>${t("warnTitle")}</h3><ul>${allWarn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;

    html += `<div class="card"><h3>${t("viewerTitle")}</h3><p class="sub">${t("viewerSub")}</p>
      <div class="viewer-wrap"><div class="viewer res-viewer" id="resViewer"></div>
      <div class="viewer-side">
        ${isPair ? "" : `<label>${t("geometry")} <select id="vwSel">${R.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join("")}</select></label>`}
        <label><input type="checkbox" id="vwRef" checked> ${t("showRef")}</label>
        <label><input type="checkbox" id="vwLab"> ${t("showLabels")}</label>
        <label><input type="checkbox" id="vwSpin"> ${t("spin")}</label>
        <div><div class="hint">${t("errScale")}</div><div class="ramp" style="background:linear-gradient(90deg,${RAMP.join(",")})"></div>
        <div class="ramp-labels"><span>0</span><span id="vwMax"></span></div></div>
        <div class="bond-detail" id="vwDetail"><span class="muted">${t("hoverBond")}</span></div>
      </div></div></div>`;

    html += isPair
      ? `<div class="grid-2"><div class="card"><h3>${t("chartBonds")}</h3><p class="sub">${t("chartBondsSub")}</p><div class="chart" id="chBonds"></div></div>
         <div class="card"><h3>${t("chartPairs")}</h3><p class="sub">${t("chartPairsSub")}</p><div class="chart" id="chPairs"></div></div></div>`
      : `<div class="card"><h3>${t("heatTitle")}</h3><p class="sub">${t("heatSub")}</p><div class="chart" id="chHeat"></div></div>
         <div class="card"><h3>${t("chartPairs")}</h3><p class="sub">${t("chartPairsSub")}</p><div class="chart" id="chPairs"></div></div>`;

    const pairTypes = [...new Set(res.bonds.map((b) => b.pair))].sort();
    html += `<div class="card"><h3>${t("tableTitle")}</h3><p class="sub">${t("tableSub")}</p>
      <div class="table-tools"><input type="text" id="bfFilter" placeholder="${esc(t("filter"))}" aria-label="${esc(t("filter"))}">
      <select id="bfPair" aria-label="${esc(t("allPairs"))}"><option value="">${t("allPairs")}</option>${pairTypes.map((p) => `<option>${esc(p)}</option>`).join("")}</select></div>
      <div class="table-scroll bonds-table"><table id="bondsTable"></table></div></div>`;

    out.innerHTML = html;

    // descargas
    const base = slug(isPair ? `${ref.label}_vs_${R[0].label}` : `MolGC_${ref.label}`);
    $$("[data-dl]", out).forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.dl;
      if (k === "xlsx") download(`${base}.xlsx`, new Blob([MolGCXlsx.comparisonWorkbook(res)], { type: XLSX_MIME }));
      if (k === "csv") download(`${base}_enlaces.csv`, bondsCsv(res), "text/csv");
      if (k === "xyz") download(`${base}_alineadas.xyz`, Object.values(res.aligned_xyz).join(""), "chemical/x-xyz");
      if (k === "json") { const c = { ...res }; delete c.aligned_xyz; download(`${base}.json`, JSON.stringify(c, null, 1), "application/json"); }
    }));

    // gráficos
    if (!isPair) {
      const x = R.map((r) => r.label);
      plot($("#chMae"), [{ type: "bar", x, y: R.map((r) => r.MAE), marker: { color: x.map((l) => colorOf[l]) },
        text: R.map((r) => fmt(r.MAE, 4)), textposition: "outside", cliponaxis: false,
        hovertemplate: "%{x}<br>MAE = %{y:.6f} Å<extra></extra>" }], { yaxis: { ...plotLayout().yaxis, title: "MAE (Å)", rangemode: "tozero" }, showlegend: false });
      plot($("#chRmsd"), [{ type: "bar", x, y: R.map((r) => r.RMSD_ICP), marker: { color: x.map((l) => colorOf[l]) },
        text: R.map((r) => fmt(r.RMSD_ICP, 3)), textposition: "outside", cliponaxis: false,
        hovertemplate: "%{x}<br>RMSD ICP = %{y:.5f} Å<extra></extra>" }], { yaxis: { ...plotLayout().yaxis, title: "RMSD ICP (Å)", rangemode: "tozero" }, showlegend: false });
      const labsB = res.bonds.map((b) => `B${b.B}`);
      plot($("#chHeat"), [{ type: "heatmap", x: labsB, y: R.map((r) => r.label),
        z: R.map((r) => res.bonds.map((b) => (b[`err::${r.label}`] === null || b[`err::${r.label}`] === undefined ? null : Math.abs(b[`err::${r.label}`])))),
        customdata: R.map(() => res.bonds.map((b) => `${b.atom1}–${b.atom2} (${b.i}-${b.j})`)),
        colorscale: [[0, "#e9f1fc"], [0.25, "#9ec5f4"], [0.5, "#5598e7"], [0.75, "#1c5cab"], [1, "#0d366b"]],
        colorbar: { title: { text: "|ΔL| Å", side: "right" }, thickness: 12 }, xgap: 1, ygap: 1,
        hovertemplate: "%{y} · %{x} %{customdata}<br>|ΔL| = %{z:.5f} Å<extra></extra>" }],
        { margin: { l: 120, r: 16, t: 10, b: 60 }, xaxis: { ...plotLayout().xaxis, tickangle: -60, tickfont: { size: 10, color: css("--muted") } }, height: Math.max(260, 60 + 34 * R.length) });
    } else {
      const r = R[0];
      const rows = res.bonds.filter((b) => b[`err::${r.label}`] !== null && b[`err::${r.label}`] !== undefined);
      plot($("#chBonds"), [{ type: "bar", x: rows.map((b) => `B${b.B}`), y: rows.map((b) => b[`err::${r.label}`]),
        marker: { color: css("--s1") }, customdata: rows.map((b) => [`${b.atom1}–${b.atom2}`, b.ref, b[`len::${r.label}`]]),
        hovertemplate: "%{x} · %{customdata[0]}<br>L_ref = %{customdata[1]:.5f} Å<br>L = %{customdata[2]:.5f} Å<br>ΔL = %{y:.5f} Å<extra></extra>" }],
        { yaxis: { ...plotLayout().yaxis, title: "ΔL (Å)" }, xaxis: { ...plotLayout().xaxis, tickangle: -60, tickfont: { size: 10, color: css("--muted") } }, bargap: 0.25, showlegend: false });
    }
    plot($("#chPairs"), R.map((r, i) => ({ type: "bar", name: r.label, x: pairTypes, y: pairTypes.map((p) => (r.per_pair[p] ? r.per_pair[p].MAE : null)),
      marker: { color: seriesColor(i) }, customdata: pairTypes.map((p) => (r.per_pair[p] ? r.per_pair[p].n : 0)),
      hovertemplate: `${esc(r.label)} · %{x}<br>MAE = %{y:.5f} Å (n = %{customdata})<extra></extra>` })),
      { yaxis: { ...plotLayout().yaxis, title: "MAE (Å)", rangemode: "tozero" }, barmode: "group", showlegend: !isPair, bargap: 0.3, bargroupgap: 0.08 });

    // visor
    let current = 0;
    const draw = () => {
      const el = $("#resViewer");
      const v = makeViewer(el);
      if (!v) return;
      const r = R[current];
      const { map, max } = errLookup(res, r);
      $("#vwMax").textContent = max.toFixed(4);
      const ev = res.structures.find((s) => s.label === r.label);
      const rs = res.structures.find((s) => s.is_ref);
      if ($("#vwRef").checked) drawMolecule(v, rs, { color: css("--ref"), alpha: 0.33, radius: 0.1, atomScale: 0.2 });
      const detail = $("#vwDetail");
      drawMolecule(v, ev, {
        errOf: (lab) => (map[lab] ? { ...map[lab], norm: map[lab].abs / (max || 1) } : null),
        labels: $("#vwLab").checked,
        hover: (lab, on) => {
          const m = map[lab];
          if (!on || !m) return;
          const b = m.row;
          detail.innerHTML = `<b>B${b.B} · ${esc(b.atom1)}–${esc(b.atom2)}</b><br>
            L<sub>ref</sub> = ${fmt(b.ref, 5)} Å<br>L = ${fmt(b[`len::${r.label}`], 5)} Å<br>ΔL = <b>${fmt(m.err, 5)} Å</b>`;
          $$("#bondsTable tr.hl").forEach((x) => x.classList.remove("hl"));
          const tr = $(`#bondsTable tr[data-b="${b.B}"]`);
          if (tr) tr.classList.add("hl");
        },
      });
      v.zoomTo(); v.render();
      if ($("#vwSpin").checked) v.spin("y", 0.5);
      S.viewers.res = v;
    };
    if ($("#vwSel")) $("#vwSel").addEventListener("change", (e) => { current = +e.target.value; draw(); });
    ["#vwRef", "#vwLab", "#vwSpin"].forEach((s) => $(s).addEventListener("change", draw));
    draw();

    // tabla de enlaces
    renderBondTable(res);
    if (scroll) out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderBondTable(res) {
    const labs = res.labels;
    const R = res.results;
    let sortKey = "B", sortDir = 1;
    const cols = [
      { k: "B", h: "B", num: true }, { k: "pair", h: t("bond") }, { k: "idx", h: t("atomsIdx") },
      { k: "ref", h: `${esc(res.reference.label)} (ref)`, num: true },
      ...labs.flatMap((l) => [{ k: `len::${l}`, h: `${esc(l)}`, num: true }, { k: `err::${l}`, h: `ΔL ${esc(l)}`, num: true, err: l }]),
    ];
    const maxErr = Math.max(1e-9, ...res.bonds.flatMap((b) => labs.map((l) => Math.abs(b[`err::${l}`] || 0))));
    const draw = () => {
      const q = ($("#bfFilter").value || "").trim().toLowerCase();
      const pf = $("#bfPair").value;
      let rows = res.bonds.filter((b) => (!pf || b.pair === pf) &&
        (!q || `b${b.B} ${b.pair} ${b.atom1}${b.atom2} ${b.i}-${b.j}`.toLowerCase().includes(q)));
      const val = (b, k) => (k === "idx" ? b.i * 1000 + b.j : b[k]);
      rows = rows.slice().sort((a, b) => {
        const x = val(a, sortKey), y = val(b, sortKey);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (sortKey.startsWith("err::") ? Math.abs(x) - Math.abs(y) : (x < y ? -1 : 1)) * sortDir;
      });
      const th = cols.map((c) => `<th class="${c.num ? "num" : ""}" data-k="${esc(c.k)}" ${c.k === sortKey ? `aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : ""} tabindex="0">${c.h}</th>`).join("");
      const body = rows.map((b) => `<tr data-b="${b.B}">${cols.map((c) => {
        if (c.k === "idx") return `<td>${b.i}–${b.j}</td>`;
        if (c.k === "pair") return `<td>${esc(b.atom1)}–${esc(b.atom2)}</td>`;
        const v = b[c.k];
        if (c.err) {
          if (v === null || v === undefined) return `<td class="num warn">${t("unmatched")}</td>`;
          const chk = b[`chk::${c.err}`];
          const flag = chk && chk.atoms === false ? ` <span class="warn chk" title="${S.lang === "en" ? "atoms differ" : "átomos distintos"}">!</span>` : "";
          const a = Math.min(1, Math.abs(v) / maxErr);
          return `<td class="num heat" style="background:color-mix(in srgb, ${rampColor(a)} ${Math.round(15 + 55 * a)}%, transparent)">${fmt(v, 5)}${flag}</td>`;
        }
        return `<td class="num">${v === null || v === undefined ? "—" : (c.k === "B" ? v : fmt(v, 5))}</td>`;
      }).join("")}</tr>`).join("");
      $("#bondsTable").innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`;
      $$("#bondsTable th").forEach((h) => {
        const go = () => { const k = h.dataset.k; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = 1; } draw(); };
        h.addEventListener("click", go);
        h.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      });
    };
    $("#bfFilter").addEventListener("input", draw);
    $("#bfPair").addEventListener("change", draw);
    draw();
  }

  // ------------------------------------------------------------------ resultados: estudio
  function renderStudy(st, scroll) {
    const out = $("#results");
    const F = st.functionals, FAM = st.families;
    const sum = st.summary || { n_geometries: "?", n_molecules: st.per_molecule.length };
    let html = `<div class="res-head"><div><h2>${esc(t("studyTitle", { ref: st.reference }))}</h2>
      <p>${esc(t("studySub", { m: st.per_molecule.length, f: FAM.length, g: sum.n_geometries }))}</p></div>
      <div class="downloads"><button class="btn primary" type="button" data-dl="xlsx">${t("xlsx")}</button>
      <button class="ghost" type="button" data-dl="json">${t("json")}</button></div></div>`;
    if (st.topsis.length) {
      html += `<div class="grid-2"><div class="card"><h3>${t("topsisTitle")}</h3><p class="sub">${t("topsisSub")}</p>
        <div class="table-scroll"><table><thead><tr><th>${t("rank")}</th><th>${t("functional")}</th><th class="num">${t("closeness")}</th>
        <th class="num">${t("dIdeal")}</th><th class="num">${t("dAnti")}</th></tr></thead><tbody>
        ${st.topsis.map((r) => `<tr><td class="topsis-rank">${r.rank}</td><td>${esc(r.functional)}</td><td class="num"><b>${fmt(r.closeness, 4)}</b></td>
          <td class="num">${fmt(r.d_ideal, 4)}</td><td class="num">${fmt(r.d_anti_ideal, 4)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card"><h3>${t("overallChart")}</h3><div class="chart" id="chOverall"></div></div></div>`;
    } else {
      html += `<div class="card"><h3>${t("overallChart")}</h3><div class="chart" id="chOverall"></div></div>`;
    }
    html += `<div class="card"><h3>${t("famChart")}</h3><p class="sub">${t("famChartSub")}</p><div class="chart" id="chFam"></div></div>`;
    const vals = st.per_molecule.flatMap((r) => F.map((f) => r[f]).filter((v) => v !== null && v !== undefined));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    html += `<div class="card"><h3>${t("perMol")}</h3><p class="sub">${t("perMolSub")}</p><div class="table-scroll"><table>
      <thead><tr><th>${t("family")}</th><th>${t("molecule")}</th><th class="num">${t("bonds")}</th>${F.map((f) => `<th class="num">${esc(f)}</th>`).join("")}</tr></thead><tbody>
      ${st.per_molecule.map((r) => `<tr><td>${esc(r.family)}</td><td>${esc(r.molecule)}</td><td class="num">${r.n_bonds}</td>${F.map((f) => {
        const v = r[f];
        if (v === null || v === undefined) return `<td class="num">—</td>`;
        const a = hi > lo ? (v - lo) / (hi - lo) : 0;
        return `<td class="num heat" style="background:color-mix(in srgb, ${rampColor(a)} ${Math.round(12 + 50 * a)}%, transparent)">${fmt(v, 5)}</td>`;
      }).join("")}</tr>`).join("")}
      <tr>${`<td colspan="3"><b>${t("average")}</b></td>`}${F.map((f) => `<td class="num"><b>${fmt(st.overall_mae[f], 5)}</b></td>`).join("")}</tr>
      </tbody></table></div></div>`;
    if (st.warnings.length) html += `<div class="card warnings"><h3>${t("warnTitle")}</h3><ul>${st.warnings.slice(0, 60).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
    out.innerHTML = html;

    $$("[data-dl]", out).forEach((b) => b.addEventListener("click", () => {
      const base = slug(`MolGC_estudio_${st.reference}`);
      if (b.dataset.dl === "xlsx") download(`${base}.xlsx`, new Blob([MolGCXlsx.studyWorkbook(st)], { type: XLSX_MIME }));
      else { const c = { ...st }; download(`${base}.json`, JSON.stringify(c, null, 1), "application/json"); }
    }));
    const order = F.slice().sort((a, b) => (st.overall_mae[a] ?? 9) - (st.overall_mae[b] ?? 9));
    const colorF = {}; F.forEach((f, i) => (colorF[f] = seriesColor(i)));
    plot($("#chOverall"), [{ type: "bar", x: order, y: order.map((f) => st.overall_mae[f]), marker: { color: order.map((f) => colorF[f]) },
      text: order.map((f) => fmt(st.overall_mae[f], 4)), textposition: "outside", cliponaxis: false,
      hovertemplate: "%{x}<br>MAE = %{y:.6f} Å<extra></extra>" }], { yaxis: { ...plotLayout().yaxis, title: "MAE (Å)", rangemode: "tozero" }, showlegend: false });
    plot($("#chFam"), FAM.map((fam, i) => ({ type: "bar", name: fam, x: order, y: order.map((f) => st.family_mae[fam][f]),
      marker: { color: seriesColor(i) }, hovertemplate: `${esc(fam)} · %{x}<br>MAE = %{y:.6f} Å<extra></extra>` })),
      { barmode: "group", yaxis: { ...plotLayout().yaxis, title: "MAE (Å)", rangemode: "tozero" }, bargap: 0.25, bargroupgap: 0.08 });
    if (scroll) out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function rerender(scroll) {
    if (!S.last) return;
    if (S.last.type === "compare") renderCompare(S.last.data, S.last.mode, scroll);
    else renderStudy(S.last.data, scroll);
  }

  // ------------------------------------------------------------------ tabla de umbrales
  async function loadInfo() {
    try {
      const r = await Engine.call("info", {});
      $("#version").textContent = "v" + r.version;
      $("#bondTable").innerHTML = `<table><tbody>${r.bond_table.map((x) => `<tr><td>${esc(x.pair)}</td><td class="num">${x.dist.toFixed(5)}</td></tr>`).join("")}</tbody></table>`;
    } catch (e) { /* opcional */ }
  }

  // ------------------------------------------------------------------ init
  function init() {
    setupTabs();
    $$(".lang button").forEach((b) => b.addEventListener("click", () => applyLang(b.dataset.lang)));
    $("#themeBtn").addEventListener("click", () => applyTheme(currentDark() ? "light" : "dark"));
    const th = store.get("molgc.theme"); if (th) applyTheme(th);

    $$("#panel-pair .slot").forEach((slot) => setupDrop($(".drop", slot), (files) => setPair(+slot.dataset.slot, { kind: "upload", file: files[0] })));
    $('#panel-pair [data-action="swap"]').addEventListener("click", () => { S.pair.reverse(); renderPairSlots(); });
    $("#runPair").addEventListener("click", runPair);

    setupDrop($("#panel-multi .drop"), (files) => addMulti(files.map((file) => ({ kind: "upload", file }))));
    $("#clearMulti").addEventListener("click", () => { S.multi = []; S.multiRef = 0; renderMulti(); });
    $("#runMulti").addEventListener("click", runMulti);
    $("#multiExample").addEventListener("change", (e) => {
      const set = S.demoSets && S.demoSets.multi.find((m) => m.id === e.target.value);
      if (!set) return;
      S.multi = []; S.multiRef = 0;
      addMulti(set.files.map((f) => ({ kind: "demo", path: f.name, url: f.url })));
    });

    setupDrop($("#studyDrop"), (files) => { S.study = { file: files[0], demo: false, scan: null }; scanStudy(); });
    $("#studyDemo").addEventListener("click", () => { S.study = { file: null, demo: true, scan: null }; scanStudy(); });
    $("#studyRef").addEventListener("change", updateButtons);
    $("#runStudy").addEventListener("click", runStudy);

    $("#copyCite").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#citation").innerText); setStatus(null); $("#copyCite").textContent = t("copied"); } catch (e) { /* sin portapapeles */ }
    });

    let lang = store.get("molgc.lang");
    if (!lang) lang = (navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en";
    applyLang(lang);
    loadInfo();
    loadDemoSets();
    loadHero();
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { Object.values(S.viewers).forEach((v) => { try { v.resize(); } catch (e) { /* */ } }); }, 150); });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) { if (S.last) rerender(); if (S.hero) drawHero(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
