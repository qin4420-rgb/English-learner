CREATE TABLE `course_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`course_id` integer NOT NULL,
	`resource_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_course_resources_unique` ON `course_resources` (`owner_id`,`course_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_course_resources_course_sort` ON `course_resources` (`owner_id`,`course_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`course_type` text DEFAULT 'custom' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'book' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_courses_owner_title` ON `courses` (`owner_id`,`title`);--> statement-breakpoint
CREATE INDEX `idx_courses_owner_status_sort` ON `courses` (`owner_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `learning_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`skill` text DEFAULT '阅读' NOT NULL,
	`domain` text DEFAULT '日常' NOT NULL,
	`title` text NOT NULL,
	`reference_type` text DEFAULT 'manual' NOT NULL,
	`reference_id` text DEFAULT '' NOT NULL,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`studied_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activities_owner_studied` ON `learning_activities` (`owner_id`,`studied_at`);--> statement-breakpoint
CREATE INDEX `idx_activities_owner_skill` ON `learning_activities` (`owner_id`,`skill`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`reference_type` text DEFAULT 'general' NOT NULL,
	`reference_id` text DEFAULT '' NOT NULL,
	`anchor` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`markdown_path` text DEFAULT '' NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notes_owner_updated` ON `notes` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_notes_owner_reference` ON `notes` (`owner_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text DEFAULT 'onedrive' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_expires` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `onedrive_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`account_label` text DEFAULT '个人版 OneDrive' NOT NULL,
	`drive_id` text DEFAULT '' NOT NULL,
	`app_folder_id` text DEFAULT '' NOT NULL,
	`encrypted_refresh_token` text DEFAULT '' NOT NULL,
	`access_token_expires_at` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_sync_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`input_type` text NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`upload_id` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT '等待处理' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`result_resource_id` integer,
	`delete_original_on_success` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_created` ON `processing_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_status` ON `processing_jobs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `vocabulary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`word` text NOT NULL,
	`phonetic` text DEFAULT '' NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`ai_explanation` text DEFAULT '' NOT NULL,
	`example` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`source_anchor` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`mastered` integer DEFAULT false NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`next_review_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vocabulary_owner_word` ON `vocabulary` (`owner_id`,`word`);--> statement-breakpoint
CREATE INDEX `idx_vocabulary_owner_review` ON `vocabulary` (`owner_id`,`mastered`,`next_review_at`);--> statement-breakpoint
ALTER TABLE `resources` ADD `collection` text DEFAULT 'library' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `icon_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `markdown_object_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `markdown_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `processing_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `translation_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `issue_date` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `article_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `resources` ADD `metadata_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_resources_owner_collection_category` ON `resources` (`owner_id`,`collection`,`category`);--> statement-breakpoint
UPDATE `resources` SET `collection`='tool' WHERE `source_name`='EngLearner 资源目录';--> statement-breakpoint
PRAGMA optimize;
