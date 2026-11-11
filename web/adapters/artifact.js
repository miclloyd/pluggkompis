// Adapters för artifact-miljön på claude.ai: sample (AI), db (lagring), assets (filer).
import { memoryStore } from './memory.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';

export async function createArtifactAdapters() {
  const use = name => window.claude.use(name).catch(() => null);
  const [sample, db, assets, downloads] = await Promise.all([use('sample'), use('db'), use('assets'), use('downloads')]);
  const limits = sample ? await sample.limits().catch(() => null) : null;

  const config = {
    env: 'artifact',
    features: {
      ai: !!sample,
      images: !!limits?.images,
      imageMaxCount: limits?.images?.maxCount || 0,
      maxPromptBytes: limits?.maxPromptBytes || 200000,
      persistent: !!db,
      files: !!assets,
      save: !!downloads,
      tts: false,        // fas 2
      dictation: false,  // fas 2
      pdfViaApi: false,  // bara på servern
    },
    libs: {
      pdfjs: `${CDN}/pdf.js/3.11.174/pdf.min.js`,
      pdfjsWorker: `${CDN}/pdf.js/3.11.174/pdf.worker.min.js`,
      jszip: `${CDN}/jszip/3.10.1/jszip.min.js`,
      // jsPDF 4.2.1 (minst 4.2.0 för rättade sårbarheter), samma fil som i npm-paketet, låst med hash.
      jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
      sri: { jspdf: 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3' },
    },
  };

  const ai = sample ? {
    async complete({ prompt, images, tier = 'default', json = false, signal, onText }) {
      const opts = { modelTier: tier };
      if (images?.length) opts.images = images;
      if (signal) opts.signal = signal;
      if (onText) opts.onText = onText;
      try {
        if (json) return { json: await sample.json(prompt, opts) };
        const r = await sample(prompt, opts);
        return { text: r.text, truncated: r.truncated };
      } catch (e) {
        throw new AiError(e?.code || 'upstream_error', e?.text);
      }
    },
  } : null;

  return {
    config,
    ai,
    store: db ? dbStore(db) : memoryStore(),
    files: assets ? assetFiles(assets) : null,
    // Ge barnet/föräldern en fil. Plattformen frågar alltid först; ett nej är inget fel.
    save: downloads ? async (filename, data) => {
      try { await downloads.save({ filename, data }); return 'saved'; } catch (e) {
        if (e?.code === 'declined') return 'declined';
        throw new Error(e?.code === 'rate_limited' ? 'Vänta en stund och försök igen.' : 'Filen kunde inte sparas här.');
      }
    } : null,
  };
}

function dbStore(db) {
  const wrap = async fn => {
    try { return await fn(); } catch (e) { throw new StoreError(e?.code || 'unavailable'); }
  };
  return {
    get: path => wrap(async () => {
      const s = await db.doc(path).get();
      return s.exists ? { id: s.id, ...s.data() } : null;
    }),
    set: (path, doc) => wrap(() => db.doc(path).set(doc)),
    update: (path, patch) => wrap(() => db.doc(path).update(patch)),
    delete: path => wrap(() => db.doc(path).delete()),
    list: collection => wrap(async () => {
      const snap = await db.collection(collection).limit(1000).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }),
  };
}

function assetFiles(assets) {
  return {
    async put(blob) {
      const r = await assets.upload(blob);
      return { id: r.id, url: r.url };
    },
    async delete(id) {
      await assets.delete(id);
    },
    urlFor: id => `/_blob/${id}`,
  };
}

const AI_MESSAGES = {
  not_granted: 'Pluggkompis har inte fått använda Claude. Tillåt det i dialogen när den visas, eller under artifactens behörigheter.',
  sampling_disabled: 'Claude är inte tillgängligt för det här kontot.',
  rate_limited: 'Användningsgränsen är nådd just nu. Vänta en stund och försök igen.',
  session_expired: 'Du behöver logga in på claude.ai igen.',
  image_rejected: 'En sidbild kunde inte skickas. Prova att ladda upp filen igen.',
  images_unavailable: 'Bilder kan inte skickas här. Bara text kommer att tolkas.',
  refused: 'Claude ville inte behandla det här materialet.',
  invalid_json: 'Svaret gick inte att läsa. Försök igen.',
  prompt_too_large: 'Materialet är för stort för ett anrop. Dela upp det i färre filer.',
  empty_completion: 'Claude gav inget svar. Försök igen.',
  cancelled: 'Avbrutet.',
  upstream_error: 'Något gick fel hos Claude. Försök igen om en stund.',
};

export class AiError extends Error {
  constructor(code, partial) {
    super(AI_MESSAGES[code] || AI_MESSAGES.upstream_error);
    this.code = code;
    this.partial = partial;
  }
}

export class StoreError extends Error {
  constructor(code) {
    super(code === 'quota_exceeded'
      ? 'Lagringen är full. Ta bort gamla prov och försök igen.'
      : 'Kunde inte spara. Kontrollera anslutningen och försök igen.');
    this.code = code;
  }
}
