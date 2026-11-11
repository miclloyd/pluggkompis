// Årskurs från födelseår (plan 1.6, fas 3). Svensk årskurs följer kalenderåret:
// under läsåret som börjar på hösten år Å går ett barn fött år F i årskurs
// Å − F − 6. Läsåret byts 1 juli. gradeOffset (normalt 0) för barn som gått om
// eller börjat tidigare. Profiler från före bytet har bara grade.
// Samma regel finns i Go (access.go → childGrade) för barnets vy.
export const SCHOOL_YEAR_MONTH = 7;

export function schoolYearStart(now = new Date()) {
  return now.getMonth() + 1 >= SCHOOL_YEAR_MONTH ? now.getFullYear() : now.getFullYear() - 1;
}

export function gradeOf(p, now = new Date()) {
  if (p?.birthYear) return Math.max(0, Math.min(9, schoolYearStart(now) - p.birthYear - 6 + (p.gradeOffset || 0)));
  const g = p?.grade === '' || p?.grade == null ? NaN : Number(p.grade);
  return Number.isFinite(g) ? Math.max(0, Math.min(9, g)) : 5; // årskurs 0 (förskoleklass) är giltig
}

export function birthYearFor(grade, now = new Date()) {
  return schoolYearStart(now) - Number(grade) - 6;
}
