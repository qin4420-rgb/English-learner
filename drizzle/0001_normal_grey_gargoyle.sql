ALTER TABLE `resources` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_resources_owner_category_sort` ON `resources` (`owner_id`,`category`,`sort_order`);