const SEGMENT_PREFIX = "s";

function stableId(index) {
  return `${SEGMENT_PREFIX}${String(index + 1).padStart(4, "0")}`;
}

function cleanText(value) {
  return String(value || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

export function parseMediaTime(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value)) : Number.NaN;
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return Number.NaN;
  const parts = normalized.split(":").map(Number);
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  const seconds = parts.pop() || 0;
  const minutes = parts.pop() || 0;
  const hours = parts.pop() || 0;
  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}

export function formatMediaTime(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(value % 1000);
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTimedSubtitle(value, source = "srt") {
  const text = String(value || "").replace(/^\uFEFF/, "").replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n/i, "");
  const blocks = text.split(/\n{2,}/);
  const parsed = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => /\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}/.test(line));
    if (timingIndex < 0) continue;
    const [startValue, endPart] = lines[timingIndex].split("-->");
    const startMs = parseMediaTime(startValue);
    const endMs = parseMediaTime(String(endPart || "").trim().split(/\s+/)[0]);
    const originalText = cleanText(lines.slice(timingIndex + 1).join("\n"));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !originalText) continue;
    parsed.push({ id: stableId(parsed.length), startMs, endMs, originalText, transcriptSource: source });
  }
  return normalizeMediaSegments(parsed);
}

function providerMilliseconds(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Number.NaN;
  if (/Ms$/i.test(key)) return Math.round(number);
  return Math.round(number * 1000);
}

export function normalizeProviderSegments(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const startKey = ["startMs", "startTime", "start"].find((key) => entry[key] != null) || "start";
    const endKey = ["endMs", "endTime", "end"].find((key) => entry[key] != null) || "end";
    const startMs = providerMilliseconds(entry[startKey], startKey);
    const endMs = providerMilliseconds(entry[endKey], endKey);
    const originalText = cleanText(entry.originalText ?? entry.text ?? entry.body);
    if (!Number.isFinite(startMs) || !originalText) return [];
    return [{
      id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : stableId(index),
      startMs,
      endMs,
      originalText,
      translationText: cleanText(entry.translationText),
      speaker: cleanText(entry.speaker),
      confidence: Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : undefined,
    }];
  });
  return normalizeMediaSegments(normalized);
}

export function normalizeMediaSegments(value, options = {}) {
  if (!Array.isArray(value)) return [];
  const durationMs = Math.max(0, Number(options.durationMs) || 0);
  const sorted = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const startMs = Math.max(0, Math.round(Number(entry.startMs)));
    const originalText = cleanText(entry.originalText ?? entry.text);
    if (!Number.isFinite(startMs) || !originalText) return [];
    return [{
      ...entry,
      startMs,
      endMs: Math.round(Number(entry.endMs)),
      originalText,
      translationText: cleanText(entry.translationText) || undefined,
      speaker: cleanText(entry.speaker) || undefined,
      confidence: Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : undefined,
    }];
  }).sort((first, second) => first.startMs - second.startMs);
  const deduped = sorted.filter((segment, index, list) => !list.slice(0, index).some((previous) => previous.startMs === segment.startMs && previous.originalText.toLocaleLowerCase() === segment.originalText.toLocaleLowerCase()));
  return deduped.map((segment, index) => {
    const nextStart = deduped[index + 1]?.startMs;
    let endMs = Number(segment.endMs);
    if (!Number.isFinite(endMs) || endMs <= segment.startMs) endMs = nextStart && nextStart > segment.startMs ? nextStart : segment.startMs + 5000;
    if (durationMs) endMs = Math.min(endMs, durationMs);
    if (endMs <= segment.startMs) endMs = segment.startMs + 250;
    return { ...segment, id: stableId(index), endMs };
  });
}

export function chooseTranscriptSource(input = {}) {
  const candidates = [
    ["sidecar", input.sidecarSegments],
    ["resource", input.resourceSegments],
    ["rss", input.rssSegments],
    ["public", input.publicSegments],
    ["stt", input.sttSegments],
  ];
  const found = candidates.find(([, segments]) => Array.isArray(segments) && segments.length);
  return found ? { source: found[0], segments: normalizeMediaSegments(found[1], { durationMs: input.durationMs }) } : { source: "", segments: [] };
}

export function pendingMediaTranslation(segments, translations = {}) {
  return normalizeMediaSegments(segments).filter((segment) => !String(translations[String(segment.id)] || segment.translationText || "").trim());
}

