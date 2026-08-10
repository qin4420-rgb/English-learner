ALTER TABLE `uploads` ADD `storage_provider` text DEFAULT 'r2' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `external_item_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `external_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `status` text DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `delete_after` text;