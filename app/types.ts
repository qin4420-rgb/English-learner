export type ResourceItem = {
  id: number;
  title: string;
  description: string;
  category: string;
  level: string;
  skills: string;
  resourceType: string;
  url: string;
  sourceName: string;
  sourceUrl: string;
  collection: "tool" | "library" | string;
  iconUrl: string;
  markdownObjectKey: string;
  markdownPath: string;
  processingStatus: string;
  translationStatus: string;
  publishedAt: string;
  issueDate: string;
  articleOrder: number;
  parentId: number | null;
  metadataJson: string;
  status: string;
  sortOrder: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProgressItem = {
  id: number;
  lessonKey: string;
  bookKey: string;
  lessonTitle: string;
  progressSeconds: number;
  durationSeconds: number;
  completed: boolean;
  note: string;
  lastStudiedAt: string;
};

export type ReadingProgressItem = {
  id: number;
  resourceId: number;
  progressRatio: number;
  anchor: string;
  completed: boolean;
  fontSize: number;
  fontFamily: "serif" | "sans" | string;
  lineHeight: number;
  contentWidth: "narrow" | "standard" | "wide" | string;
  translationMode: "original" | "bilingual" | "translation" | string;
  outlineJson: string;
  formatVersion: number;
  lastReadAt: string;
};

export type PlanItem = {
  id: number;
  title: string;
  planType: string;
  referenceId: string;
  dueDate: string;
  status: string;
  createdAt: string;
};

export type UploadItem = {
  id: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
  storageProvider: string;
  externalPath: string;
  status: string;
  deleteAfter: string;
};

export type CourseItem = {
  id: number;
  title: string;
  courseType: string;
  description: string;
  icon: string;
  status: string;
  pinned: boolean;
  sortOrder: number;
  resourceCount: number;
  resourceIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type NoteItem = {
  id: number;
  title: string;
  content: string;
  referenceType: string;
  referenceId: string;
  anchor: string;
  tags: string;
  markdownPath: string;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type VocabularyItem = {
  id: number;
  word: string;
  phonetic: string;
  definition: string;
  dictionaryDefinition: string;
  aiExplanation: string;
  example: string;
  exampleTranslation: string;
  sourceType: string;
  sourceId: string;
  sourceAnchor: string;
  sourceSentence: string;
  tags: string;
  mastered: boolean;
  reviewCount: number;
  nextReviewAt: string;
  fsrsState: number;
  fsrsStability: number;
  fsrsDifficulty: number;
  fsrsScheduledDays: number;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsLastReviewAt: string;
  createdAt: string;
};

export type ActivityItem = {
  id: number;
  skill: string;
  domain: string;
  title: string;
  referenceType: string;
  referenceId: string;
  durationMinutes: number;
  completed: boolean;
  studiedAt: string;
};

export type ProcessingJob = {
  id: number;
  inputType: string;
  sourceName: string;
  sourceUrl: string;
  uploadId: number | null;
  status: string;
  stage: string;
  progress: number;
  error: string;
  resultResourceId: number | null;
  deleteOriginalOnSuccess: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type OneDriveStatus = {
  configured: boolean;
  connected: boolean;
  accountLabel: string;
  lastSyncAt: string;
  redirectUri: string;
  appFolder: string;
  retentionDays: number;
};
