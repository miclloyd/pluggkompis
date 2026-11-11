// Dokumentsökvägar och små hjälpare ovanpå Store. Samma sökvägar i artifact och på server.
//   settings/parent                 PIN-hash och salt
//   profiles/{id}                   barnprofiler
//   tests/{id}                      prov
//   tests/{id}/materials/{mid}      material med tolkad text per sida
//   tests/{id}/goals/{gid}          lärandemål
//   tests/{id}/banks/{gid}          frågebank per mål
//   tests/{id}/mastery/{gid}        nivå och repetition per mål
//   tests/{id}/attempts/{aid}       varje svar
//   tests/{id}/events/{eid}         egna nivåhopp (påverkar nivån, ingår i omräkning)
//   tests/{id}/chats/{cid}          samtal i "Förklara mer" och "Lär ut det" (kind: teach), synliga för föräldern
//   tests/{id}/exams/{xid}          provlägen med svar och poäng per fråga
//   tasks/{id}                      egna skoluppgifter: versioner, feedback, barnets kommentarer

export const SCHEMA_VERSION = 1;

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createRepo(store) {
  const now = () => Date.now();
  const save = (path, doc) => store.set(path, { ...doc, schemaVersion: SCHEMA_VERSION, updatedAt: now() });
  const sub = (testId, coll) => `tests/${testId}/${coll}`;

  return {
    store,
    getSettings: () => store.get('settings/parent'),
    saveSettings: s => save('settings/parent', s),

    listProfiles: async () => (await store.list('profiles')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    saveProfile: p => save(`profiles/${p.id}`, { createdAt: now(), ...p }),

    listTests: async () => (await store.list('tests')).sort((a, b) => String(a.testDate || '9').localeCompare(String(b.testDate || '9'))),
    getTest: id => store.get(`tests/${id}`),
    saveTest: t => save(`tests/${t.id}`, { createdAt: now(), ...t }),
    updateTest: (id, patch) => store.update(`tests/${id}`, { ...patch, updatedAt: now() }),

    listMaterials: async id => (await store.list(sub(id, 'materials'))).sort((a, b) => (a.order || 0) - (b.order || 0)),
    saveMaterial: (id, m) => save(`${sub(id, 'materials')}/${m.id}`, m),
    deleteMaterial: (id, mid) => store.delete(`${sub(id, 'materials')}/${mid}`),

    listGoals: async id => (await store.list(sub(id, 'goals'))).sort((a, b) => (a.order || 0) - (b.order || 0)),
    saveGoal: (id, g) => save(`${sub(id, 'goals')}/${g.id}`, g),
    deleteGoal: (id, gid) => store.delete(`${sub(id, 'goals')}/${gid}`),

    listBanks: async id => Object.fromEntries((await store.list(sub(id, 'banks'))).map(b => [b.id, b.items || []])),
    saveBank: (id, gid, items) => save(`${sub(id, 'banks')}/${gid}`, { items }),
    deleteBank: (id, gid) => store.delete(`${sub(id, 'banks')}/${gid}`),

    listMastery: async id => Object.fromEntries((await store.list(sub(id, 'mastery'))).map(m => [m.id, m])),
    saveMastery: (id, m) => save(`${sub(id, 'mastery')}/${m.goalId}`, m),

    listChats: id => store.list(sub(id, 'chats')),
    listExams: id => store.list(sub(id, 'exams')),
    saveExam: (id, e) => save(`${sub(id, 'exams')}/${e.id}`, e),
    saveChat: (id, c) => save(`${sub(id, 'chats')}/${c.id}`, c),

    listEvents: id => store.list(sub(id, 'events')),
    saveEvent: (id, e) => save(`${sub(id, 'events')}/${e.id}`, e),

    listAttempts: id => store.list(sub(id, 'attempts')),
    saveAttempt: (id, a) => save(`${sub(id, 'attempts')}/${a.id}`, a),
    updateAttempt: (id, aid, patch) => store.update(`${sub(id, 'attempts')}/${aid}`, patch),

    listTasks: () => store.list('tasks'),
    getTask: id => store.get(`tasks/${id}`),
    saveTask: t => save(`tasks/${t.id}`, { createdAt: now(), ...t }),
    deleteTask: id => store.delete(`tasks/${id}`),

    async deleteTest(id) {
      for (const coll of ['materials', 'goals', 'banks', 'mastery', 'attempts', 'events', 'chats', 'exams']) {
        for (const d of await store.list(sub(id, coll))) await store.delete(`${sub(id, coll)}/${d.id}`);
      }
      await store.delete(`tests/${id}`);
    },
  };
}

// PIN lagras som SHA-256 av salt + PIN, aldrig i klartext.
export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
