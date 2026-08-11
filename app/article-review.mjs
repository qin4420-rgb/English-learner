const BLOCK_PATTERN = /<!--\s*block:([a-z]\d{4,})\s*-->\s*\n?([\s\S]*?)(?=\n\s*<!--\s*block:[a-z]\d{4,}\s*-->|$)/gi;
const NOISE_PATTERNS = [
  /\badvertisement\b/i,
  /\bsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bcookie(?:s| policy)?\b/i,
  /\bfollow us\b/i,
  /\bsign up\b/i,
  /\brelated stories\b/i,
  /\bshare this article\b/i,
];

export function blockId(index) {
  return `p${String(index + 1).padStart(4, "0")}`;
}

function inferBlockType(text) {
  if (/^###\s+/.test(text)) return "h3";
  if (/^##\s+/.test(text)) return "h2";
  if (/^>\s+/.test(text)) return "quote";
  if (/^(?:[-*+]\s+|\d+\.\s+)/.test(text)) return "list";
  if (/^!\[[^\]]*\]\(/.test(text)) return "caption";
  if (/^\[[^\]]+\]\([^)]*\)$/.test(text)) return "link";
  return "paragraph";
}

function cleanBlockText(value) {
  return String(value || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function canonicalBlocks(value) {
  const source = cleanBlockText(value);
  if (!source) return [];
  const parsed = [];
  BLOCK_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(BLOCK_PATTERN)) {
    const text = cleanBlockText(match[2]);
    if (text) parsed.push({ id: match[1].toLowerCase(), type: inferBlockType(text), original: text, translation: "", manualEdited: false });
  }
  if (parsed.length) return normalizeReviewBlocks(parsed);
  const chunks = source.split(/\n{2,}/).map(cleanBlockText).filter(Boolean);
  return chunks.map((text, index) => ({ id: blockId(index), type: inferBlockType(text), original: text, translation: "", manualEdited: false }));
}

export function parseReviewMarkdown(markdown) {
  const body = String(markdown || "").replace(/^---\n[\s\S]*?\n---\n?/, "");
  const originalMarker = body.search(/^## English Original\s*$/m);
  const translationMarker = body.search(/^## 中文翻译\s*$/m);
  const vocabularyMarker = body.search(/^## 重点词汇\s*$/m);
  const afterLine = (index) => index < 0 ? 0 : Math.min(body.length, body.indexOf("\n", index) + 1 || body.length);
  const original = originalMarker >= 0 ? body.slice(afterLine(originalMarker), translationMarker >= 0 ? translationMarker : body.length) : body;
  const translation = translationMarker >= 0 ? body.slice(afterLine(translationMarker), vocabularyMarker >= 0 ? vocabularyMarker : body.length) : "";
  const originals = canonicalBlocks(original);
  const translations = new Map();
  BLOCK_PATTERN.lastIndex = 0;
  for (const match of translation.matchAll(BLOCK_PATTERN)) translations.set(match[1].toLowerCase(), cleanBlockText(match[2]));
  if (!translations.size) {
    translation.split(/\n{2,}/).map(cleanBlockText).filter((item) => item && !/^尚未生成译文/.test(item)).forEach((item, index) => translations.set(originals[index]?.id || blockId(index), item));
  }
  return originals.map((block) => ({ ...block, translation: translations.get(block.id) || "" }));
}

export function normalizeReviewBlocks(blocks) {
  const result = [];
  for (const entry of Array.isArray(blocks) ? blocks : []) {
    const original = cleanBlockText(entry?.original);
    if (!original) continue;
    const pieces = original.split(/\n{2,}/).map(cleanBlockText).filter(Boolean);
    pieces.forEach((piece, pieceIndex) => result.push({
      id: "",
      type: pieceIndex === 0 && entry?.type ? String(entry.type) : inferBlockType(piece),
      original: piece,
      translation: pieceIndex === 0 ? cleanBlockText(entry?.translation) : "",
      manualEdited: Boolean(entry?.manualEdited),
    }));
  }
  return result.map((entry, index) => ({ ...entry, id: blockId(index) }));
}

export function renderBlockSection(blocks, field) {
  return blocks.map((block) => `<!-- block:${block.id} -->\n${cleanBlockText(block[field])}`).join("\n\n");
}

export function renderReviewMarkdown(blocks, frontmatter = {}, enrichment = {}) {
  const normalized = normalizeReviewBlocks(blocks);
  const title = String(frontmatter.title || "学习资料");
  const yaml = (value) => JSON.stringify(String(value || ""));
  const vocabulary = Array.isArray(enrichment.vocabulary) && enrichment.vocabulary.length
    ? enrichment.vocabulary.map((item) => `- **${item.word}**：${item.meaning || ""}${item.example ? `\n  - ${item.example}` : ""}`).join("\n")
    : "- 暂无；可在阅读时点击单词加入生词本。";
  return `---\nid: ${yaml(frontmatter.id || "")}\ntitle: ${yaml(title)}\nsource_type: ${yaml(frontmatter.sourceType || "Article")}\nsource_url: ${yaml(frontmatter.sourceUrl || "")}\ncaptured_at: ${yaml(frontmatter.capturedAt || new Date().toISOString())}\nissue_date: ${yaml(frontmatter.issueDate || "")}\npage_count: ${Number(frontmatter.pageCount || 0)}\nai_enhanced: ${frontmatter.aiEnhanced ? "true" : "false"}\nversion: 2\n---\n\n# ${title}\n\n## 主要内容\n\n${String(enrichment.summary || "待人工复核后补充。")}\n\n## 主题\n\n${Array.isArray(enrichment.themes) && enrichment.themes.length ? enrichment.themes.map((theme) => `- ${theme}`).join("\n") : "- 待补充"}\n\n## English Original\n\n${renderBlockSection(normalized, "original")}\n\n## 中文翻译\n\n${renderBlockSection(normalized, "translation")}\n\n## 重点词汇\n\n${vocabulary}\n`;
}

export function inspectTranslationResult(inputBlocks, items) {
  const expected = new Set(inputBlocks.map((block) => block.id));
  const seen = new Set();
  const translations = new Map();
  const issues = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim().toLowerCase();
    const translation = cleanBlockText(item?.translation);
    if (!expected.has(id)) {
      issues.push({ id: `unknown-${id || issues.length}`, blockId: id || undefined, severity: "error", type: "unknown_translation_id", message: `译文返回了未知ID：${id || "空ID"}` });
      continue;
    }
    if (seen.has(id)) {
      issues.push({ id: `duplicate-translation-${id}`, blockId: id, severity: "error", type: "duplicate_translation_id", message: `${id} 返回了重复译文` });
      continue;
    }
    seen.add(id);
    if (!translation) issues.push({ id: `empty-translation-${id}`, blockId: id, severity: "error", type: "empty_translation", message: `${id} 的译文为空` });
    else translations.set(id, translation);
  }
  for (const block of inputBlocks) if (!translations.has(block.id)) issues.push({ id: `missing-translation-${block.id}`, blockId: block.id, severity: "error", type: "missing_translation", message: `${block.id} 缺少译文` });
  return { translations, issues };
}

function chineseCount(value) {
  return (String(value || "").match(/[\u3400-\u9fff]/g) || []).length;
}

export function validateArticleDraft(blocks) {
  const issues = [];
  const ids = new Set();
  const originals = new Map();
  let translatedBlocks = 0;
  blocks.forEach((block, index) => {
    const id = String(block.id || "");
    const original = cleanBlockText(block.original);
    const translation = cleanBlockText(block.translation);
    if (!id) issues.push({ id: `missing-id-${index}`, severity: "error", type: "missing_block_id", message: `第 ${index + 1} 段缺少Block ID` });
    else if (ids.has(id)) issues.push({ id: `duplicate-id-${id}-${index}`, blockId: id, severity: "error", type: "duplicate_block_id", message: `${id} 重复` });
    else ids.add(id);
    if (id && id !== blockId(index)) issues.push({ id: `sequence-${id}`, blockId: id, severity: "warning", type: "block_id_sequence", message: `${id} 不在连续顺序中，保存草稿时会标准化` });
    if (!original) issues.push({ id: `empty-${id || index}`, blockId: id || undefined, severity: "error", type: "empty_block", message: `${id || `第${index + 1}段`} 英文为空` });
    if (original.length > 6000) issues.push({ id: `long-${id}`, blockId: id, severity: "warning", type: "long_block", message: `${id} 过长，建议拆分` });
    if (original.length < 8) issues.push({ id: `short-${id}`, blockId: id, severity: "info", type: "short_block", message: `${id} 很短，请确认是否为标题或噪音` });
    const normalizedOriginal = original.toLowerCase().replace(/\s+/g, " ");
    if (originals.has(normalizedOriginal)) issues.push({ id: `duplicate-block-${id}`, blockId: id, severity: "warning", type: "duplicate_block", message: `${id} 与 ${originals.get(normalizedOriginal)} 内容重复` });
    else originals.set(normalizedOriginal, id);
    if (["h2", "h3"].includes(block.type) && !/^#{2,3}\s+/.test(original)) issues.push({ id: `heading-${id}`, blockId: id, severity: "warning", type: "heading_level", message: `${id} 标记为标题但正文缺少对应Markdown标题` });
    if (NOISE_PATTERNS.some((pattern) => pattern.test(original))) issues.push({ id: `noise-${id}`, blockId: id, severity: "warning", type: "suspected_noise", message: `${id} 疑似包含网页广告、订阅或分享噪音` });
    if (!translation) issues.push({ id: `missing-translation-${id}`, blockId: id, severity: "error", type: "missing_translation", message: `${id} 缺少译文` });
    else {
      translatedBlocks += 1;
      const chinese = chineseCount(translation);
      const english = (translation.match(/[A-Za-z]+/g) || []).length;
      const originalWords = (original.match(/[A-Za-z]+/g) || []).length;
      if (chinese < Math.max(2, originalWords * 0.18)) issues.push({ id: `translation-short-${id}`, blockId: id, severity: "warning", type: "translation_too_short", message: `${id} 中文明显偏短` });
      if (chinese > Math.max(120, originalWords * 4.5)) issues.push({ id: `translation-long-${id}`, blockId: id, severity: "warning", type: "translation_too_long", message: `${id} 中文明显偏长` });
      if (english > Math.max(12, chinese * 0.55)) issues.push({ id: `translation-language-${id}`, blockId: id, severity: "warning", type: "translation_language_ratio", message: `${id} 译文中英文比例异常` });
    }
  });
  return { totalBlocks: blocks.length, translatedBlocks, issues, checkedAt: new Date().toISOString() };
}

export function htmlToStructuredMarkdown(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|form|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `[${label.replace(/<[^>]+>/g, " ").trim()}](${href})`)
    .replace(/<h1[^>]*>/gi, "\n\n# ").replace(/<\/h1>/gi, "\n\n")
    .replace(/<h2[^>]*>/gi, "\n\n## ").replace(/<\/h2>/gi, "\n\n")
    .replace(/<h3[^>]*>/gi, "\n\n### ").replace(/<\/h3>/gi, "\n\n")
    .replace(/<blockquote[^>]*>/gi, "\n\n> ").replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol)>/gi, "\n\n")
    .replace(/<(p|div|section|article|ul|ol)[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
