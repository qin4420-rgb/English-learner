import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const readingFolders = sqliteTable(
  "reading_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reading_folders_owner_name").on(table.ownerId, table.name),
    index("idx_reading_folders_owner_sort").on(table.ownerId, table.sortOrder),
  ],
);

export const resources = sqliteTable(
  "resources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("未分类"),
    level: text("level").notNull().default("未分级"),
    skills: text("skills").notNull().default("综合"),
    resourceType: text("resource_type").notNull().default("网站"),
    url: text("url").notNull(),
    sourceName: text("source_name").notNull().default("手工添加"),
    sourceUrl: text("source_url").notNull().default(""),
    collection: text("collection").notNull().default("library"),
    iconUrl: text("icon_url").notNull().default(""),
    markdownObjectKey: text("markdown_object_key").notNull().default(""),
    markdownPath: text("markdown_path").notNull().default(""),
    processingStatus: text("processing_status").notNull().default("ready"),
    translationStatus: text("translation_status").notNull().default("none"),
    publishedAt: text("published_at"),
    issueDate: text("issue_date"),
    articleOrder: integer("article_order").notNull().default(0),
    parentId: integer("parent_id"),
    readingFolderId: integer("reading_folder_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    status: text("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_resources_owner_url").on(table.ownerId, table.url),
    index("idx_resources_owner_category").on(table.ownerId, table.category),
    index("idx_resources_owner_category_sort").on(
      table.ownerId,
      table.category,
      table.sortOrder,
    ),
    index("idx_resources_owner_collection_category").on(
      table.ownerId,
      table.collection,
      table.category,
    ),
    index("idx_resources_owner_reading_folder").on(
      table.ownerId,
      table.readingFolderId,
    ),
  ],
);

export const studyProgress = sqliteTable(
  "study_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    lessonKey: text("lesson_key").notNull(),
    bookKey: text("book_key").notNull(),
    lessonTitle: text("lesson_title").notNull(),
    progressSeconds: integer("progress_seconds").notNull().default(0),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
    note: text("note").notNull().default(""),
    lastStudiedAt: text("last_studied_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_progress_owner_lesson").on(
      table.ownerId,
      table.lessonKey,
    ),
    index("idx_progress_owner_updated").on(table.ownerId, table.updatedAt),
  ],
);

export const readingProgress = sqliteTable(
  "reading_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    resourceId: integer("resource_id").notNull(),
    progressRatio: real("progress_ratio").notNull().default(0),
    anchor: text("anchor").notNull().default(""),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    fontSize: integer("font_size").notNull().default(20),
    fontFamily: text("font_family").notNull().default("serif"),
    lineHeight: real("line_height").notNull().default(1.9),
    contentWidth: text("content_width").notNull().default("standard"),
    translationMode: text("translation_mode").notNull().default("original"),
    outlineJson: text("outline_json").notNull().default("[]"),
    formatVersion: integer("format_version").notNull().default(1),
    lastReadAt: text("last_read_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_reading_progress_owner_resource").on(table.ownerId, table.resourceId),
    index("idx_reading_progress_owner_updated").on(table.ownerId, table.updatedAt),
  ],
);

export const learningPlans = sqliteTable(
  "learning_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    planType: text("plan_type").notNull().default("课程"),
    referenceId: text("reference_id").notNull().default(""),
    dueDate: text("due_date"),
    status: text("status").notNull().default("todo"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_plans_owner_status").on(table.ownerId, table.status)],
);

export const uploads = sqliteTable(
  "uploads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageProvider: text("storage_provider").notNull().default("r2"),
    externalItemId: text("external_item_id").notNull().default(""),
    externalPath: text("external_path").notNull().default(""),
    status: text("status").notNull().default("uploaded"),
    deleteAfter: text("delete_after"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_uploads_object_key").on(table.objectKey),
    index("idx_uploads_owner_created").on(table.ownerId, table.createdAt),
  ],
);

export const courses = sqliteTable(
  "courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    courseType: text("course_type").notNull().default("custom"),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("book"),
    status: text("status").notNull().default("active"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_courses_owner_title").on(table.ownerId, table.title),
    index("idx_courses_owner_status_sort").on(
      table.ownerId,
      table.status,
      table.sortOrder,
    ),
  ],
);

export const courseResources = sqliteTable(
  "course_resources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    courseId: integer("course_id").notNull(),
    resourceId: integer("resource_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("todo"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_course_resources_unique").on(
      table.ownerId,
      table.courseId,
      table.resourceId,
    ),
    index("idx_course_resources_course_sort").on(
      table.ownerId,
      table.courseId,
      table.sortOrder,
    ),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    referenceType: text("reference_type").notNull().default("general"),
    referenceId: text("reference_id").notNull().default(""),
    anchor: text("anchor").notNull().default(""),
    tags: text("tags").notNull().default(""),
    markdownPath: text("markdown_path").notNull().default(""),
    syncStatus: text("sync_status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_notes_owner_updated").on(table.ownerId, table.updatedAt),
    index("idx_notes_owner_reference").on(
      table.ownerId,
      table.referenceType,
      table.referenceId,
    ),
  ],
);

