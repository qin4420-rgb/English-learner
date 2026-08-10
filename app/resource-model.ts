import type { MediaSegment } from "./types";

export const RESOURCE_TYPES = ["Article", "PDF", "Image", "Audio", "Video", "Podcast", "Subtitle", "Text", "WordList", "Dictionary", "Other"] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];
export const LEARNING_USES = ["Reading", "Listening", "Speaking", "Vocabulary"] as const;
export type LearningUse = typeof LEARNING_USES[number];

export type ResourceMetadata = {
  tags: string[];
  learningUses: LearningUse[];
  mediaSegments: MediaSegment[];
  candidateVocabulary: { word: string; meaning?: string; example?: string }[];
  wordList?: { count: number; importedCount: number; words: { word: string; definition?: string; phonetic?: string; example?: string; tags?: string }[] };
  dictionary?: { entryCount: number; sourceId?: number };
  podcast?: {
    provider?: "apple_podcasts" | string;
    appleUrl?: string;
    embedUrl?: string;
    showId?: string;
    episodeId?: string;
    showTitle?: string;
    episodeTitle?: string;
    feedUrl?: string;
    audioUrl?: string;
    durationMs?: number;
    studyMode?: "extensive" | "intensive" | string;
    intensiveStatus?: string;
    transcriptSource?: string;
    transcriptText?: string;
    [key: string]: unknown;
  };
  uploadId?: number;
  mimeType?: string;
  originalFilename?: string;
  summary?: string;
  themes?: string[];
  toolResources?: { title: string; url: string; note: string }[];
  attention?: string;
  personalNote?: string;
  [key: string]: unknown;
};

const TYPE_ALIASES: Record<string, ResourceType> = {
  article: "Article", "离线文章": "Article", "文章": "Article", "网页": "Article", "网页文章": "Article",
  pdf: "PDF", image: "Image", "图片": "Image", "图像": "Image",
  audio: "Audio", "音频": "Audio", "播客": "Podcast", podcast: "Podcast",
  "apple podcast": "Podcast", "apple podcasts": "Podcast",
  video: "Video", "视频": "Video", "视频链接": "Video",
  subtitle: "Subtitle", "字幕": "Subtitle", srt: "Subtitle", vtt: "Subtitle",
  text: "Text", "文本": "Text", markdown: "Text", txt: "Text",
  wordlist: "WordList", "word list": "WordList", "词库": "WordList", "词表": "WordList",
  dictionary: "Dictionary", "词典": "Dictionary",
  other: "Other", "其它": "Other", "其他": "Other", "网站": "Other", "学习网站": "Other",
};

export function normalizeResourceType(value: unknown): ResourceType {
  const raw = String(value || "").trim();
  if ((RESOURCE_TYPES as readonly string[]).includes(raw)) return raw as ResourceType;
  return TYPE_ALIASES[raw.toLowerCase()] || TYPE_ALIASES[raw] || "Other";
}

export function resourceTypeLabel(type: ResourceType): string {
  return ({ Article: "文章", PDF: "PDF", Image: "图片", Audio: "音频", Video: "视频", Podcast: "Podcast", Subtitle: "字幕", Text: "文本", WordList: "词库", Dictionary: "词典", Other: "其它" })[type];
}

export function normalizeTags(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，;；]/) : [];
  const seen = new Set<string>();
  return source.map((item) => String(item).replace(/\s+/g, " ").trim().slice(0, 40)).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

function normalizeLearningUses(value: unknown, type: ResourceType): LearningUse[] {
  const source = Array.isArray(value) ? value.map(String) : [];
  const uses = source.filter((item): item is LearningUse => (LEARNING_USES as readonly string[]).includes(item));
  if (uses.length) return Array.from(new Set(uses));
  if (["Article", "PDF", "Image", "Text", "Subtitle"].includes(type)) return ["Reading", "Vocabulary"];
  if (["Audio", "Video", "Podcast"].includes(type)) return ["Listening", "Speaking", "Vocabulary"];
  if (type === "WordList") return ["Vocabulary"];
  return [];
}

function normalizeSegments(value: unknown): MediaSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const startMs = Number(item.startMs);
    const originalText = String(item.originalText || item.text || "").trim();
    if (!Number.isFinite(startMs) || !originalText) return [];
    const endMs = Number(item.endMs);
    return [{ id: typeof item.id === "string" || typeof item.id === "number" ? item.id : `segment-${index}`, startMs, endMs: Number.isFinite(endMs) ? endMs : undefined, originalText, translationText: String(item.translationText || "").trim() || undefined }];
  }).sort((first, second) => first.startMs - second.startMs);
}

export function parseResourceMetadata(value: unknown, typeValue: unknown = "Other"): ResourceMetadata {
  let source: Record<string, unknown> = {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) source = parsed as Record<string, unknown>;
  } catch { /* Invalid legacy JSON becomes an empty, editable metadata object. */ }
  const type = normalizeResourceType(typeValue);
  const rawSegments = source.mediaSegments ?? source.segments ?? source.transcript;
  return {
    ...source,
    tags: normalizeTags(source.tags),
    learningUses: normalizeLearningUses(source.learningUses, type),
    mediaSegments: normalizeSegments(rawSegments),
    candidateVocabulary: Array.isArray(source.candidateVocabulary) ? source.candidateVocabulary.flatMap((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).word || "").trim() ? [{ word: String((entry as Record<string, unknown>).word).trim().toLowerCase(), meaning: String((entry as Record<string, unknown>).meaning || "").trim(), example: String((entry as Record<string, unknown>).example || "").trim() }] : []) : [],
  };
}

export function stringifyResourceMetadata(value: unknown, typeValue: unknown = "Other") {
  return JSON.stringify(parseResourceMetadata(value, typeValue));
}

export function inferResourceType(filenameOrUrl: string, mimeType = ""): ResourceType {
  const value = filenameOrUrl.toLowerCase().split(/[?#]/)[0];
  if (/^https:\/\/podcasts\.apple\.com\//.test(filenameOrUrl.toLowerCase())) return "Podcast";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(value) || /\.(mp4|webm|mov|m3u8|mpd)$/.test(value) || mimeType.startsWith("video/")) return "Video";
  if (/\.(mp3|m4a|wav|aac|ogg|flac)$/.test(value) || mimeType.startsWith("audio/")) return "Audio";
  if (/\.pdf$/.test(value) || mimeType.includes("pdf")) return "PDF";
  if (/\.(png|jpe?g|webp|gif|tiff?)$/.test(value) || mimeType.startsWith("image/")) return "Image";
  if (/\.(srt|vtt)$/.test(value)) return "Subtitle";
  if (/\.(md|markdown|txt|html?|rtf)$/.test(value) || mimeType.startsWith("text/")) return "Text";
  if (/^https?:/.test(value)) return "Article";
  return "Other";
}
