import { extractText, getDocumentProxy } from "unpdf";
import { getRuntimeBindings } from "@/app/api/_lib/runtime";

export type DistilledDocument = {
  title: string;
  summary: string;
  themes: string[];
  translation: string;
  vocabulary: { word: string; meaning: string; example?: string }[];
  original: string;
  pageCount?: number;
  aiEnhanced: boolean;
};

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”",
  };
  return value
    .replace(/&([a-zA-Z]+);/g, (_, name: string) => named[name] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(value: string): string {
  return decodeHtml(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToText(html: string): { title: string; text: string } {
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "网页文章");
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|form|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return { title, text: cleanText(cleaned) };
}

function readerText(value: string, url: URL): { title: string; text: string } {
  const title = value.match(/^Title:\s*(.+)$/mi)?.[1]?.trim() || url.pathname.split("/").filter(Boolean).pop() || url.hostname;
  const markdown = value.split(/^Markdown Content:\s*$/mi)[1] || value;
  const text = markdown
    .replace(/!\[[^\]]*\]\([^\n)]+\)/g, "")
    .replace(/^_?Article continues after this advertisement_?$/gim, "")
    .replace(/^FEATURED STORIES$/gim, "")
    .replace(/^NEWSINFO$/gim, "")
    .replace(/^Your subscription could not be saved\..*$/gim, "")
    .replace(/^Your subscription has been successful\.$/gim, "")
    .replace(/^\*\*READ:\s*/gim, "**相关阅读：");
  return { title: cleanText(title), text: cleanText(text) };
}

function looksLikeWholeSiteNavigation(text: string): boolean {
  const signals = [
    "LATEST NEWS STORIES",
    "Subscribe to our daily newsletter",
    "EDITOR'S PICK",
    "MOST READ",
    "FOLLOW US:",
    "View comments",
  ];
  return signals.filter((signal) => text.includes(signal)).length >= 2;
}

function validatePublicUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("只支持 http 或 https 网页链接");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1") {
    throw new Error("不能读取本地或内网链接");
  }
  return url;
}

export async function extractWebPage(sourceUrl: string): Promise<{ title: string; text: string }> {
  const url = validatePublicUrl(sourceUrl);
  let directStatus = 0;
  let directResult: { title: string; text: string } | null = null;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    directStatus = response.status;
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();
      const blocked = /just a moment|verify you are human|access denied|cf-chl-/i.test(raw.slice(0, 12000));
      if (!blocked) {
        directResult = contentType.includes("html") || /<html[\s>]/i.test(raw)
          ? htmlToText(raw)
          : { title: url.pathname.split("/").filter(Boolean).pop() || url.hostname, text: cleanText(raw) };
        if (directResult.text.length >= 80 && !looksLikeWholeSiteNavigation(directResult.text)) return directResult;
      }
    }
  } catch {
    directStatus = 0;
  }

  try {
    const fallback = await fetch(`https://r.jina.ai/${url.href}`, { headers: { accept: "text/plain", "x-no-cache": "true" } });
    if (!fallback.ok) throw new Error(String(fallback.status));
    const extracted = readerText(await fallback.text(), url);
    if (extracted.text.length < 80) throw new Error("正文过短");
    return extracted;
  } catch {
    if (directResult && directResult.text.length >= 80) return directResult;
    throw new Error(`网页读取失败（${directStatus || "网络受限"}）；网站拒绝自动抓取，且备用正文读取也未成功`);
  }
}

export async function extractUploadedText(
  bytes: ArrayBuffer,
  filename: string,
  contentType: string,
): Promise<{ title: string; text: string; pageCount?: number }> {
  const lowerName = filename.toLowerCase();
  if (contentType.includes("pdf") || lowerName.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: true });
    const text = cleanText(result.text);
    if (!text) throw new Error("PDF没有可提取文字，可能是扫描版；请保留原文件并使用OCR流程");
    return { title: filename.replace(/\.pdf$/i, ""), text, pageCount: result.totalPages };
  }
  const decoded = new TextDecoder().decode(bytes);
  if (contentType.includes("html") || /\.html?$/i.test(lowerName)) {
    const result = htmlToText(decoded);
    return { title: result.title || filename, text: result.text };
  }
  if (contentType.startsWith("text/") || /\.(md|markdown|txt|csv|srt|vtt)$/i.test(lowerName)) {
    return { title: filename.replace(/\.[^.]+$/, ""), text: cleanText(decoded) };
  }
  throw new Error("第一版支持 PDF、Markdown、TXT、HTML、字幕和网页链接；该文件类型暂不能安全转换");
}