export const vocabulary = sqliteTable(
  "vocabulary",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    word: text("word").notNull(),
    phonetic: text("phonetic").notNull().default(""),
    definition: text("definition").notNull().default(""),
    dictionaryDefinition: text("dictionary_definition").notNull().default(""),
    aiExplanation: text("ai_explanation").notNull().default(""),
    example: text("example").notNull().default(""),
    exampleTranslation: text("example_translation").notNull().default(""),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: text("source_id").notNull().default(""),
    sourceAnchor: text("source_anchor").notNull().default(""),
    sourceSentence: text("source_sentence").notNull().default(""),
    tags: text("tags").notNull().default(""),
    mastered: integer("mastered", { mode: "boolean" }).notNull().default(false),
    reviewCount: integer("review_count").notNull().default(0),
    nextReviewAt: text("next_review_at"),
    fsrsState: integer("fsrs_state").notNull().default(0),
    fsrsStability: real("fsrs_stability").notNull().default(0),
    fsrsDifficulty: real("fsrs_difficulty").notNull().default(0),
    fsrsElapsedDays: integer("fsrs_elapsed_days").notNull().default(0),
    fsrsScheduledDays: integer("fsrs_scheduled_days").notNull().default(0),
    fsrsLearningSteps: integer("fsrs_learning_steps").notNull().default(0),
    fsrsReps: integer("fsrs_reps").notNull().default(0),
    fsrsLapses: integer("fsrs_lapses").notNull().default(0),
    fsrsLastReviewAt: text("fsrs_last_review_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_vocabulary_owner_word").on(table.ownerId, table.word),
    index("idx_vocabulary_owner_review").on(
      table.ownerId,
      table.mastered,
      table.nextReviewAt,
    ),
  ],
);

export const vocabularyReviews = sqliteTable(
  "vocabulary_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    vocabularyId: integer("vocabulary_id").notNull(),
    rating: integer("rating").notNull(),
    stateBefore: integer("state_before").notNull(),
    stateAfter: integer("state_after").notNull(),
    dueAt: text("due_at").notNull(),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    reviewedAt: text("reviewed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_vocabulary_reviews_owner_word").on(
      table.ownerId,
      table.vocabularyId,
      table.reviewedAt,
    ),
  ],
);

export const vocabularyOccurrences = sqliteTable(
  "vocabulary_occurrences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    vocabularyId: integer("vocabulary_id").notNull(),
    resourceId: integer("resource_id"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceTitle: text("source_title").notNull().default(""),
    sourceAnchor: text("source_anchor").notNull().default(""),
    sourceSentence: text("source_sentence").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_vocabulary_occurrences_owner_word").on(table.ownerId, table.vocabularyId, table.createdAt),
    index("idx_vocabulary_occurrences_owner_resource").on(table.ownerId, table.resourceId),
  ],
);

export const dictionarySources = sqliteTable(
  "dictionary_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    resourceId: integer("resource_id").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_dictionary_sources_owner_resource").on(table.ownerId, table.resourceId),
    index("idx_dictionary_sources_owner_sort").on(table.ownerId, table.enabled, table.sortOrder),
  ],
);

export const dictionaryEntries = sqliteTable(
  "dictionary_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id").notNull(),
    headword: text("headword").notNull(),
    phonetic: text("phonetic").notNull().default(""),
    partOfSpeech: text("part_of_speech").notNull().default(""),
    definition: text("definition").notNull().default(""),
    definitionEn: text("definition_en").notNull().default(""),
    example: text("example").notNull().default(""),
    extraJson: text("extra_json").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("idx_dictionary_entries_source_headword").on(table.sourceId, table.headword),
    index("idx_dictionary_entries_headword").on(table.headword),
  ],
);

export const learningActivities = sqliteTable(
  "learning_activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    skill: text("skill").notNull().default("阅读"),
    domain: text("domain").notNull().default("日常"),
    title: text("title").notNull(),
    referenceType: text("reference_type").notNull().default("manual"),
    referenceId: text("reference_id").notNull().default(""),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    studiedAt: text("studied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_activities_owner_studied").on(table.ownerId, table.studiedAt),
    index("idx_activities_owner_skill").on(table.ownerId, table.skill),
  ],
);

export const processingJobs = sqliteTable(
  "processing_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    inputType: text("input_type").notNull(),
    sourceName: text("source_name").notNull().default(""),
    sourceUrl: text("source_url").notNull().default(""),
    uploadId: integer("upload_id"),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("等待处理"),
    progress: integer("progress").notNull().default(0),
    error: text("error").notNull().default(""),
    resultResourceId: integer("result_resource_id"),
    deleteOriginalOnSuccess: integer("delete_original_on_success", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_jobs_owner_created").on(table.ownerId, table.createdAt),
    index("idx_jobs_owner_status").on(table.ownerId, table.status),
  ],
);

export const oneDriveConnections = sqliteTable(
  "onedrive_connections",
  {
    ownerId: text("owner_id").primaryKey(),
    accountLabel: text("account_label").notNull().default("个人版 OneDrive"),
    driveId: text("drive_id").notNull().default(""),
    appFolderId: text("app_folder_id").notNull().default(""),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull().default(""),
    accessTokenExpiresAt: text("access_token_expires_at"),
    status: text("status").notNull().default("disconnected"),
    lastSyncAt: text("last_sync_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull().default("onedrive"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_oauth_states_expires").on(table.expiresAt)],
);
