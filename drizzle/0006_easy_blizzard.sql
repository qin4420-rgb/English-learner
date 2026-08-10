CREATE TABLE `reading_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reading_folders_owner_name` ON `reading_folders` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_reading_folders_owner_sort` ON `reading_folders` (`owner_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `resources` ADD `reading_folder_id` integer;--> statement-breakpoint
CREATE INDEX `idx_resources_owner_reading_folder` ON `resources` (`owner_id`,`reading_folder_id`);--> statement-breakpoint
PRAGMA optimize;
