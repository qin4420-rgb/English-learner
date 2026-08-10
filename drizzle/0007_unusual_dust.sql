CREATE TABLE `dictionary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`headword` text NOT NULL,
	`phonetic` text DEFAULT '' NOT NULL,
	`part_of_speech` text DEFAULT '' NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`definition_en` text DEFAULT '' NOT NULL,
	`example` text DEFAULT '' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dictionary_entries_source_headword` ON `dictionary_entries` (`source_id`,`headword`);--> statement-breakpoint
CREATE INDEX `idx_dictionary_entries_headword` ON `dictionary_entries` (`headword`);--> statement-breakpoint
CREATE TABLE `dictionary_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`resource_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dictionary_sources_owner_resource` ON `dictionary_sources` (`owner_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_dictionary_sources_owner_sort` ON `dictionary_sources` (`owner_id`,`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `vocabulary_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`vocabulary_id` integer NOT NULL,
	`resource_id` integer,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_title` text DEFAULT '' NOT NULL,
	`source_anchor` text DEFAULT '' NOT NULL,
	`source_sentence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vocabulary_occurrences_owner_word` ON `vocabulary_occurrences` (`owner_id`,`vocabulary_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_vocabulary_occurrences_owner_resource` ON `vocabulary_occurrences` (`owner_id`,`resource_id`);