export function validateMediaDraft(segments, metadata = {}) {
  const issues = [];
  const source = Array.isArray(segments) ? segments : [];
  const ids = new Set();
  let previous = null;
  source.forEach((segment, index) => {
    const id = String(segment?.id || stableId(index));
    const startMs = Number(segment?.startMs);
    const endMs = Number(segment?.endMs);
    const originalText = cleanText(segment?.originalText);
    const translationText = cleanText(segment?.translationText);
    const add = (severity, type, message) => issues.push({ id: `${type}-${id}-${index}`, blockId: id, severity, type, message });
    if (ids.has(id)) add("error", "duplicate_id", "Segment ID重复");
    ids.add(id);
    if (!originalText) add("error", "empty_transcript", "英文文字稿为空");
    if (!Number.isFinite(startMs) || startMs < 0) add("error", "invalid_start", "开始时间无效");
    if (!Number.isFinite(endMs) || endMs <= startMs) add("error", "invalid_end", "结束时间必须晚于开始时间");
    if (originalText.length > 700 || endMs - startMs > 60000) add("warning", "long_segment", "Segment过长，建议人工确认是否拆分");
    if (!translationText) add("error", "missing_translation", "缺少中文译文");
    else if (translationText.length < Math.max(1, originalText.length * .04)) add("warning", "short_translation", "中文译文异常短");
    else if (translationText.length > Math.max(80, originalText.length * 4)) add("warning", "long_translation", "中文译文异常长");
    if (previous) {
      if (startMs < Number(previous.startMs)) add("error", "timeline_reversed", "时间轴发生倒序");
      if (startMs < Number(previous.endMs) - 300) add("warning", "timeline_overlap", "与上一Segment明显重叠");
      if (startMs - Number(previous.endMs) > 120000) add("warning", "large_gap", "与上一Segment存在巨大时间空档");
      if (originalText && originalText.toLocaleLowerCase() === cleanText(previous.originalText).toLocaleLowerCase()) add("warning", "duplicate_text", "与上一Segment文字重复");
    }
    if (Number(metadata.durationMs) > 0 && endMs > Number(metadata.durationMs) + 1000) add("error", "beyond_duration", "Segment超出媒体时长");
    previous = segment;
  });
  if (!source.length) issues.push({ id: "empty-media-draft", severity: "error", type: "empty_segments", message: "没有可发布的Timed Segments" });
  if (!(Number(metadata.durationMs) > 0)) issues.push({ id: "missing-duration", severity: "warning", type: "missing_duration", message: "媒体时长尚未确认" });
  if (!metadata.mediaKind) issues.push({ id: "missing-media-kind", severity: "error", type: "missing_media_kind", message: "缺少媒体类型" });
  if (!metadata.playableSource) issues.push({ id: "missing-playable-source", severity: "error", type: "missing_playable_source", message: "缺少可播放媒体来源" });
  if (!metadata.transcriptSource) issues.push({ id: "missing-transcript-source", severity: "warning", type: "missing_transcript_source", message: "未记录Transcript来源" });
  if (Array.isArray(metadata.translationEntries)) {
    const knownIds = new Set(source.map((segment) => String(segment.id)));
    const seenTranslationIds = new Set();
    metadata.translationEntries.forEach((entry, index) => {
      const id = String(entry?.id || "");
      if (!knownIds.has(id)) issues.push({ id: `unknown-translation-${index}`, blockId: id || undefined, severity: "error", type: "unknown_translation_id", message: "译文包含未知Segment ID" });
      if (seenTranslationIds.has(id)) issues.push({ id: `duplicate-translation-${index}`, blockId: id || undefined, severity: "error", type: "duplicate_translation_id", message: "同一Segment出现重复译文" });
      seenTranslationIds.add(id);
      if (!cleanText(entry?.translationText ?? entry?.translation)) issues.push({ id: `empty-translation-${index}`, blockId: id || undefined, severity: "error", type: "empty_translation", message: "译文内容为空" });
    });
  }
  return {
    totalSegments: source.length,
    translatedSegments: source.filter((segment) => cleanText(segment?.translationText)).length,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

export function mergeMediaSegments(segments, index, offset) {
  const source = normalizeMediaSegments(segments);
  const target = index + offset;
  if (index < 0 || target < 0 || index >= source.length || target >= source.length) return source;
  const first = Math.min(index, target);
  const second = Math.max(index, target);
  return normalizeMediaSegments(source.filter((_, itemIndex) => itemIndex !== second).map((segment, itemIndex) => itemIndex !== first ? segment : {
    ...segment,
    startMs: source[first].startMs,
    endMs: source[second].endMs,
    originalText: `${source[first].originalText} ${source[second].originalText}`.trim(),
    translationText: `${source[first].translationText || ""} ${source[second].translationText || ""}`.trim() || undefined,
    needsReview: true,
  }));
}

export function splitMediaSegment(segments, index, characterOffset) {
  const source = normalizeMediaSegments(segments);
  const segment = source[index];
  const offset = Math.max(1, Math.min(segment?.originalText.length - 1, Number(characterOffset) || 0));
  if (!segment || offset <= 0 || offset >= segment.originalText.length) return source;
  const firstText = segment.originalText.slice(0, offset).trim();
  const secondText = segment.originalText.slice(offset).trim();
  if (!firstText || !secondText) return source;
  const ratio = firstText.length / Math.max(1, firstText.length + secondText.length);
  const splitAt = Math.round(segment.startMs + (segment.endMs - segment.startMs) * ratio);
  return normalizeMediaSegments(source.flatMap((item, itemIndex) => itemIndex !== index ? [item] : [
    { ...item, originalText: firstText, translationText: undefined, endMs: splitAt, needsReview: true },
    { ...item, originalText: secondText, translationText: undefined, startMs: splitAt, needsReview: true },
  ]));
}
