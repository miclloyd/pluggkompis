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

  const ai = config.features?.ai ? {
    async complete({ prompt, images, tier = 'default', json = false, signal }) {
      const form = new FormData();
      form.append('request', JSON.stringify({ prompt, tier, json }));
      for (const img of images || []) form.append('images', img);
      const r = await fetch('/api/ai', { method: 'POST', body: form, signal, credentials: 'same-origin' });
      if (!r.ok) {
        const e = new Error((await r.json().catch(() => ({}))).message || 'AI-anropet misslyckades');
        e.code = r.status === 429 ? 'rate_limited' : 'upstream_error';
        throw e;
      }
      return r.json(); // { text } eller { json }
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

  return {
    config,
    ai,
    save,
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
