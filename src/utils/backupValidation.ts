/** Validate every collection before a restore can replace any saved data. */
export function assertValidBackup(data: any): void {
  const fail = () => { throw new Error('This backup is incomplete or contains invalid records. Your saved data has not been replaced.'); };
  const obj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v: any) => typeof v === 'string' && v.trim().length > 0;
  const date = (v: any) => text(v) && Number.isFinite(Date.parse(v));
  const num = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const nullable = (v: any) => v === null || num(v);
  const integer = (v: any) => Number.isInteger(v) && v >= 1;
  const week = (v: any) => typeof v === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(v);
  const collection = (v: any, valid: (r: any) => boolean, unique = false) => {
    if (!Array.isArray(v) || !v.every(r => obj(r) && valid(r))) fail();
    if (unique && new Set(v.map((r: any) => r.id)).size !== v.length) fail();
  };
  if (!obj(data) || data.app !== 'workout-timer' || data.backupVersion !== 1) fail();
  const settings = ['tier1SetDuration','tier1BreakDuration','standardSetDuration','standardBreakDuration','transitionDuration','targetWorkoutMinutes','warningWorkoutMinutes','minSessionsForAdaptation'];
  if (!obj(data.settings) || !settings.every(k => num(data.settings[k]) && data.settings[k] > 0 && data.settings[k] <= 86400)) fail();
  collection(data.timingRecords, r => text(r.exerciseId) && (r.transition === true ? r.setNumber === 0 : integer(r.setNumber)) && nullable(r.setDuration) && nullable(r.breakDuration) && date(r.date) && text(r.sessionId) && (r.transition === undefined || typeof r.transition === 'boolean'));
  collection(data.sessions, r => {
    if (!(text(r.id) && text(r.day) && date(r.date) && num(r.totalDuration) && Number.isInteger(r.exercisesCompleted) && r.exercisesCompleted >= 0)) return false;
    collection(r.setRecords, s => text(s.exerciseId) && text(s.exerciseName) && integer(s.setNumber) && nullable(s.predictedSetDuration) && nullable(s.actualSetDuration) && nullable(s.predictedBreakDuration) && num(s.actualBreakDuration) && date(s.completedAt));
    return r.notes === undefined || typeof r.notes === 'string';
  }, true);
  collection(data.trackerEntries, r => {
    if (!(text(r.id) && date(r.capturedAt) && week(r.weekKey))) return false;
    for (const k of ['month','day','weekDate','title','notes','rawText']) if (r[k] !== undefined && typeof r[k] !== 'string') return false;
    if (r.weekNumber !== undefined && r.weekNumber !== null && !integer(r.weekNumber)) return false;
    collection(r.exercises, ex => {
      if (!text(ex.name) || (ex.target !== undefined && typeof ex.target !== 'string')) return false;
      collection(ex.sets, s => integer(s.setNumber) && nullable(s.reps) && nullable(s.weight) && (s.durationSeconds === undefined || nullable(s.durationSeconds)) && (s.inferred === undefined || typeof s.inferred === 'boolean') && ['raw','notes'].every(k => s[k] === undefined || typeof s[k] === 'string'));
      return true;
    });
    return true;
  }, true);
  collection(data.bodyweights, r => text(r.id) && date(r.date) && week(r.weekKey) && num(r.kg) && r.kg > 0 && r.kg <= 500, true);
}
