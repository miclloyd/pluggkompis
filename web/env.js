// Väljer adapters på ett ställe utifrån miljön. Ingen annan kod sniffar fram funktioner.
// Resultat: { config: { env, features, libs }, ai, store, files }
import { createArtifactAdapters } from './adapters/artifact.js';
import { createServerAdapters } from './adapters/server.js';
import { memoryStore } from './adapters/memory.js';

export async function loadEnvironment() {
  if (window.claude && typeof window.claude.use === 'function') {
    return createArtifactAdapters();
  }
  try {
    const r = await fetch('/api/config', { credentials: 'same-origin' });
    if (r.ok) return createServerAdapters(await r.json());
  } catch { /* ingen server: fall vidare */ }
  return {
    config: { env: 'local', features: { ai: false, images: false, persistent: false, files: false }, libs: {} },
    ai: null,
    store: memoryStore(),
    files: null,
    save: null,
  };
}
