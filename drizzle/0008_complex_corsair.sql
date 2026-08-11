CREATE TABLE `processing_job_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` integer NOT NULL,
	`step_key` text NOT NULL,
	`step_label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error_code` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`error_detail_json` text DEFAULT '{}' NOT NULL,
	`output_ref` text DEFAULT '' NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_job_steps_owner_job_sort` ON `processing_job_steps` (`owner_id`,`job_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_steps_owner_job_key` ON `processing_job_steps` (`owner_id`,`job_id`,`step_key`);--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `current_step` text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `last_successful_step` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `pause_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `error_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `error_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `error_detail_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `suggested_actions_json` text DEFAULT '[]' NOT NULL;