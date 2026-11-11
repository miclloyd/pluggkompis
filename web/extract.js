// Läser uppladdade filer lokalt i webbläsaren: text per sida, och sidbilder där AI:n behöver se sidan.
import { loadScript } from './lib.js';

const INVISIBLE = /[​-‍﻿‪-‮⁦-⁩­]/g;

export function cleanText(s) {
  return String(s || '')
    .replace(INVISIBLE, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fileKind(file) {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pptx')) return 'pptx';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/.test(n)) return 'image';
  if (file.type.startsWith('text/') || /\.(txt|md)$/.test(n)) return 'text';
  return null;
}

async function canvasToJpeg(canvas, quality = 0.72) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Kunde inte skapa bild'))), 'image/jpeg', quality));
}

// Skalar ned ett foto till högst maxSide pixlar och gör om till JPEG.
export async function imageToJpeg(file, maxSide = 1600) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`Bilden "${file.name}" kunde inte öppnas. Spara den som JPEG eller PNG och försök igen.`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return canvasToJpeg(c, 0.8);
}

async function readPdf(file, libs, onProgress) {
  await loadScript(libs.pdfjs);
  await loadScript(libs.pdfjsWorker); // körs i huvudtråden i artifacten
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = libs.pdfjsWorker;
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`Läser sida ${i} av ${doc.numPages}`);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let raw = '';
    for (const it of tc.items) raw += (it.str || '') + (it.hasEOL ? '\n' : ' ');
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1100 / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ p: i, raw: cleanText(raw), image: await canvasToJpeg(canvas) });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

async function readZipXml(file, libs) {
  await loadScript(libs.jszip);
  return window.JSZip.loadAsync(await file.arrayBuffer());
}

function paragraphsFromXml(xmlText, pTag, tTag) {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const out = [];
  for (const p of xml.getElementsByTagName(pTag)) {
    const t = Array.from(p.getElementsByTagName(tTag)).map(n => n.textContent).join('');
    if (t.trim()) out.push(t);
  }
  return out.join('\n');
}

async function readDocx(file, libs) {
  const zip = await readZipXml(file, libs);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error(`"${file.name}" ser inte ut som ett Word-dokument.`);
  return [{ p: 1, raw: cleanText(paragraphsFromXml(await doc.async('string'), 'w:p', 'w:t')) }];
}

async function readPptx(file, libs) {
  const zip = await readZipXml(file, libs);
  const slides = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!slides.length) throw new Error(`"${file.name}" innehåller inga bilder att läsa.`);
  const pages = [];
  for (const [i, name] of slides.entries()) {
    pages.push({ p: i + 1, raw: cleanText(paragraphsFromXml(await zip.file(name).async('string'), 'a:p', 'a:t')) });
  }
  return pages;
}

// Returnerar { kind, pages:[{p, raw, image?}], needsAi }.
// needsAi: sidorna behöver tolkas av AI (PDF och foton). Word, PowerPoint och text är redan ren text.
export async function readFile(file, libs, onProgress) {
  const kind = fileKind(file);
  if (!kind) throw new Error(`Filtypen för "${file.name}" stöds inte. Använd PDF, Word, PowerPoint, text eller foton.`);
  if (kind === 'pdf') return { kind, pages: await readPdf(file, libs, onProgress), needsAi: true };
  if (kind === 'image') return { kind, pages: [{ p: 1, raw: '', image: await imageToJpeg(file) }], needsAi: true };
  if (kind === 'docx') return { kind, pages: await readDocx(file, libs), needsAi: false };
  if (kind === 'pptx') return { kind, pages: await readPptx(file, libs), needsAi: false };
  return { kind, pages: [{ p: 1, raw: cleanText(await file.text()) }], needsAi: false };
}
