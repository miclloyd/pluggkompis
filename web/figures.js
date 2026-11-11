// Originalsidor och bilder ur PDF-material. Sidan ritas upp från den sparade PDF:en vid behov,
// och pdf.js operatorlista ger var bilderna ligger på sidan, så att varje "Bild:" i texten kan
// visa just den bilden ur originalet.
import { loadScript } from './lib.js';

const docs = new Map();  // assetId -> Promise<PDFDocumentProxy>
const pages = new Map(); // assetId:p -> Promise<{ url, width, height, figures }>

async function pdfjs(libs) {
  await loadScript(libs.pdfjs);
  await loadScript(libs.pdfjsWorker);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = libs.pdfjsWorker;
  return window.pdfjsLib;
}

function getDoc(files, libs, assetId) {
  if (!docs.has(assetId)) {
    const p = (async () => {
      const lib = await pdfjs(libs);
      const res = await fetch(files.urlFor(assetId));
      if (!res.ok) throw new Error('Originalfilen kunde inte hämtas.');
      return lib.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
    })();
    p.catch(() => docs.delete(assetId));
    docs.set(assetId, p);
  }
  return docs.get(assetId);
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Bildernas lägen som andelar av sidan (0–1), uppifrån och ned. Små bilder (ikoner, linjer) räknas inte.
export async function imageRects(page, lib) {
  const OPS = lib.OPS;
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter(x => x != null));
  const ops = await page.getOperatorList();
  const vp = page.getViewport({ scale: 1 });
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const rects = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintFormXObjectBegin && ops.argsArray[i]?.[0]) { stack.push(ctm); ctm = mul(ctm, ops.argsArray[i][0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (paint.has(fn)) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const r = { x: Math.min(...xs) / vp.width, y: Math.min(...ys) / vp.height, w: (Math.max(...xs) - Math.min(...xs)) / vp.width, h: (Math.max(...ys) - Math.min(...ys)) / vp.height };
      if (r.w * r.h > 0.01 && r.w > 0.08 && r.h > 0.05) rects.push(r);
    }
  }
  // Samma bild kan ritas flera gånger på samma plats: behåll en.
  const uniq = rects.filter((r, i) => !rects.slice(0, i).some(o => Math.abs(o.x - r.x) < 0.01 && Math.abs(o.y - r.y) < 0.01));
  return uniq.sort((a, b) => a.y - b.y || a.x - b.x);
}

// Ritar en sida ur PDF:en som bild och tar fram bildernas lägen. Resultatet sparas i minnet.
export function pdfPage({ files, libs, assetId, p }) {
  const key = `${assetId}:${p}`;
  if (!pages.has(key)) {
    const job = (async () => {
      const lib = await pdfjs(libs);
      const doc = await getDoc(files, libs, assetId);
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 2000 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const figures = await imageRects(page, lib).catch(() => []);
      // Var texten står, så att bilder kan placeras vid rätt begrepp.
      const tc = await page.getTextContent().catch(() => ({ items: [] }));
      const text = tc.items.filter(it => it.str && it.str.trim()).map(it => {
        const [, y] = base.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { s: it.str.toLowerCase(), y: (y - (it.height || 0)) / base.height };
      });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, figures, text };
    })();
    job.catch(() => pages.delete(key));
    pages.set(key, job);
  }
  return pages.get(key);
}
