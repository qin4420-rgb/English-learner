import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export type RuntimeBindings = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  ONEDRIVE_CLIENT_ID?: string;
  ONEDRIVE_CLIENT_SECRET?: string;
  ONEDRIVE_TOKEN_KEY?: string;
  ONEDRIVE_REDIRECT_URI?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  AI_PROVIDER?: string;
  OCR_PROVIDER?: string;
  OCR_ENDPOINT?: string;
  STT_PROVIDER?: string;
  STT_ENDPOINT?: string;
  PRONUNCIATION_PROVIDER?: string;
  PRONUNCIATION_ENDPOINT?: string;
};

let initialized: Promise<void> | null = null;

export function getRuntimeBindings(): RuntimeBindings {
  return env as unknown as RuntimeBindings;
}

export function getDatabase(): D1Database {
  const database = getRuntimeBindings().DB;
  if (!database) throw new Error("学习数据库暂不可用");
  return database;
}

export function getMediaBucket(): R2Bucket {
  const bucket = getRuntimeBindings().MEDIA;
  if (!bucket) throw new Error("资料存储暂不可用");
  return bucket;
}

export async function getOwnerId(): Promise<string> {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  if (process.env.NODE_ENV !== "production") return "local-preview-user";
  throw new Error("请先登录后再操作");
}

