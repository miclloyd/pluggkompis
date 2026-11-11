// Föräldraläget: PIN och roll. På servern sköts det av /api/auth (PIN:en hashas
// där och lämnar aldrig servern). I artifacten och i minnesläget finns ingen
// server, så PIN-hashen ligger i settings/parent som tidigare.
//   status() → { role: 'parent'|'child', hasPin, unlocked, account?, accounts? }
//   setPin(pin) → { ok }            första PIN:en, eller byte i upplåst läge
//   unlock(pin) → { ok, waitSeconds? }
//   lock()
import { uid, hashPin } from './repo.js';

export function createLocalAuth(repo) {
  return {
    async status() {
      const s = await repo.getSettings();
      return { role: 'parent', hasPin: !!s?.pinHash, unlocked: false };
    },
    async setPin(pin) {
      const salt = uid('s');
      await repo.saveSettings({ salt, pinHash: await hashPin(pin, salt) });
      return { ok: true };
    },
    async unlock(pin) {
      const s = await repo.getSettings();
      return { ok: !!s && (await hashPin(pin, s.salt)) === s.pinHash };
    },
    async lock() {},
  };
}
