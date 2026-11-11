// Adapters för egen server (fas 3). Samma gränssnitt som artifact.js, mot Go-backendens endpoints.
// Klar att kopplas in när backenden finns; används inte i artifacten.
export async function createServerAdapters(config) {
  const call = async (method, url, body) => {
    const r = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) {
      const e = new Error((await r.json().catch(() => ({}))).message || `Serverfel ${r.status}`);
      e.code = r.status === 429 ? 'rate_limited' : 'upstream_error';
      throw e;
    }
    return r.status === 204 ? null : r.json();
  };

  // Vilket tak anropet räknas mot sätts av appen utifrån vyn (app.js → aiScope):
  // { purpose: 'child', profileId } när barnet övar, { purpose: 'build', testId }
  // när föräldern bygger ett prov. Servern kontrollerar att det stämmer.
  let scope = {};
  const ai = config.features?.ai ? {
    setScope(s) { scope = s || {}; },
    async complete({ prompt, images, tier = 'default', json = false, signal, onText }) {
      // Med onText (Förklara mer) strömmas texten medan modellen skriver, som i artifacten.
      const stream = !!onText && !json && !(images || []).length;
      const form = new FormData();
      form.append('request', JSON.stringify({ prompt, tier, json, stream, ...scope }));
      for (const img of images || []) form.append('images', img);
      let r;
      try {
        r = await fetch('/api/ai', { method: 'POST', body: form, signal, credentials: 'same-origin' });
      } catch (x) {
        throw Object.assign(new Error(signal?.aborted ? 'Avbrutet.' : 'Ingen kontakt med servern. Försök igen.'), { code: signal?.aborted ? 'cancelled' : 'upstream_error' });
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw Object.assign(new Error(d.message || 'AI-anropet misslyckades'), { code: d.code || 'upstream_error' });
      }
      if (stream && r.body) {
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '', text = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.t) { text += ev.t; onText({ text }); }
            if (ev.error) throw Object.assign(new Error(ev.error.message), { code: ev.error.code, partial: text });
            if (ev.done) return { text, truncated: !!ev.truncated };
          }
        }
        return { text };
      }
      return r.json(); // { text, truncated } eller { json }
    },
  } : null;

  // Vanlig nedladdning i webbläsaren.
  const save = async (filename, data) => {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'saved';
  };

  const post = async (url, body) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
    });
    const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || `Serverfel ${r.status}`);
    return data;
  };

  return {
    config,
    ai,
    save,
    // AI-förbrukningen per barn och prov (bara upplåst föräldraläge).
    usage: () => call('GET', '/api/usage'),
    // PIN och roll sköts av servern (auth.js beskriver gränssnittet).
    auth: {
      status: () => call('GET', '/api/auth'),
      setPin: pin => post('/api/auth/pin', { pin }),
      unlock: pin => post('/api/auth/unlock', { pin }),
      lock: () => post('/api/auth/lock'),
    },
    store: {
      get: path => call('GET', `/api/store/${path}`),
      set: (path, doc) => call('PUT', `/api/store/${path}`, doc),
      update: (path, patch) => call('PATCH', `/api/store/${path}`, patch),
      delete: path => call('DELETE', `/api/store/${path}`),
      list: collection => call('GET', `/api/store/${collection}?list=1`),
    },
    files: {
      async put(blob) {
        const r = await fetch('/api/files', { method: 'POST', body: blob, credentials: 'same-origin' });
        if (!r.ok) throw new Error('Kunde inte spara filen');
        return r.json();
      },
      delete: id => call('DELETE', `/api/files/${id}`),
      urlFor: id => `/api/files/${id}`,
    },
  };
}
