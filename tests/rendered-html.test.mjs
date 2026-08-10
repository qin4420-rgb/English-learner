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
  assert.match(reader, />框内</);
  assert.match(reader, />页面</);
  assert.match(reader, /position is implemented in CSS|reader-mode-switch/);
  assert.match(schema, /vocabularyOccurrences/);
  assert.match(schema, /dictionarySources/);
  assert.match(schema, /dictionaryEntries/);
  assert.match(lookup, /dictionary_entries/);
  assert.match(lookup, /在线基础词典/);
  assert.match(processing, /"retry" \| "confirm" \| "later"/);
  assert.match(processing, /review_required/);
});
