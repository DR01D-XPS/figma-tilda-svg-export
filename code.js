// Root-based export tailored for: top-level root frames like "Ноут"/"итог" containing screen frames "1..7".
// Fixes:
// - Safe handling of mixed text props (figma.mixed is a Symbol) to avoid runtime TypeError
// - Safer UTF-8 decode (TextDecoder fallback)
// - Removed "leaf-only" filter (screens often contain nested frames)

figma.showUI(__html__, { width: 460, height: 600 });

const BP_SUFFIX = { D: "__D", T: "__T", M: "__M" };

function isFrameLike(node) {
  return node && (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE");
}

function getTopLevelFrames() {
  return figma.currentPage.children.filter(isFrameLike);
}

function findRootFrameByName(rootName) {
  const top = getTopLevelFrames();
  return top.find(n => n.name.trim() === rootName.trim()) || null;
}

function collectFramesDeep(node, out = []) {
  if (!node) return out;
  if ("children" in node && Array.isArray(node.children)) {
    for (const ch of node.children) {
      if (isFrameLike(ch)) out.push(ch);
      collectFramesDeep(ch, out);
    }
  }
  return out;
}

function sortByPosition(frames) {
  frames.sort((a, b) => {
    const ay = a.absoluteBoundingBox?.y ?? 0;
    const by = b.absoluteBoundingBox?.y ?? 0;
    if (ay !== by) return ay - by;
    const ax = a.absoluteBoundingBox?.x ?? 0;
    const bx = b.absoluteBoundingBox?.x ?? 0;
    return ax - bx;
  });
  return frames;
}

function parseName(name) {
  for (const bp of ["D", "T", "M"]) {
    if (name.endsWith(BP_SUFFIX[bp])) return { base: name.slice(0, -BP_SUFFIX[bp].length), bp };
  }
  return { base: name, bp: "D" };
}

function groupFrames(frames) {
  const groups = {};
  frames.forEach((fr) => {
    const p = parseName(fr.name);
    groups[p.base] = groups[p.base] || { base: p.base, D: null, T: null, M: null };
    groups[p.base][p.bp] = fr;
  });
  return Object.values(groups);
}

function nodeAbsBox(node) {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function safeObjVal(v) {
  if (!v) return null;
  if (typeof v === "symbol") return null;
  if (typeof v === "object") return v;
  return null;
}

function safeNumber(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

function safeFontName(fontName) {
  if (!fontName) return null;
  if (typeof fontName === "symbol") return null;
  if (typeof fontName === "string") return fontName;
  if (typeof fontName === "object" && fontName.family) return fontName.family;
  return null;
}

function colorToRgba(fill) {
  if (!fill || !fill.color) return null;
  const c = fill.color;
  const a = typeof fill.opacity === "number" ? fill.opacity : 1;
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r},${g},${b},${a})`;
}

function readTextNode(tn, frameBox) {
  const box = nodeAbsBox(tn);
  if (!box || !frameBox) return null;

  const relX = box.x - frameBox.x;
  const relY = box.y - frameBox.y;

  let fill = null;
  try {
    if (Array.isArray(tn.fills) && tn.fills[0]) fill = tn.fills[0];
  } catch (_) {}

  const lh = safeObjVal(tn.lineHeight);
  const ls = safeObjVal(tn.letterSpacing);

  return {
    id: tn.id,
    name: tn.name,
    text: tn.characters || "",
    x: relX,
    y: relY,
    w: box.w,
    h: box.h,
    fontFamily: safeFontName(tn.fontName) || "inherit",
    fontSize: safeNumber(tn.fontSize),
    fontWeight: safeNumber(tn.fontWeight) || (typeof tn.fontWeight === "string" ? tn.fontWeight : null),
    lineHeight: lh && typeof lh.value === "number" ? lh.value : null,
    letterSpacing: ls && typeof ls.value === "number" ? ls.value : null,
    alignH: tn.textAlignHorizontal || "LEFT",
    alignV: tn.textAlignVertical || "TOP",
    color: colorToRgba(fill),
    opacity: typeof tn.opacity === "number" ? tn.opacity : 1
  };
}

function removeAllTextNodes(node) {
  const texts = node.findAllWithCriteria({ types: ["TEXT"] });
  texts.forEach((t) => t.remove());
}

function bytesToUtf8(bytes) {
  try {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {}

  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch (_) {
    return s;
  }
}

async function exportSvgNoText(frame) {
  const clone = frame.clone();
  clone.x = frame.x + frame.width + 2000;
  clone.y = frame.y;
  figma.currentPage.appendChild(clone);

  removeAllTextNodes(clone);

  const bytes = await clone.exportAsync({ format: "SVG" });
  clone.remove();

  return bytesToUtf8(bytes);
}

function collectTexts(frame) {
  const fb = nodeAbsBox(frame);
  if (!fb) return { frame: null, texts: [] };

  const texts = frame.findAllWithCriteria({ types: ["TEXT"] });
  const out = [];
  texts.forEach((tn) => {
    const t = readTextNode(tn, fb);
    if (t) out.push(t);
  });

  return { frame: { name: frame.name, w: frame.width, h: frame.height }, texts: out };
}

function sanitizeKey(s) {
  return (s || "")
    .trim()
    .replace(/[^\w\d\-А-Яа-я_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function genSectionHtml(base, variants) {
  const hasT = !!variants.T;
  const hasM = !!variants.M;

  return `
<section class="ta-sec" data-frame="${base}">
  <div class="ta-stage">
    <picture class="ta-media">
      ${hasM ? `<source media="(max-width: 640px)" data-asset="${base}__M">` : ``}
      ${hasT ? `<source media="(max-width: 960px)" data-asset="${base}__T">` : ``}
      <img class="ta-bg" alt="" data-asset="${base}__D" />
    </picture>

    <div class="ta-overlay"
      data-w-d="${variants.D.w}" data-h-d="${variants.D.h}"
      ${hasT ? `data-w-t="${variants.T.w}" data-h-t="${variants.T.h}"` : ``}
      ${hasM ? `data-w-m="${variants.M.w}" data-h-m="${variants.M.h}"` : ``}
    >
      <div class="ta-layer">
        ${variants.D.texts.map((t) => {
          const style = [
            `left:${t.x}px`,
            `top:${t.y}px`,
            `width:${t.w}px`,
            `height:${t.h}px`,
            t.color ? `color:${t.color}` : "",
            t.fontFamily ? `font-family:${JSON.stringify(t.fontFamily)}` : "",
            t.fontSize ? `font-size:${t.fontSize}px` : "",
            t.fontWeight ? `font-weight:${t.fontWeight}` : "",
            t.lineHeight ? `line-height:${t.lineHeight}px` : "",
            t.letterSpacing ? `letter-spacing:${t.letterSpacing}px` : "",
            `text-align:${(t.alignH || "LEFT").toLowerCase()}`,
            `opacity:${t.opacity}`
          ].filter(Boolean).join(";");

          const txt = (t.text || "")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br/>");

          return `<div class="ta-text" style="${style}">${txt}</div>`;
        }).join("\n        ")}
      </div>
    </div>
  </div>
</section>
`.trim();
}

function genStylesCss() {
  return `
/* Exported styles (Tilda HTML block) */
.ta-sec { width: 100%; }
.ta-stage { position: relative; width: 100%; }
.ta-media, .ta-media img { display:block; width:100%; height:auto; }

.ta-overlay { position:absolute; inset:0; pointer-events:none; }

.ta-layer {
  position:absolute; left:0; top:0;
  transform-origin: 0 0;
  transform: scale(var(--ta-k, 1));
  width: var(--ta-w, 1440px);
  height: var(--ta-h, 900px);
}

.ta-text { position:absolute; white-space: normal; overflow: visible; }
`.trim();
}

function genScriptJs(assetKeysToFiles) {
  return `
(function () {
  window.tildaAssist = window.tildaAssist || {};
  if (window.tildaAssist.svgLongreadInited) return;
  window.tildaAssist.svgLongreadInited = true;

  // 1) Upload exported /assets/*.svg to Tilda Files
  // 2) Replace values below with real Tilda URLs (keep keys unchanged)
  const ASSETS = {
${Object.keys(assetKeysToFiles).sort().map(k => `    "${k}": ""`).join(",\n")}
  };

  function setPictureAssets() {
    document.querySelectorAll("[data-asset]").forEach((el) => {
      const key = el.getAttribute("data-asset");
      const url = ASSETS[key];
      if (!url) return;

      if (el.tagName === "IMG") el.src = url;
      if (el.tagName === "SOURCE") el.srcset = url;
    });
  }

  function currentVariant(overlay) {
    const w = window.innerWidth;
    if (w <= 640 && overlay.dataset.wM) return { w: +overlay.dataset.wM, h: +overlay.dataset.hM };
    if (w <= 960 && overlay.dataset.wT) return { w: +overlay.dataset.wT, h: +overlay.dataset.hT };
    return { w: +overlay.dataset.wD, h: +overlay.dataset.hD };
  }

  function rescale() {
    document.querySelectorAll(".ta-overlay").forEach((overlay) => {
      const v = currentVariant(overlay);
      const stage = overlay.closest(".ta-stage");
      if (!stage) return;

      const containerW = stage.clientWidth || v.w;
      const k = containerW / v.w;

      overlay.style.setProperty("--ta-k", String(k));
      overlay.style.setProperty("--ta-w", v.w + "px");
      overlay.style.setProperty("--ta-h", v.h + "px");
    });
  }

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  onReady(function () {
    setPictureAssets();
    rescale();
    window.addEventListener("resize", rescale, { passive: true });
  });
})();
`.trim();
}

function buildTildaInstructions(rootName) {
  return `
TILDA вставка (без API)
======================

1) SVG
- Tilda → Site Settings → Files
- залей все файлы из папки assets/

2) CSS
- Page → Settings → Additional HTML → HEAD
- вставь styles.css в <style>...</style>

