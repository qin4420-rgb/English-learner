"use client";

import { FormEvent, useMemo, useState } from "react";
import type { VocabularyItem } from "./types";

type Props = {
  vocabulary: VocabularyItem[];
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function dueText(value: string, referenceTime: number): string {
  if (!value) return "现在可复习";
  const date = new Date(value.replace(" ", "T"));
  if (date.getTime() <= referenceTime) return "现在可复习";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function VocabularyCenter({ vocabulary, onReload, onNotice }: Props) {
  const [manualWord, setManualWord] = useState("");
  const [manualDefinition, setManualDefinition] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [reviewNow, setReviewNow] = useState(() => Date.now());
  const dueWords = useMemo(() => vocabulary.filter((item) => !item.mastered && (!item.nextReviewAt || new Date(item.nextReviewAt.replace(" ", "T")).getTime() <= reviewNow)), [reviewNow, vocabulary]);
  const reviewCard = dueWords[0];
  const visibleWords = vocabulary.filter((item) => `${item.word} ${item.definition} ${item.dictionaryDefinition} ${item.aiExplanation} ${item.tags}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function addWord(event: FormEvent) {
    event.preventDefault();
    try {
      await jsonRequest("/api/vocabulary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: manualWord, definition: manualDefinition, sourceType: "manual" }) });
      setManualWord(""); setManualDefinition(""); await onReload(); onNotice("单词已加入FSRS复习队列");
    } catch (error) { onNotice((error as Error).message); }
  }

  async function importWords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("word-file") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true);
    try {
      const body = new FormData(); body.append("file", input.files[0]);
      const result = await jsonRequest<{ processed: number; skipped: number }>("/api/vocabulary/import", { method: "POST", body });
      form.reset(); await onReload(); onNotice(`词表导入完成：处理 ${result.processed} 个单词${result.skipped ? `，跳过 ${result.skipped} 条重复或无效记录` : ""}`);
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }

  async function review(rating: number) {
    if (!reviewCard) return;
    setBusy(true);
    try {
      const result = await jsonRequest<{ nextReviewAt: string }>("/api/vocabulary/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: reviewCard.id, rating }) });
      const completedAt = Date.now();
      setReviewNow(completedAt); setRevealed(false); await onReload(); onNotice(`${reviewCard.word} 已按FSRS排到 ${dueText(result.nextReviewAt, completedAt)}`);
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }

  async function togglePaused(item: VocabularyItem) {
    await jsonRequest("/api/vocabulary", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, mastered: !item.mastered }) });
    await onReload();
  }

  async function removeWord(item: VocabularyItem) {
    if (!window.confirm(`确定删除单词“${item.word}”及其复习记录吗？`)) return;
    await jsonRequest(`/api/vocabulary?id=${item.id}`, { method: "DELETE" });
    await onReload();
  }

  function downloadTemplate() {
    const content = "word,definition,phonetic,example,tags\nresilient,有韧性的,/rɪˈzɪliənt/,She remained resilient.,新闻\n";
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "english-room-wordbook-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="page-heading vocabulary-heading"><div><p className="eyebrow">FSRS VOCABULARY</p><h1>我的单词本</h1><p>新词和外部词表进入同一个FSRS队列；根据“忘记、困难、认识、简单”自动安排下一次复习。</p></div><div className="vocabulary-summary"><span><strong>{dueWords.length}</strong> 今日待复习</span><span><strong>{vocabulary.length}</strong> 单词总数</span></div></div>

      <div className="vocabulary-workspace">
        <section className="panel review-panel">
          <div className="panel-heading"><div><p className="eyebrow">TODAY REVIEW</p><h2>FSRS 今日复习</h2><p>先回忆再显示答案，最后如实评分。</p></div><span className="count-badge">剩余 {dueWords.length}</span></div>
          {reviewCard ? <div className="review-card"><small>{reviewCard.tags || "英语词汇"}</small><h3>{reviewCard.word}</h3><span>{reviewCard.phonetic}</span>{revealed ? <div className="review-answer"><strong>{reviewCard.definition || reviewCard.dictionaryDefinition || reviewCard.aiExplanation || "尚未填写释义"}</strong>{reviewCard.sourceSentence ? <blockquote><small>文章原句</small>{reviewCard.sourceSentence}</blockquote> : reviewCard.example && <blockquote>{reviewCard.example}</blockquote>}<div className="rating-grid"><button disabled={busy} onClick={() => void review(1)}><b>忘记</b><small>Again</small></button><button disabled={busy} onClick={() => void review(2)}><b>困难</b><small>Hard</small></button><button disabled={busy} onClick={() => void review(3)}><b>认识</b><small>Good</small></button><button disabled={busy} onClick={() => void review(4)}><b>简单</b><small>Easy</small></button></div></div> : <button className="button primary reveal-button" onClick={() => setRevealed(true)}>显示答案</button>}</div> : <div className="empty-state review-empty"><strong>今天的复习完成了</strong><span>未来到期的单词仍会按FSRS日期保留。</span></div>}
        </section>

        <aside className="panel vocabulary-import-panel">
          <div className="panel-heading"><div><p className="eyebrow">IMPORT</p><h2>导入外部单词本</h2><p>支持CSV、TSV、TXT和JSON，兼容常见制表符词表。</p></div></div>
          <form onSubmit={importWords}><label className="word-import-zone"><input name="word-file" type="file" accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json" required /><span>选择词表文件</span><small>单次最多2MB、10,000词</small></label><button className="button primary" disabled={busy}>{busy ? "正在导入…" : "导入并加入FSRS"}</button></form>
          <button className="text-button" onClick={downloadTemplate}>下载CSV模板</button>
          <div className="import-format"><strong>推荐列顺序</strong><code>word, definition, phonetic, example, tags</code><small>只有word是必填项；重复单词会补充资料，不会清空原复习进度。</small></div>
        </aside>
      </div>

      <form className="panel vocabulary-add" onSubmit={addWord}><input required value={manualWord} onChange={(event) => setManualWord(event.target.value)} placeholder="输入一个新单词" /><input value={manualDefinition} onChange={(event) => setManualDefinition(event.target.value)} placeholder="中文释义或自己的理解" /><button className="button primary">加入复习</button></form>
      <div className="vocabulary-list-toolbar"><h2>全部单词</h2><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索单词、释义或标签…" aria-label="搜索单词本" /></div>
      <div className="vocabulary-grid">{visibleWords.map((item) => <article className={`panel vocabulary-card ${item.mastered ? "mastered" : ""}`} key={item.id}><div><strong>{item.word}</strong><span>{item.phonetic}</span></div><p>{item.definition || item.dictionaryDefinition || item.aiExplanation || "等待补充释义"}</p>{(item.aiExplanation || item.sourceSentence || item.example) && <details className="word-card-details"><summary>查看语境与例句</summary>{item.aiExplanation && <p><b>AI解释：</b>{item.aiExplanation}</p>}{item.sourceSentence && <blockquote><small>文章原句</small>{item.sourceSentence}</blockquote>}{item.example && <blockquote><small>雅思风格例句</small>{item.example}{item.exampleTranslation && <em>{item.exampleTranslation}</em>}</blockquote>}</details>}<div className="fsrs-meta"><span>{item.mastered ? "已暂停" : dueText(item.nextReviewAt, reviewNow)}</span><span>复习 {item.reviewCount} 次</span><span>稳定度 {item.fsrsStability ? item.fsrsStability.toFixed(1) : "—"}</span></div><div className="vocabulary-card-footer"><small>{item.sourceType === "resource" ? `来自文章 #${item.sourceId}` : item.sourceType === "import" ? "外部词表" : "手工添加"}</small><div><button onClick={() => void togglePaused(item)}>{item.mastered ? "恢复" : "暂停"}</button><button className="delete-word" onClick={() => void removeWord(item)}>删除</button></div></div></article>)}{!visibleWords.length && <div className="panel empty-state wide">没有匹配的单词。</div>}</div>
    </section>
  );
}
