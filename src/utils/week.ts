export function localDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-');
}

/** ISO-8601 week key, e.g. "2026-W27". Weeks start Monday. */
export function weekKey(date: Date = new Date()): string {
  // Copy and shift to Thursday of the current week (ISO weeks are Thursday-anchored).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}
