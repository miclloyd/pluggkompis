// Lagring i minnet: används när ingen beständig lagring finns (förhandsvisning, demoläge).
export function memoryStore() {
  const docs = new Map();
  const parentOf = path => path.split('/').slice(0, -1).join('/');
  return {
    async get(path) { return docs.has(path) ? { id: path.split('/').pop(), ...docs.get(path) } : null; },
    async set(path, doc) { docs.set(path, structuredClone(doc)); },
    async update(path, patch) {
      if (!docs.has(path)) throw new Error('Dokumentet finns inte: ' + path);
      docs.set(path, { ...docs.get(path), ...structuredClone(patch) });
    },
    async delete(path) { docs.delete(path); },
    async list(collection) {
      const out = [];
      for (const [p, d] of docs) if (parentOf(p) === collection) out.push({ id: p.split('/').pop(), ...structuredClone(d) });
      return out;
    },
  };
}