async function aiEnrich(title: string, original: string): Promise<Omit<DistilledDocument, "original" | "pageCount" | "aiEnhanced"> | null> {
  const bindings = getRuntimeBindings();
  if (!bindings.DEEPSEEK_API_KEY) return null;
  const excerpt = original.slice(0, 80000);
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bindings.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: bindings.DEEPSEEK_MODEL || "deepseek-v4-pro",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 12000,
      messages: [
        {
          role: "system",
          content: "你是专业英文学习资料编辑。输出严格 JSON，字段必须是 title, summary, themes, translation, vocabulary。summary 用中文概括；themes 是中文字符串数组；translation 是忠实、自然、完整的中文译文；vocabulary 是数组，每项含 word, meaning, example。不要添加输入中不存在的事实。",
        },
        {
          role: "user",
          content: `请把以下英文资料整理成学习用 JSON。标题：${title}\n\n正文：\n${excerpt}`,
        },
      ],
    }),
  });
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "DeepSeek 内容整理失败");
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 没有返回整理内容");
  const parsed = JSON.parse(content) as Partial<Omit<DistilledDocument, "original" | "pageCount" | "aiEnhanced">>;
  return {
    title: String(parsed.title || title),
    summary: String(parsed.summary || ""),
    themes: Array.isArray(parsed.themes) ? parsed.themes.map(String).slice(0, 12) : [],
    translation: String(parsed.translation || ""),
    vocabulary: Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary.slice(0, 80).map((item) => ({ word: String(item.word || ""), meaning: String(item.meaning || ""), example: item.example ? String(item.example) : "" })).filter((item) => item.word)
      : [],
  };
}

export async function distillDocument(
  title: string,
  original: string,
  pageCount?: number,
): Promise<DistilledDocument> {
  const enhanced = await aiEnrich(title, original);
  return {
    title: enhanced?.title || title,
    summary: enhanced?.summary || "尚未配置AI增强；正文已经保存，可在维护中心补充摘要、翻译和重点词汇。",
    themes: enhanced?.themes || [],
    translation: enhanced?.translation || "",
    vocabulary: enhanced?.vocabulary || [],
    original,
    pageCount,
    aiEnhanced: Boolean(enhanced),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(Array.from(value).filter((character) => character.charCodeAt(0) !== 0).join(""));
}

function blockify(value: string): string {
  return value.split(/\n{2,}/).map((paragraph, index) => `<!-- block:p${String(index + 1).padStart(4, "0")} -->\n${paragraph.trim()}`).join("\n\n");
}

export function toMarkdown(
  document: DistilledDocument,
  options: { id: string; sourceType: string; sourceUrl?: string; capturedAt: string; issueDate?: string },
): string {
  const vocabulary = document.vocabulary.length
    ? document.vocabulary.map((item) => `- **${item.word}**：${item.meaning}${item.example ? `\n  - ${item.example}` : ""}`).join("\n")
    : "- 暂无；可在阅读时点击单词加入生词本。";
  return `---
id: ${yamlString(options.id)}
title: ${yamlString(document.title)}
source_type: ${yamlString(options.sourceType)}
source_url: ${yamlString(options.sourceUrl || "")}
captured_at: ${yamlString(options.capturedAt)}
issue_date: ${yamlString(options.issueDate || "")}
page_count: ${document.pageCount || 0}
ai_enhanced: ${document.aiEnhanced ? "true" : "false"}
version: 1
---

# ${document.title}

## 主要内容

${document.summary}

## 主题

${document.themes.length ? document.themes.map((theme) => `- ${theme}`).join("\n") : "- 待补充"}

## English Original

${blockify(document.original)}

## 中文翻译

${document.translation || "尚未生成译文。可在维护中心配置 DeepSeek API 后重新处理。"}

## 重点词汇

${vocabulary}
`;
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "article";
}