export async function ensureDatabase(): Promise<void> {
  if (initialized) return initialized;
  const database = getDatabase();
  const setup = database
    .batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '未分类',
        level TEXT NOT NULL DEFAULT '未分级',
        skills TEXT NOT NULL DEFAULT '综合',
        resource_type TEXT NOT NULL DEFAULT '网站',
        url TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '手工添加',
        source_url TEXT NOT NULL DEFAULT '',
        collection TEXT NOT NULL DEFAULT 'library',
        icon_url TEXT NOT NULL DEFAULT '',
        markdown_object_key TEXT NOT NULL DEFAULT '',
        markdown_path TEXT NOT NULL DEFAULT '',
        processing_status TEXT NOT NULL DEFAULT 'ready',
        translation_status TEXT NOT NULL DEFAULT 'none',
        published_at TEXT,
        issue_date TEXT,
        article_order INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER,
        reading_folder_id INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        last_checked_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_owner_url ON resources(owner_id, url)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS idx_resources_owner_category ON resources(owner_id, category)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS reading_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_folders_owner_name ON reading_folders(owner_id,name)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_reading_folders_owner_sort ON reading_folders(owner_id,sort_order)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS study_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        lesson_key TEXT NOT NULL,
        book_key TEXT NOT NULL,
        lesson_title TEXT NOT NULL,
        progress_seconds INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        last_studied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_owner_lesson ON study_progress(owner_id, lesson_key)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS idx_progress_owner_updated ON study_progress(owner_id, updated_at)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS reading_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        progress_ratio REAL NOT NULL DEFAULT 0,
        anchor TEXT NOT NULL DEFAULT '',
        completed INTEGER NOT NULL DEFAULT 0,
        font_size INTEGER NOT NULL DEFAULT 20,
        font_family TEXT NOT NULL DEFAULT 'serif',
        line_height REAL NOT NULL DEFAULT 1.9,
        content_width TEXT NOT NULL DEFAULT 'standard',
        translation_mode TEXT NOT NULL DEFAULT 'original',
        outline_json TEXT NOT NULL DEFAULT '[]',
        format_version INTEGER NOT NULL DEFAULT 1,
        last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_progress_owner_resource ON reading_progress(owner_id,resource_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_reading_progress_owner_updated ON reading_progress(owner_id,updated_at)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS learning_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        plan_type TEXT NOT NULL DEFAULT '课程',
        reference_id TEXT NOT NULL DEFAULT '',
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS idx_plans_owner_status ON learning_plans(owner_id, status)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_provider TEXT NOT NULL DEFAULT 'r2',
        external_item_id TEXT NOT NULL DEFAULT '',
        external_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'uploaded',
        delete_after TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_object_key ON uploads(object_key)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS idx_uploads_owner_created ON uploads(owner_id, created_at)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        course_type TEXT NOT NULL DEFAULT 'custom',
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT 'book',
        status TEXT NOT NULL DEFAULT 'active',
        pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_owner_title ON courses(owner_id,title)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_courses_owner_status_sort ON courses(owner_id,status,sort_order)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS course_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        course_id INTEGER NOT NULL,
        resource_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'todo',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_course_resources_unique ON course_resources(owner_id,course_id,resource_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_course_resources_course_sort ON course_resources(owner_id,course_id,sort_order)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        reference_type TEXT NOT NULL DEFAULT 'general',
        reference_id TEXT NOT NULL DEFAULT '',
        anchor TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        markdown_path TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes(owner_id,updated_at)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_notes_owner_reference ON notes(owner_id,reference_type,reference_id)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS vocabulary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        word TEXT NOT NULL,
        phonetic TEXT NOT NULL DEFAULT '',
        definition TEXT NOT NULL DEFAULT '',
        dictionary_definition TEXT NOT NULL DEFAULT '',
        ai_explanation TEXT NOT NULL DEFAULT '',
        example TEXT NOT NULL DEFAULT '',
        example_translation TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT NOT NULL DEFAULT '',
        source_anchor TEXT NOT NULL DEFAULT '',
        source_sentence TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        mastered INTEGER NOT NULL DEFAULT 0,
        review_count INTEGER NOT NULL DEFAULT 0,
        next_review_at TEXT,
        fsrs_state INTEGER NOT NULL DEFAULT 0,
        fsrs_stability REAL NOT NULL DEFAULT 0,
        fsrs_difficulty REAL NOT NULL DEFAULT 0,
        fsrs_elapsed_days INTEGER NOT NULL DEFAULT 0,
        fsrs_scheduled_days INTEGER NOT NULL DEFAULT 0,
        fsrs_learning_steps INTEGER NOT NULL DEFAULT 0,
        fsrs_reps INTEGER NOT NULL DEFAULT 0,
        fsrs_lapses INTEGER NOT NULL DEFAULT 0,
        fsrs_last_review_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_owner_word ON vocabulary(owner_id,word)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_vocabulary_owner_review ON vocabulary(owner_id,mastered,next_review_at)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS vocabulary_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        vocabulary_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        state_before INTEGER NOT NULL,
        state_after INTEGER NOT NULL,
        due_at TEXT NOT NULL,
        stability REAL NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 0,
        scheduled_days INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_vocabulary_reviews_owner_word ON vocabulary_reviews(owner_id,vocabulary_id,reviewed_at)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS learning_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        skill TEXT NOT NULL DEFAULT '阅读',
        domain TEXT NOT NULL DEFAULT '日常',
        title TEXT NOT NULL,
        reference_type TEXT NOT NULL DEFAULT 'manual',
        reference_id TEXT NOT NULL DEFAULT '',
        duration_minutes INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        studied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_activities_owner_studied ON learning_activities(owner_id,studied_at)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_activities_owner_skill ON learning_activities(owner_id,skill)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS processing_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        input_type TEXT NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        upload_id INTEGER,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT NOT NULL DEFAULT '等待处理',
        progress INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        result_resource_id INTEGER,
        delete_original_on_success INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_owner_created ON processing_jobs(owner_id,created_at)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON processing_jobs(owner_id,status)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS onedrive_connections (
        owner_id TEXT PRIMARY KEY,
        account_label TEXT NOT NULL DEFAULT '个人版 OneDrive',
        drive_id TEXT NOT NULL DEFAULT '',
        app_folder_id TEXT NOT NULL DEFAULT '',
        encrypted_refresh_token TEXT NOT NULL DEFAULT '',
        access_token_expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'disconnected',
        last_sync_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'onedrive',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)"),
    ])
    .then(async () => {
      const columns = await database.prepare("PRAGMA table_info(resources)").all();
      const availableColumns = new Set(
        (columns.results as { name?: string }[]).map((column) => column.name),
      );
      const additions = [
        ["sort_order", "ALTER TABLE resources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"],
        ["collection", "ALTER TABLE resources ADD COLUMN collection TEXT NOT NULL DEFAULT 'library'"],
        ["icon_url", "ALTER TABLE resources ADD COLUMN icon_url TEXT NOT NULL DEFAULT ''"],
        ["markdown_object_key", "ALTER TABLE resources ADD COLUMN markdown_object_key TEXT NOT NULL DEFAULT ''"],
        ["markdown_path", "ALTER TABLE resources ADD COLUMN markdown_path TEXT NOT NULL DEFAULT ''"],
        ["processing_status", "ALTER TABLE resources ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready'"],
        ["translation_status", "ALTER TABLE resources ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'none'"],
        ["published_at", "ALTER TABLE resources ADD COLUMN published_at TEXT"],
        ["issue_date", "ALTER TABLE resources ADD COLUMN issue_date TEXT"],
        ["article_order", "ALTER TABLE resources ADD COLUMN article_order INTEGER NOT NULL DEFAULT 0"],
        ["parent_id", "ALTER TABLE resources ADD COLUMN parent_id INTEGER"],
        ["reading_folder_id", "ALTER TABLE resources ADD COLUMN reading_folder_id INTEGER"],
        ["metadata_json", "ALTER TABLE resources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'"],
      ] as const;
      for (const [name, statement] of additions) {
        if (!availableColumns.has(name)) await database.prepare(statement).run();
      }
      const uploadColumns = await database.prepare("PRAGMA table_info(uploads)").all();
      const availableUploadColumns = new Set(
        (uploadColumns.results as { name?: string }[]).map((column) => column.name),
      );
      const uploadAdditions = [
        ["storage_provider", "ALTER TABLE uploads ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'r2'"],
        ["external_item_id", "ALTER TABLE uploads ADD COLUMN external_item_id TEXT NOT NULL DEFAULT ''"],
        ["external_path", "ALTER TABLE uploads ADD COLUMN external_path TEXT NOT NULL DEFAULT ''"],
        ["status", "ALTER TABLE uploads ADD COLUMN status TEXT NOT NULL DEFAULT 'uploaded'"],
        ["delete_after", "ALTER TABLE uploads ADD COLUMN delete_after TEXT"],
      ] as const;
      for (const [name, statement] of uploadAdditions) {
        if (!availableUploadColumns.has(name)) await database.prepare(statement).run();
      }
      const vocabularyColumns = await database.prepare("PRAGMA table_info(vocabulary)").all();
      const availableVocabularyColumns = new Set(
        (vocabularyColumns.results as { name?: string }[]).map((column) => column.name),
      );
      const vocabularyAdditions = [
        ["dictionary_definition", "ALTER TABLE vocabulary ADD COLUMN dictionary_definition TEXT NOT NULL DEFAULT ''"],
        ["example_translation", "ALTER TABLE vocabulary ADD COLUMN example_translation TEXT NOT NULL DEFAULT ''"],
        ["source_sentence", "ALTER TABLE vocabulary ADD COLUMN source_sentence TEXT NOT NULL DEFAULT ''"],
        ["fsrs_state", "ALTER TABLE vocabulary ADD COLUMN fsrs_state INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_stability", "ALTER TABLE vocabulary ADD COLUMN fsrs_stability REAL NOT NULL DEFAULT 0"],
        ["fsrs_difficulty", "ALTER TABLE vocabulary ADD COLUMN fsrs_difficulty REAL NOT NULL DEFAULT 0"],
        ["fsrs_elapsed_days", "ALTER TABLE vocabulary ADD COLUMN fsrs_elapsed_days INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_scheduled_days", "ALTER TABLE vocabulary ADD COLUMN fsrs_scheduled_days INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_learning_steps", "ALTER TABLE vocabulary ADD COLUMN fsrs_learning_steps INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_reps", "ALTER TABLE vocabulary ADD COLUMN fsrs_reps INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_lapses", "ALTER TABLE vocabulary ADD COLUMN fsrs_lapses INTEGER NOT NULL DEFAULT 0"],
        ["fsrs_last_review_at", "ALTER TABLE vocabulary ADD COLUMN fsrs_last_review_at TEXT"],
      ] as const;
      for (const [name, statement] of vocabularyAdditions) {
        if (!availableVocabularyColumns.has(name)) await database.prepare(statement).run();
      }
      await database.batch([
        database.prepare("CREATE INDEX IF NOT EXISTS idx_resources_owner_category_sort ON resources(owner_id,category,sort_order)"),
        database.prepare("CREATE INDEX IF NOT EXISTS idx_resources_owner_collection_category ON resources(owner_id,collection,category)"),
        database.prepare("CREATE INDEX IF NOT EXISTS idx_resources_owner_reading_folder ON resources(owner_id,reading_folder_id)"),
        database.prepare("UPDATE resources SET collection='tool' WHERE source_name='EngLearner 资源目录' AND collection!='tool'"),
        database.prepare("CREATE INDEX IF NOT EXISTS idx_vocabulary_reviews_owner_word ON vocabulary_reviews(owner_id,vocabulary_id,reviewed_at)"),
        database.prepare("PRAGMA optimize"),
      ]);
    })
    .catch((error: unknown) => {
      initialized = null;
      throw error;
    });
  initialized = setup;
  return setup;
}

export function jsonError(error: unknown, status = 500): Response {
  const message = error instanceof Error ? error.message : "操作失败，请稍后重试";
  const resolvedStatus = message.includes("请先登录") ? 401 : status;
  return Response.json({ error: message }, { status: resolvedStatus });
}
