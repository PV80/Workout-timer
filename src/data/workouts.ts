import { WorkoutDay } from '../types';

export const WORKOUTS: Record<string, WorkoutDay> = {
  monday: {
    day: 'monday',
    dayOfWeek: 1,
    name: 'MONDAY',
    muscleGroups: 'Chest, Biceps & Abs',
    exercises: [
      { id: 'bench-press',    name: 'Flat Barbell Bench Press',   type: 'TIER1',    sets: 4, reps: '8-10' },
      { id: 'incline-db',     name: 'Incline Dumbbell Bench',      type: 'STANDARD', sets: 3, reps: '10' },
      { id: 'landmine-chest', name: 'Landmine Chest Press',        type: 'STANDARD', sets: 3, reps: '12' },
      { id: 'barbell-curls',  name: 'Standing Barbell Curls',      type: 'STANDARD', sets: 4, reps: '10' },
      { id: 'preacher-curls', name: 'Preacher Curls',              type: 'STANDARD', sets: 3, reps: '12' },
      { id: 'leg-raises',     name: 'Hanging Leg Raises',                  type: 'STANDARD', sets: 3, reps: '15' },
      { id: 'ab-roller',      name: 'Ab Roller',                   type: 'AMRAP',    sets: 3, reps: 'Failure' },
    ],
  },
  tuesday: {
    day: 'tuesday',
    dayOfWeek: 2,
    name: 'TUESDAY',
    muscleGroups: 'Legs',
    exercises: [
      { id: 'back-squats',     name: 'Barbell Back Squats',         type: 'TIER1',    sets: 4, reps: '8-10' },
      { id: 'landmine-lunges', name: 'Landmine Reverse Lunges',     type: 'STANDARD', sets: 3, reps: '10/leg' },
      { id: 'bulgarian-split', name: 'Bulgarian Split Squats',      type: 'STANDARD', sets: 3, reps: '10' },
      { id: 'hip-thrusts',     name: 'Lying Hip Thrusts',           type: 'STANDARD', sets: 4, reps: '12' },
    ],
  },
  thursday: {
    day: 'thursday',
    dayOfWeek: 4,
    name: 'THURSDAY',
    muscleGroups: 'Shoulders, Triceps & Abs',
    exercises: [
      { id: 'military-press',  name: 'Standing Military Press',     type: 'TIER1',    sets: 4, reps: '8-10' },
      { id: 'landmine-press',  name: 'Landmine Single-Arm Press',   type: 'STANDARD', sets: 3, reps: '10/arm' },
      { id: 'lateral-raises',  name: 'Lateral Raises',              type: 'STANDARD', sets: 4, reps: '15' },
      { id: 'skull-crushers',  name: 'Lying DB Extensions (Skull)', type: 'STANDARD', sets: 3, reps: '12' },
      { id: 'dips',            name: 'Dips',                        type: 'AMRAP',    sets: 3, reps: 'Failure' },
      { id: 'oblique-twists',  name: 'Oblique Twists',              type: 'STANDARD', sets: 3, reps: '20' },
      { id: 'plank',           name: 'Plank',                       type: 'TIMED',    sets: 3, reps: '1 min' },
    ],
  },
  friday: {
    day: 'friday',
    dayOfWeek: 5,
    name: 'FRIDAY',
    muscleGroups: 'Back & Rear Delts',
    exercises: [
      { id: 'deadlifts',       name: 'Deadlifts',                   type: 'TIER1',    sets: 4, reps: '6-8' },
      { id: 'pull-ups',        name: 'Pull-Ups',                    type: 'AMRAP',    sets: 3, reps: 'AMRAP' },
      { id: 'landmine-rows',   name: 'Landmine Rows (Meadows)',     type: 'STANDARD', sets: 4, reps: '10' },
      { id: 'db-rows',         name: 'One Arm Dumbbell Rows',       type: 'STANDARD', sets: 3, reps: '12' },
      { id: 'rear-delt-flyes', name: 'Rear Delt Dumbbell Flyes',   type: 'STANDARD', sets: 3, reps: '15' },
    ],
  },
};

const DAY_MAP: Record<number, string> = { 1: 'monday', 2: 'tuesday', 4: 'thursday', 5: 'friday' };

export function getTodayWorkout(): WorkoutDay | null {
  const dow = new Date().getDay();
  const dayName = DAY_MAP[dow === 0 ? -1 : dow];
  return dayName ? WORKOUTS[dayName] : null;
}

export function getWorkoutByDay(day: string): WorkoutDay | null {
  return WORKOUTS[day.toLowerCase()] ?? null;
}

export function getNextWorkout(): WorkoutDay | null {
  const dow = new Date().getDay();
  const order = [1, 2, 4, 5];
  for (let i = 1; i <= 7; i++) {
    const next = ((dow + i) % 7) || 7;
    const key = DAY_MAP[next];
    if (key) return WORKOUTS[key];
  }
  return null;
}

