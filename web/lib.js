// Enda stället som känner till hur biblioteken laddas.
// Artifact: htm + Preact (standalone UMD) från cdnjs via <script> i index.html.
// Server: samma fil, men index.html pekar på pinnade lokala kopior (fetchurl i Nix).
const L = window.htmPreact;
if (!L) throw new Error('Biblioteket htmPreact kunde inte laddas.');

export const {
  html, render, useState, useEffect, useRef, useMemo, useCallback, useReducer,
} = L;

const loaded = new Map();
// Laddar ett bibliotek vid behov (pdf.js, JSZip, jsPDF). Basen sätts av miljön.
// integrity: SRI-hash när den finns, så att en ändrad fil på CDN:en inte körs.
export function loadScript(src, integrity) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Kunde inte ladda ' + src));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}
