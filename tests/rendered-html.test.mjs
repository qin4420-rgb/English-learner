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
  assert.match(processing, /"retry" \| "confirm" \| "later"/);
  assert.match(processing, /review_required/);
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
  assert.match(processing, /寻找公开RSS与音频/);
  assert.match(processing, /等待STT Provider/);
  assert.match(processing, /translateBlocks/);
});
