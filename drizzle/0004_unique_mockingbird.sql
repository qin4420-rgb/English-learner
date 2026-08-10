CREATE TABLE `vocabulary_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`vocabulary_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`state_before` integer NOT NULL,
	`state_after` integer NOT NULL,
	`due_at` text NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`reviewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vocabulary_reviews_owner_word` ON `vocabulary_reviews` (`owner_id`,`vocabulary_id`,`reviewed_at`);--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_state` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_stability` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_difficulty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_elapsed_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_scheduled_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_learning_steps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_reps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_lapses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `fsrs_last_review_at` text;--> statement-breakpoint
PRAGMA optimize;
