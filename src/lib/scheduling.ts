import type { CardState } from "./types";

// Spaced repetition. An SM-2 style scheduler over the `card_schedule` columns
// the schema already carries (stability as the current interval in days,
// difficulty as the ease factor), so it can be swapped for full FSRS later
// without a migration.

export type Rating = 1 | 2 | 3 | 4; // again | hard | good | easy

export interface ScheduleState {
  state: CardState;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
}

export interface ScheduleOutcome extends ScheduleState {
  dueAt: Date;
}

const MINIMUM_EASE = 1.3;
const MAXIMUM_EASE = 10;
const LEARNING_STEP_MINUTES = 10;

export function schedule(current: ScheduleState, rating: Rating, now = new Date()): ScheduleOutcome {
  const ease = clamp(
    (current.difficulty || 2.5) + easeDelta(rating),
    MINIMUM_EASE,
    MAXIMUM_EASE,
  );
  const reps = current.reps + 1;

  if (rating === 1) {
    return {
      state: current.state === "new" ? "learning" : "relearning",
      stability: 0,
      difficulty: ease,
      reps,
      lapses: current.lapses + (current.state === "review" ? 1 : 0),
      dueAt: minutesFrom(now, LEARNING_STEP_MINUTES),
    };
  }

  // A card leaves learning on its first good answer, with the classic 1 then
  // 6 day steps before intervals start compounding.
  const intervalDays = current.state === "new" || current.state === "learning" || current.state === "relearning"
    ? (rating === 4 ? 4 : 1)
    : Math.max(1, Math.round((current.stability || 1) * ease * hardPenalty(rating)));

  return {
    state: "review",
    stability: intervalDays,
    difficulty: ease,
    reps,
    lapses: current.lapses,
    dueAt: daysFrom(now, intervalDays),
  };
}

/** What each button will do, for the labels under the review buttons. */
export function previewIntervals(current: ScheduleState, now = new Date()): Record<Rating, string> {
  const labels = {} as Record<Rating, string>;
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    const outcome = schedule(current, rating, now);
    const minutes = Math.round((outcome.dueAt.getTime() - now.getTime()) / 60_000);
    labels[rating] = minutes < 60
      ? `${minutes}m`
      : minutes < 1440
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / 1440)}d`;
  }
  return labels;
}

function easeDelta(rating: Rating): number {
  return { 1: -0.2, 2: -0.15, 3: 0, 4: 0.15 }[rating];
}

function hardPenalty(rating: Rating): number {
  return rating === 2 ? 0.6 : rating === 4 ? 1.3 : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function minutesFrom(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}
