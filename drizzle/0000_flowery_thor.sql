CREATE TABLE `learning_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`plan_type` text DEFAULT '课程' NOT NULL,
	`reference_id` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_plans_owner_status` ON `learning_plans` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '未分类' NOT NULL,
	`level` text DEFAULT '未分级' NOT NULL,
	`skills` text DEFAULT '综合' NOT NULL,
	`resource_type` text DEFAULT '网站' NOT NULL,
	`url` text NOT NULL,
	`source_name` text DEFAULT '手工添加' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_resources_owner_url` ON `resources` (`owner_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_resources_owner_category` ON `resources` (`owner_id`,`category`);--> statement-breakpoint
CREATE TABLE `study_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`book_key` text NOT NULL,
	`lesson_title` text NOT NULL,
	`progress_seconds` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`last_studied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_progress_owner_lesson` ON `study_progress` (`owner_id`,`lesson_key`);--> statement-breakpoint
CREATE INDEX `idx_progress_owner_updated` ON `study_progress` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_uploads_object_key` ON `uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_uploads_owner_created` ON `uploads` (`owner_id`,`created_at`);