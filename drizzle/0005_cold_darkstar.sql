CREATE TABLE `reading_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`resource_id` integer NOT NULL,
	`progress_ratio` real DEFAULT 0 NOT NULL,
	`anchor` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`font_size` integer DEFAULT 20 NOT NULL,
	`font_family` text DEFAULT 'serif' NOT NULL,
	`line_height` real DEFAULT 1.9 NOT NULL,
	`content_width` text DEFAULT 'standard' NOT NULL,
	`translation_mode` text DEFAULT 'original' NOT NULL,
	`outline_json` text DEFAULT '[]' NOT NULL,
	`format_version` integer DEFAULT 1 NOT NULL,
	`last_read_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reading_progress_owner_resource` ON `reading_progress` (`owner_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_reading_progress_owner_updated` ON `reading_progress` (`owner_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `dictionary_definition` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `example_translation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vocabulary` ADD `source_sentence` text DEFAULT '' NOT NULL;--> statement-breakpoint
PRAGMA optimize;
