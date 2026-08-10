import { Rating, State, fsrs, type CardInput, type Grade } from "ts-fsrs";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export const FSRS_RATINGS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function vocabularyCard(row: Record<string, unknown>, now: Date): CardInput {
  const state = Math.min(State.Relearning, Math.max(State.New, numberValue(row.fsrs_state))) as State;
  return {
    due: String(row.next_review_at || now.toISOString()),
    stability: numberValue(row.fsrs_stability),
    difficulty: numberValue(row.fsrs_difficulty),
    elapsed_days: numberValue(row.fsrs_elapsed_days),
    scheduled_days: numberValue(row.fsrs_scheduled_days),
    learning_steps: numberValue(row.fsrs_learning_steps),
    reps: numberValue(row.fsrs_reps),
    lapses: numberValue(row.fsrs_lapses),
    state,
    last_review: row.fsrs_last_review_at ? String(row.fsrs_last_review_at) : null,
  };
}

export function scheduleVocabulary(row: Record<string, unknown>, rating: number, now = new Date()) {
  if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating as Rating)) {
    throw new Error("复习评分无效");
  }
  return scheduler.next(vocabularyCard(row, now), now, rating as Grade);
}