3) HTML
- Добавь блок T123 (HTML)
- вставь sections.html (как есть)

4) JS
- Page → Settings → Additional HTML → Before </body>
- вставь script.js в <script>...</script>
- заполни объект ASSETS (вставь URL на SVG из Tilda Files)

Root выбран: ${rootName}
`.trim();
}

function pickExportFrames(opts) {
  const root = findRootFrameByName(opts.rootName);
  let frames = [];

  if (root) frames = collectFramesDeep(root, []);
  else frames = getTopLevelFrames();

  frames = frames.filter(fr => fr !== root);

  if (opts.onlyNumeric) {
    const re = /^\d+(?:__(?:D|T|M))?$/;
    frames = frames.filter(fr => re.test(fr.name.trim()));
  }

  return sortByPosition(frames);
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "INIT") {
    const top = getTopLevelFrames().map(n => n.name);
    figma.ui.postMessage({ type: "INIT_DATA", topFrames: top });
    return;
  }

  if (msg.type !== "EXPORT") return;

  const opts = {
    rootName: msg.rootName || "",
    onlyNumeric: !!msg.onlyNumeric,
    prefixRoot: !!msg.prefixRoot
  };

  const frames = pickExportFrames(opts);
  if (!frames.length) {
    figma.ui.postMessage({ type: "ERROR", text: "Не найдено экспортируемых фреймов. Проверь Root и галку 'только 1..7'." });
    return;
  }

  const groups = groupFrames(frames);

  figma.ui.postMessage({ type: "PROGRESS", text: `Root: ${opts.rootName || "(top-level)"} | groups: ${groups.length}` });

  const files = [];
  const tildaSections = [];
  const index = [];
  const assetKeysToFiles = {};

  const rootPrefix = opts.prefixRoot && opts.rootName ? sanitizeKey(opts.rootName) + "_" : "";

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const variants = { D: null, T: null, M: null };

    for (const bp of ["D", "T", "M"]) {
      const fr = g[bp];
      if (!fr) continue;

      const baseKey = sanitizeKey(rootPrefix + g.base);
      const keyWithBp = `${baseKey}${BP_SUFFIX[bp]}`;

      figma.ui.postMessage({ type: "PROGRESS", text: `Export ${keyWithBp} (${i + 1}/${groups.length})` });

      const svg = await exportSvgNoText(fr);
      const textJson = collectTexts(fr);

      const svgName = `${keyWithBp}.svg`;
      const jsonName = `${keyWithBp}.texts.json`;

      files.push({ path: `assets/${svgName}`, content: svg });
      files.push({ path: `data/${jsonName}`, content: JSON.stringify(textJson, null, 2) });

      variants[bp] = { w: fr.width, h: fr.height, texts: textJson.texts };

      index.push({
        sourceFrameName: fr.name,
        base: baseKey,
        bp,
        svg: `assets/${svgName}`,
        json: `data/${jsonName}`
      });

      assetKeysToFiles[keyWithBp] = `assets/${svgName}`;
    }

    if (variants.D) {
      const baseKey = sanitizeKey(rootPrefix + g.base);
      tildaSections.push(genSectionHtml(baseKey, variants));
    }
  }

  files.push({ path: "sections.html", content: tildaSections.join("\n\n") });
  files.push({ path: "styles.css", content: genStylesCss() });
  files.push({ path: "script.js", content: genScriptJs(assetKeysToFiles) });
  files.push({ path: "index.json", content: JSON.stringify(index, null, 2) });
  files.push({ path: "assets_manifest.json", content: JSON.stringify(assetKeysToFiles, null, 2) });
  files.push({ path: "TILDA_README.txt", content: buildTildaInstructions(opts.rootName || "(top-level)") });

  figma.ui.postMessage({ type: "DONE", files });
};
