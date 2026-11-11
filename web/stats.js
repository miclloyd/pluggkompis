// Statistik för föräldravyn, räknad ur sparade svar (attempts). Ren logik, samma i artifact och server.

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function relDay(ts, now = Date.now()) {
  if (!ts) return 'aldrig';
  const a = new Date(dayKey(ts) + 'T12:00:00'), b = new Date(dayKey(now) + 'T12:00:00');
  const n = Math.round((b - a) / 864e5);
  if (n <= 0) return 'i dag';
  if (n === 1) return 'i går';
  return `för ${n} dagar sedan`;
}

// Övningspass: svar med mindre än 20 minuters mellanrum räknas till samma pass.
function sessions(sorted) {
  const out = [];
  for (const a of sorted) {
    const cur = out[out.length - 1];
    if (cur && a.ts - cur.end < 20 * 60e3) { cur.end = a.ts; cur.n += 1; }
    else out.push({ start: a.ts, end: a.ts, n: 1 });
  }
  return out;
}

export function summarize(allAttempts, { days = 14, now = Date.now() } = {}) {
  // Svar "med hjälp" (barnet tittade i materialet först) räknas för sig, inte i rätt/fel.
  const helped = allAttempts.filter(a => a.helped).length;
  const sorted = allAttempts.filter(a => !a.helped).sort((a, b) => a.ts - b.ts);
  const right = sorted.filter(a => a.score >= 1).length;
  const almost = sorted.filter(a => a.score === 0.5).length;
  const wrong = sorted.length - right - almost;
  const pass = sessions(sorted);

  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * 864e5);
    byDay.push({ key, right: 0, almost: 0, wrong: 0 });
  }
  const dayIdx = Object.fromEntries(byDay.map((d, i) => [d.key, i]));
  for (const a of sorted) {
    const i = dayIdx[dayKey(a.ts)];
    if (i === undefined) continue;
    byDay[i][a.score >= 1 ? 'right' : a.score === 0.5 ? 'almost' : 'wrong'] += 1;
  }

  const byGoal = {};
  for (const a of sorted) {
    const g = (byGoal[a.goalId] ||= { n: 0, points: 0, last: 0, recent: [] });
    g.n += 1; g.points += a.score; g.last = a.ts;
    g.recent.push(a.score);
  }
  for (const g of Object.values(byGoal)) g.recent = g.recent.slice(-5);

  return {
    helped,
    total: sorted.length,
    right, almost, wrong,
    accuracy: sorted.length ? (right + almost * 0.5) / sorted.length : null,
    practiceDays: new Set(sorted.map(a => dayKey(a.ts))).size,
    sessions: pass.length,
    minutes: Math.round(pass.reduce((m, p) => m + Math.max(1, (p.end - p.start) / 60e3), 0)),
    last: sorted.length ? sorted[sorted.length - 1].ts : null,
    byDay,
    byGoal,
    disputed: sorted.filter(a => a.disputed && !a.resolved).reverse(),
  };
}

export const pct = x => (x == null ? '–' : `${Math.round(x * 100)} %`);
