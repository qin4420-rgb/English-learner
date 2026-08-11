import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the private English learning hub", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /English Room/);
  assert.match(html, /私人英语学习空间/);
  assert.match(html, /学习台/);
  assert.match(html, /学习工具/);
  assert.match(html, /资源库/);
  assert.match(html, /维护中心/);
  assert.match(html, /文章阅读/);
  assert.match(html, /听力训练/);
  assert.match(html, /学习进度/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("V2 keeps media, TTS and speech capabilities behind shared interfaces", async () => {
  const [mediaPlayer, transcript, ncePlayer, providers, fixture, speaking] = await Promise.all([
    readFile(new URL("../app/components/MediaLearningPlayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TranscriptPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/NcePlayer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/_lib/providers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_fixtures/media.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/SpeakingStudio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(mediaPlayer, /import\("react-player"\)/);
  assert.match(mediaPlayer, /TranscriptPanel/);
  assert.match(transcript, /回到当前句/);
  assert.match(transcript, /循环当前句/);
  assert.match(ncePlayer, /MediaLearningPlayer/);
  assert.match(ncePlayer, /parseNceLrc/);
  assert.match(providers, /OCRProvider/);
  assert.match(providers, /PronunciationProvider/);
  assert.match(providers, /TTSProvider/);
  assert.match(providers, /runSTTUrl/);
  assert.match(fixture, /DEVELOPMENT_VIDEO_FIXTURE/);
  assert.match(speaking, /MediaRecorder/);
  assert.match(speaking, /不生成虚假分数/);
});

test("V2 resource core uses stable types, reviewable processing and source-aware vocabulary", async () => {
  const [model, library, reader, schema, lookup, processing] = await Promise.all([
    readFile(new URL("../app/resource-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ResourceLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ArticleReader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vocabulary/lookup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/processing/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(model, /"WordList", "Dictionary"/);
  assert.match(model, /Reading.*Listening.*Speaking.*Vocabulary/);
  assert.match(library, /统一添加资源/);
  assert.match(library, /全部加入单词本/);
  assert.match(reader, /切换到框内工作台/);
  assert.match(reader, /切换到页面阅读/);
  assert.match(reader, /scrollPageToRatio/);
  assert.match(reader, /requestFullscreen/);
  assert.match(reader, /reader-drawer/);
  assert.match(schema, /vocabularyOccurrences/);
  assert.match(schema, /dictionarySources/);
  assert.match(schema, /dictionaryEntries/);
  assert.match(lookup, /dictionary_entries/);
  assert.match(lookup, /在线基础词典/);
  assert.match(processing, /请打开复核工作台/);
  assert.match(processing, /review_required/);
});

test("Resource Library 3.0 keeps navigation, actions and batch maintenance discoverable", async () => {
  const [library, actions, batchRoute] = await Promise.all([
    readFile(new URL("../app/ResourceLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/library/resource-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/resources/batch/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(library, /RESOURCE LIBRARY 3\.0/);
  assert.match(library, /继续学习/);
  assert.match(library, /收件箱/);
  assert.match(library, /library-inspector/);
  assert.match(library, /useDeferredValue/);
  assert.match(library, /快速预览不会写入阅读进度/);
  assert.match(actions, /resourceDefaultAction/);
  assert.match(actions, /review_required/);
  assert.match(actions, /buildResourceActions/);
  assert.match(batchRoute, /"restore"/);
  assert.match(batchRoute, /"favorite"/);
});

test("Reader 3.0 canonical blocks keep translation IDs stable and reviewable", async () => {
  const { canonicalBlocks, inspectTranslationResult, renderReviewMarkdown, parseReviewMarkdown } = await import("../app/article-review.mjs");
  const blocks = canonicalBlocks("## First heading\n\nA complete first paragraph.\n\n> A quoted sentence.");
  assert.deepEqual(blocks.map((block) => block.id), ["p0001", "p0002", "p0003"]);
  assert.deepEqual(blocks.map((block) => block.type), ["h2", "paragraph", "quote"]);

  const result = inspectTranslationResult(blocks.map((block) => ({ id: block.id, text: block.original })), [
    { id: "p0001", translation: "第一个标题" },
    { id: "p0001", translation: "重复标题" },
    { id: "p9999", translation: "未知段落" },
  ]);
  assert.equal(result.translations.get("p0001"), "第一个标题");
  assert.ok(result.issues.some((issue) => issue.type === "duplicate_translation_id"));
  assert.ok(result.issues.some((issue) => issue.type === "unknown_translation_id"));
  assert.ok(result.issues.some((issue) => issue.blockId === "p0002" && issue.type === "missing_translation"));

  const translated = blocks.map((block, index) => ({ ...block, translation: `译文${index + 1}` }));
  const markdown = renderReviewMarkdown(translated, { id: "test", title: "Test Article" });
  assert.deepEqual(parseReviewMarkdown(markdown).map((block) => block.translation), ["译文1", "译文2", "译文3"]);
});

test("Article QA reports missing translation and suspected web noise", async () => {
  const { validateArticleDraft } = await import("../app/article-review.mjs");
  const validation = validateArticleDraft([
    { id: "p0001", type: "paragraph", original: "Subscribe to our newsletter for more updates.", translation: "", manualEdited: false },
    { id: "p0002", type: "paragraph", original: "The report contains twelve verified findings.", translation: "这份报告包含十二项已经核实的发现。", manualEdited: true },
  ]);
  assert.equal(validation.totalBlocks, 2);
  assert.equal(validation.translatedBlocks, 1);
  assert.ok(validation.issues.some((issue) => issue.type === "missing_translation" && issue.blockId === "p0001"));
  assert.ok(validation.issues.some((issue) => issue.type === "suspected_noise" && issue.blockId === "p0001"));
});

test("Processing 2.0 builds stable steps and resumes from the first unfinished checkpoint", async () => {
  const { createPipelineSteps, nextRunnableStep, pauseTransition, resumeTransition, retryStepTransition } = await import("../app/processing-pipeline.mjs");
  const steps = createPipelineSteps("Article");
  assert.deepEqual(steps.map((step) => step.key), ["original", "extract", "structure", "blockify", "enrich", "translate", "qa", "review", "publish", "sync"]);
  const checkpointed = steps.map((step) => ({ ...step, stepKey: step.key, sortOrder: step.order, status: ["original", "extract", "structure"].includes(step.key) ? "completed" : step.key === "translate" ? "failed" : "pending" }));
  assert.equal(nextRunnableStep(checkpointed).stepKey, "blockify");
  const paused = pauseTransition({ status: "running", pauseRequested: false });
  assert.equal(paused.status, "pausing");
  assert.equal(paused.pauseRequested, true);
  const resumed = resumeTransition({ status: "paused" }, checkpointed.map((step) => step.stepKey === "blockify" ? { ...step, status: "completed" } : step));
  assert.equal(resumed.currentStep, "enrich");
  const retried = retryStepTransition(checkpointed, "translate");
  assert.equal(retried.find((step) => step.stepKey === "translate").status, "pending");
  assert.equal(retried.find((step) => step.stepKey === "extract").status, "completed");
});

test("Processing errors distinguish 403, missing providers and invalid AI JSON", async () => {
  const { mapProcessingError, safeParseAIJson } = await import("../app/processing-pipeline.mjs");
  const blocked = mapProcessingError(new Error("网页读取失败（403）"));
  assert.equal(blocked.code, "SOURCE_HTTP_403");
  assert.equal(blocked.status, "needs_action");
  assert.ok(blocked.suggestedActions.includes("粘贴正文"));
  const stt = mapProcessingError(Object.assign(new Error("STT Provider 尚未配置"), { code: "STT_REQUIRED" }));
  assert.equal(stt.status, "needs_provider");
  assert.throws(() => safeParseAIJson('{"blocks":[{"id":"p0001"'), (error) => error.code === "AI_RESPONSE_TRUNCATED");
  assert.throws(() => safeParseAIJson("not json"), (error) => error.code === "AI_RESPONSE_INVALID_JSON");
});

test("Translation checkpoint keeps completed blocks and resumes with the remainder", async () => {
  const blocks = Array.from({ length: 100 }, (_, index) => ({ id: `p${String(index + 1).padStart(4, "0")}` }));
  const translations = Object.fromEntries(blocks.slice(0, 60).map((block) => [block.id, `译文 ${block.id}`]));
  const pending = blocks.filter((block) => !translations[block.id]);
  assert.equal(Object.keys(translations).length, 60);
  assert.equal(pending.length, 40);
  assert.equal(pending[0].id, "p0061");
});

test("HTML distillation preserves article headings, lists, quotes and links", async () => {
  const { htmlToStructuredMarkdown } = await import("../app/article-review.mjs");
  const markdown = htmlToStructuredMarkdown('<article><h2>Markets</h2><p>Read the <a href="https://example.com/report">report</a>.</p><ul><li>Growth</li><li>Inflation</li></ul><blockquote>Evidence matters.</blockquote></article>');
  assert.match(markdown, /## Markets/);
  assert.match(markdown, /\[report\]\(https:\/\/example\.com\/report\)/);
  assert.match(markdown, /- Growth/);
  assert.match(markdown, /- Inflation/);
  assert.match(markdown, /> Evidence matters\./);
});

test("Podcast URLs are recognized, converted and isolated to Apple embeds", async () => {
  const { isApplePodcastUrl, parseApplePodcastUrl, buildApplePodcastEmbedUrl } = await import("../app/apple-podcasts.mjs");
  const episodeUrl = "https://podcasts.apple.com/us/podcast/example/id123456?i=100012345&l=en";
  const showUrl = "https://podcasts.apple.com/cn/podcast/example/id123456";
  assert.equal(isApplePodcastUrl(episodeUrl), true);
  assert.equal(isApplePodcastUrl(showUrl), true);
  assert.equal(isApplePodcastUrl("https://example.com/us/podcast/example/id123456?i=100012345"), false);
  assert.equal(isApplePodcastUrl("http://podcasts.apple.com/us/podcast/example/id123456"), false);
  assert.equal(parseApplePodcastUrl(episodeUrl).kind, "episode");
  assert.equal(parseApplePodcastUrl(episodeUrl).episodeId, "100012345");
  assert.equal(parseApplePodcastUrl(showUrl).kind, "show");
  const embed = new URL(buildApplePodcastEmbedUrl(episodeUrl));
  assert.equal(embed.hostname, "embed.podcasts.apple.com");
  assert.equal(embed.pathname, "/us/podcast/example/id123456");
  assert.equal(embed.search, "?i=100012345&l=en");
});

test("Podcast integration reuses Resource, Processing and MediaLearningPlayer", async () => {
  const [studio, embed, route, processing] = await Promise.all([
    readFile(new URL("../app/PodcastStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ApplePodcastEmbed.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/podcasts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/_lib/podcasts.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /Podcast 泛听/);
  assert.match(studio, /加入精听/);
  assert.match(studio, /MediaLearningPlayer/);
  assert.match(embed, /buildApplePodcastEmbedUrl/);
  assert.match(embed, /allow-top-navigation-by-user-activation/);
  assert.match(route, /applePodcastResourceKey/);
  assert.match(route, /ON CONFLICT|SELECT \* FROM resources/);
  assert.match(processing, /resolvePodcastMediaSource/);
  assert.match(processing, /fetchPublicTranscript/);
  assert.match(processing, /restricted: !audioUrl/);
});

test("Media Processing 3.0 parses SRT and VTT into stable timed segments", async () => {
  const { parseTimedSubtitle } = await import("../app/media-processing.mjs");
  const srt = parseTimedSubtitle("1\n00:00:01,250 --> 00:00:03,500\nHello world.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line.", "srt");
  const vtt = parseTimedSubtitle("WEBVTT\n\n00:00:02.000 --> 00:00:04.250 align:start\nA VTT sentence.", "vtt");
  assert.deepEqual(srt.map((segment) => segment.id), ["s0001", "s0002"]);
  assert.deepEqual([srt[0].startMs, srt[0].endMs], [1250, 3500]);
  assert.equal(vtt[0].id, "s0001");
  assert.deepEqual([vtt[0].startMs, vtt[0].endMs], [2000, 4250]);
});

test("Media Processing 3.0 normalizes providers and keeps subtitle priority above STT", async () => {
  const { chooseTranscriptSource, normalizeMediaSegments, normalizeProviderSegments } = await import("../app/media-processing.mjs");
  const provider = normalizeProviderSegments([{ start: 1.5, end: 3, text: "Provider segment" }]);
  assert.deepEqual([provider[0].startMs, provider[0].endMs], [1500, 3000]);
  const normalized = normalizeMediaSegments([
    { startMs: 4000, endMs: 3000, originalText: "Later" },
    { startMs: 0, endMs: 2000, originalText: "First" },
    { startMs: 0, endMs: 2000, originalText: "First" },
  ]);
  assert.deepEqual(normalized.map((segment) => segment.id), ["s0001", "s0002"]);
  assert.ok(normalized[1].endMs > normalized[1].startMs);
  const selected = chooseTranscriptSource({ sidecarSegments: normalized.slice(0, 1), sttSegments: provider });
  assert.equal(selected.source, "sidecar");
  assert.equal(selected.segments[0].originalText, "First");
});

test("Media Processing 3.0 resumes translation and reports media QA issues", async () => {
  const { pendingMediaTranslation, validateMediaDraft } = await import("../app/media-processing.mjs");
  const segments = Array.from({ length: 100 }, (_, index) => ({ id: `s${String(index + 1).padStart(4, "0")}`, startMs: index * 2000, endMs: index * 2000 + 1800, originalText: `Sentence ${index + 1}.` }));
  const translations = Object.fromEntries(segments.slice(0, 60).map((segment) => [segment.id, `译文 ${segment.id}`]));
  assert.equal(pendingMediaTranslation(segments, translations).length, 40);
  const qa = validateMediaDraft([
    { id: "s0001", startMs: 5000, endMs: 4000, originalText: "", translationText: "" },
    { id: "s0002", startMs: 1000, endMs: 2000, originalText: "Valid English", translationText: "" },
  ], { durationMs: 3000, mediaKind: "audio", playableSource: "https://example.com/audio.mp3", transcriptSource: "srt", translationEntries: [{ id: "unknown", translation: "未知" }] });
  assert.ok(qa.issues.some((issue) => issue.type === "invalid_end"));
  assert.ok(qa.issues.some((issue) => issue.type === "timeline_reversed"));
  assert.ok(qa.issues.some((issue) => issue.type === "missing_translation"));
  assert.ok(qa.issues.some((issue) => issue.type === "unknown_translation_id"));
});

test("Media Processing 3.0 keeps draft, published and shared Processing 2.0 wiring explicit", async () => {
  const [pipeline, reviewRoute, reviewWorkspace, podcastRoute, actions, listening] = await Promise.all([
    readFile(new URL("../app/api/_lib/resource-processing.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/resources/[id]/media-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MediaReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/podcasts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/library/resource-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ListeningStudio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /raw-transcript\.json/);
  assert.match(pipeline, /draft-media\.json/);
  assert.match(pipeline, /translation\.json/);
  assert.match(pipeline, /validateMediaDraft/);
  assert.match(reviewRoute, /previousPublished/);
  assert.match(reviewRoute, /mediaSegments: saved\.segments/);
  assert.match(reviewWorkspace, /MediaLearningPlayer/);
  assert.match(reviewWorkspace, /当前仅渲染附近最多80条/);
  assert.match(podcastRoute, /initializeProcessingJob/);
  assert.doesNotMatch(podcastRoute, /processPodcastResource/);
  assert.match(actions, /加入精听/);
  assert.match(actions, /添加字幕/);
  assert.match(listening, /parseResourceMetadata\(resource\.metadataJson, resource\.resourceType\)\.mediaSegments/);
});
