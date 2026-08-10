"use client";

import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CourseItem, ReadingProgressItem, ResourceItem, VocabularyItem } from "./types";

type Props = {
  courses: CourseItem[];
  resources: ResourceItem[];
  vocabulary: VocabularyItem[];
  onReloadVocabulary: () => Promise<void>;
  onNotice: (message: string) => void;
};

type ReaderSection = {
  id: string;
  title: string;
  level: number;
  originalBlocks: string[];
  translationBlocks: string[];
};

type LookupResult = {
  word: string;
  phonetic: string;
  dictionaryDefinition: string;
  dictionaryEnglish: string;
  aiExplanation: string;
  example: string;
  exampleTranslation: string;
  sourceSentence: string;
  aiEnhanced: boolean;
};

const DEFAULT_PROGRESS: Omit<ReadingProgressItem, "id" | "resourceId" | "lastReadAt"> = {
  progressRatio: 0,
  anchor: "",
  completed: false,
  fontSize: 20,
  fontFamily: "serif",
  lineHeight: 1.9,
  contentWidth: "standard",
  translationMode: "original",
  outlineJson: "[]",
  formatVersion: 1,
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function cleanMarkdown(value: string) {
  return value.replace(/<!-- block:[^>]+-->/g, "").trim();
}

function splitArticleMarkdown(markdown: string) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const originalMarker = body.search(/^## English Original\s*$/m);
  const translationMarker = body.search(/^## 中文翻译\s*$/m);
  const vocabularyMarker = body.search(/^## 重点词汇\s*$/m);
  const markerEnd = (index: number) => {
    if (index < 0) return 0;
    const newline = body.indexOf("\n", index);
    return newline >= 0 ? newline + 1 : body.length;
  };
  const originalStart = markerEnd(originalMarker);
  const originalEnd = translationMarker >= 0 ? translationMarker : vocabularyMarker >= 0 ? vocabularyMarker : body.length;
  const translationStart = markerEnd(translationMarker);
  const translationEnd = vocabularyMarker >= 0 ? vocabularyMarker : body.length;
  const original = originalMarker >= 0 ? body.slice(originalStart, originalEnd) : body;
  const translation = translationMarker >= 0 ? body.slice(translationStart, translationEnd) : "";
  return { original: cleanMarkdown(original), translation: cleanMarkdown(translation) };
}

function toBlocks(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+.+$/gm, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function shortTitle(block: string, index: number) {
  const plain = block
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = plain.split(/(?<=[.!?])\s+/)[0] || plain;
  return sentence ? `${sentence.slice(0, 54)}${sentence.length > 54 ? "…" : ""}` : `第 ${index + 1} 节`;
}

function buildReaderDocument(markdown: string) {
  const { original, translation } = splitArticleMarkdown(markdown);
  const translationBlocks = toBlocks(translation).filter((block) => !/^尚未生成译文/.test(block));
  const lines = original.split("\n");
  const headed: { title: string; level: number; body: string[] }[] = [];
  let current: { title: string; level: number; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (current?.body.join("\n").trim()) headed.push(current);
      current = { title: heading[2].replace(/[*_`]/g, "").trim(), level: heading[1].length, body: [] };
    } else {
      if (!current) current = { title: "正文", level: 2, body: [] };
      current.body.push(line);
    }
  }
  if (current?.body.join("\n").trim()) headed.push(current);

  let groups: { title: string; level: number; blocks: string[] }[];
  if (headed.length >= 2) {
    groups = headed.map((section) => ({ title: section.title, level: section.level, blocks: toBlocks(section.body.join("\n")) })).filter((section) => section.blocks.length);
  } else {
    const blocks = toBlocks(original);
    const groupSize = blocks.length > 20 ? 6 : blocks.length > 10 ? 5 : Math.max(1, blocks.length);
    groups = [];
    for (let index = 0; index < blocks.length; index += groupSize) {
      const sectionBlocks = blocks.slice(index, index + groupSize);
      groups.push({ title: shortTitle(sectionBlocks[0] || "", groups.length), level: 2, blocks: sectionBlocks });
    }
  }

  const originalCount = Math.max(1, groups.reduce((sum, group) => sum + group.blocks.length, 0));
  let originalOffset = 0;
  const sections: ReaderSection[] = groups.map((group, index) => {
    const start = Math.round(originalOffset / originalCount * translationBlocks.length);
    originalOffset += group.blocks.length;
    const end = Math.round(originalOffset / originalCount * translationBlocks.length);
    return {
      id: `reader-section-${index + 1}`,
      title: group.title || `第 ${index + 1} 节`,
      level: group.level,
      originalBlocks: group.blocks,
      translationBlocks: translationBlocks.slice(start, end),
    };
  });
  return { original, translation, sections, hasTranslation: translationBlocks.length > 0 };
}

function progressLabel(ratio: number) {
  if (ratio >= 0.98) return "已读完";
  if (ratio <= 0.01) return "未开始";
  return `${Math.round(ratio * 100)}%`;
}

function MarkdownBlock({ markdown, className }: { markdown: string; className?: string }) {
  return <div className={className} data-reader-block><ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown></div>;
}

export default function ArticleReader({ courses, resources, vocabulary, onReloadVocabulary, onNotice }: Props) {
  const readingCourses = useMemo(() => courses.filter((course) => course.status !== "hidden" && course.courseType === "reading"), [courses]);
  const articles = useMemo(() => resources.filter((resource) => resource.collection === "library" && resource.markdownObjectKey), [resources]);
  const [selectedCourseId, setSelectedCourseId] = useState(0);
  const [readingResourceId, setReadingResourceId] = useState(0);
  const [progressMap, setProgressMap] = useState<Record<number, ReadingProgressItem>>({});
  const [progressReady, setProgressReady] = useState(false);
  const [readerContent, setReaderContent] = useState({ resourceId: 0, markdown: "" });
  const [fontSize, setFontSize] = useState(DEFAULT_PROGRESS.fontSize);
  const [fontFamily, setFontFamily] = useState(DEFAULT_PROGRESS.fontFamily);
  const [lineHeight, setLineHeight] = useState(DEFAULT_PROGRESS.lineHeight);
  const [contentWidth, setContentWidth] = useState(DEFAULT_PROGRESS.contentWidth);
  const [translationMode, setTranslationMode] = useState(DEFAULT_PROGRESS.translationMode);
  const [wordbookOpen, setWordbookOpen] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [manualDefinition, setManualDefinition] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredResourceRef = useRef(0);

  const activeCourse = readingCourses.find((course) => course.id === selectedCourseId);
  const readableResources = activeCourse?.resourceIds.length
    ? articles.filter((resource) => activeCourse.resourceIds.includes(resource.id))
    : articles;
  const readingResource = readableResources.find((resource) => resource.id === readingResourceId) || readableResources[0];
  const readerMarkdown = readingResource && readerContent.resourceId === readingResource.id ? readerContent.markdown : "";
  const readerLoading = Boolean(readingResource && readerContent.resourceId !== readingResource.id);
  const document = useMemo(() => buildReaderDocument(readerMarkdown), [readerMarkdown]);
  const selectedProgress = readingResource ? progressMap[readingResource.id] : undefined;

  useEffect(() => {
    jsonRequest<{ progress: ReadingProgressItem[] }>("/api/reading-progress")
      .then(({ progress }) => {
        setProgressMap(Object.fromEntries(progress.map((item) => [item.resourceId, item])));
        const remembered = Number(localStorage.getItem("english-room-reader-resource") || 0);
        setReadingResourceId((current) => current || remembered || progress[0]?.resourceId || 0);
      })
      .catch((error: Error) => onNotice(error.message))
      .finally(() => setProgressReady(true));
  }, [onNotice]);

  useEffect(() => {
    if (!readingResource) return;
    localStorage.setItem("english-room-reader-resource", String(readingResource.id));
    let active = true;
    restoredResourceRef.current = 0;
    fetch(`/api/resources/${readingResource.id}/content`)
      .then(async (response) => {
        const data = await response.json() as { markdown?: string; error?: string };
        if (!response.ok) throw new Error(data.error || "文章读取失败");
        return data.markdown || "";
      })
      .then((markdown) => { if (active) setReaderContent({ resourceId: readingResource.id, markdown }); })
      .catch((error: Error) => {
        if (!active) return;
        setReaderContent({ resourceId: readingResource.id, markdown: "" });
        onNotice(error.message);
      });
    return () => { active = false; };
  }, [onNotice, readingResource]);

  useEffect(() => {
    if (!readingResource || !progressReady || restoredResourceRef.current === readingResource.id || !readerMarkdown) return;
    const saved = progressMap[readingResource.id];
    requestAnimationFrame(() => {
      setFontSize(saved?.fontSize || DEFAULT_PROGRESS.fontSize);
      setFontFamily(saved?.fontFamily || DEFAULT_PROGRESS.fontFamily);
      setLineHeight(saved?.lineHeight || DEFAULT_PROGRESS.lineHeight);
      setContentWidth(saved?.contentWidth || DEFAULT_PROGRESS.contentWidth);
      setTranslationMode(saved?.translationMode || DEFAULT_PROGRESS.translationMode);
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (!container) return;
        const anchorElement = saved?.anchor ? container.querySelector<HTMLElement>(`[data-section-id="${saved.anchor}"]`) : null;
        if ((saved?.progressRatio || 0) > 0) container.scrollTop = (saved?.progressRatio || 0) * Math.max(0, container.scrollHeight - container.clientHeight);
        else if (anchorElement) container.scrollTop = Math.max(0, anchorElement.offsetTop - 20);
        restoredResourceRef.current = readingResource.id;
      });
    });
  }, [progressMap, progressReady, readerMarkdown, readingResource]);

  const persistProgress = useCallback(async (resourceId: number, ratio: number, anchor: string) => {
    const outlineJson = JSON.stringify(document.sections.map((section) => ({ id: section.id, title: section.title, level: section.level })));
    await jsonRequest("/api/reading-progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId, progressRatio: ratio, anchor, completed: ratio >= 0.98, fontSize, fontFamily, lineHeight, contentWidth, translationMode, outlineJson, formatVersion: 1 }),
      keepalive: true,
    });
  }, [contentWidth, document.sections, fontFamily, fontSize, lineHeight, translationMode]);

  const scheduleProgressSave = useCallback((ratio: number, anchor: string) => {
    if (!readingResource) return;
    const resourceId = readingResource.id;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistProgress(resourceId, ratio, anchor).catch((error: Error) => onNotice(error.message));
    }, 700);
  }, [onNotice, persistProgress, readingResource]);

  function currentAnchor(container: HTMLDivElement) {
    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-reader-section]"));
    let anchor = sections[0]?.dataset.sectionId || "";
    for (const section of sections) {
      if (section.offsetTop <= container.scrollTop + 80) anchor = section.dataset.sectionId || anchor;
      else break;
    }
    return anchor;
  }

  function handleScroll() {
    const container = scrollRef.current;
    if (!container || !readingResource || restoredResourceRef.current !== readingResource.id) return;
    const total = Math.max(1, container.scrollHeight - container.clientHeight);
    const ratio = Math.min(1, Math.max(0, container.scrollTop / total));
    const anchor = currentAnchor(container);
    setProgressMap((current) => ({
      ...current,
      [readingResource.id]: {
        ...(current[readingResource.id] || DEFAULT_PROGRESS),
        id: current[readingResource.id]?.id || 0,
        resourceId: readingResource.id,
        progressRatio: ratio,
        anchor,
        completed: ratio >= 0.98,
        fontSize,
        fontFamily,
        lineHeight,
        contentWidth,
        translationMode,
        outlineJson: current[readingResource.id]?.outlineJson || "[]",
        formatVersion: 1,
        lastReadAt: new Date().toISOString(),
      },
    }));
    scheduleProgressSave(ratio, anchor);
  }

  useEffect(() => {
    if (!readingResource || restoredResourceRef.current !== readingResource.id) return;
    const saved = selectedProgress;
    scheduleProgressSave(saved?.progressRatio || 0, saved?.anchor || document.sections[0]?.id || "");
  }, [contentWidth, document.sections, fontFamily, fontSize, lineHeight, readingResource, scheduleProgressSave, selectedProgress, translationMode]);

  function jumpToSection(sectionId: string) {
    const container = scrollRef.current;
    const section = container?.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
    if (container && section) container.scrollTo({ top: Math.max(0, section.offsetTop - 18), behavior: "smooth" });
  }

  async function lookupWord(word: string, context: string, anchor: string) {
    setWordbookOpen(true);
    setManualDefinition("");
    setLookupLoading(true);
    setLookup({ word, phonetic: "", dictionaryDefinition: "", dictionaryEnglish: "", aiExplanation: "正在分析…", example: "", exampleTranslation: "", sourceSentence: context, aiEnhanced: false });
    try {
      const result = await jsonRequest<LookupResult>("/api/vocabulary/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word, context, resourceId: readingResource?.id, sourceAnchor: anchor }),
      });
      setLookup(result);
    } catch (error) {
      onNotice((error as Error).message);
      setLookup(null);
    } finally {
      setLookupLoading(false);
    }
  }

  function handleWordSelection(event: ReactMouseEvent<HTMLElement>) {
    const selected = window.getSelection()?.toString().trim() || "";
    const word = selected.match(/^[A-Za-z][A-Za-z'-]{0,60}$/)?.[0];
    if (!word) return;
    const target = event.target as HTMLElement;
    const block = target.closest<HTMLElement>("[data-reader-block]");
    const section = target.closest<HTMLElement>("[data-reader-section]");
    const context = (block?.textContent || section?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 800);
    void lookupWord(word, context, section?.dataset.sectionId || "");
  }

  async function addLookupToWordbook() {
    if (!lookup || !readingResource) return;
    try {
      await jsonRequest("/api/vocabulary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          word: lookup.word,
          phonetic: lookup.phonetic,
          definition: manualDefinition,
          dictionaryDefinition: lookup.dictionaryDefinition,
          aiExplanation: lookup.aiExplanation,
          example: lookup.example,
          exampleTranslation: lookup.exampleTranslation,
          sourceType: "resource",
          sourceId: String(readingResource.id),
          sourceAnchor: selectedProgress?.anchor || "",
          sourceSentence: lookup.sourceSentence,
          tags: "精读",
        }),
      });
      await onReloadVocabulary();
      onNotice("词典释义、AI解释、例句和文章原句已加入FSRS单词本");
    } catch (error) {
      onNotice((error as Error).message);
    }
  }

  function showExistingWord(item: VocabularyItem) {
    setWordbookOpen(true);
    setManualDefinition(item.definition);
    setLookup({
      word: item.word,
      phonetic: item.phonetic,
      dictionaryDefinition: item.dictionaryDefinition,
      dictionaryEnglish: "",
      aiExplanation: item.aiExplanation,
      example: item.example,
      exampleTranslation: item.exampleTranslation,
      sourceSentence: item.sourceSentence,
      aiEnhanced: Boolean(item.aiExplanation),
    });
  }

  if (!readingResource) {
    return <div className="panel empty-state"><strong>还没有可阅读的Markdown文章</strong><span>到维护中心上传PDF或提交网页链接，整理完成后会出现在这里。</span></div>;
  }

  const readerStyle = {
    "--reader-font-size": `${fontSize}px`,
    "--reader-line-height": String(lineHeight),
  } as CSSProperties;
  const articleWords = vocabulary.filter((item) => item.sourceId === String(readingResource.id));

  return <div className={`reader-shell ${wordbookOpen ? "wordbook-open" : ""}`}>
    <aside className="panel reader-navigator">
      <div className="reader-nav-heading"><p className="eyebrow">ARTICLE LIST</p><h2>文章选择</h2></div>
      <select value={selectedCourseId} onChange={(event) => setSelectedCourseId(Number(event.target.value))} aria-label="选择阅读课程">
        <option value="0">全部文章</option>
        {readingCourses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}
      </select>
      <div className="reader-article-list">
        {readableResources.map((resource) => {
          const ratio = progressMap[resource.id]?.progressRatio || 0;
          return <button className={resource.id === readingResource.id ? "active" : ""} key={resource.id} onClick={() => setReadingResourceId(resource.id)}>
            <span><strong>{resource.title}</strong><small>{progressLabel(ratio)}</small></span>
            <i><em style={{ width: `${Math.round(ratio * 100)}%` }} /></i>
          </button>;
        })}
      </div>
      <div className="reader-toc-heading"><p className="eyebrow">OUTLINE</p><h3>章节目录</h3><span>智能排版已保留</span></div>
      <nav className="reader-toc" aria-label="文章章节目录">
        {document.sections.map((section) => <button key={section.id} onClick={() => jumpToSection(section.id)}>{section.title}</button>)}
      </nav>
    </aside>

    <section className="panel reader-main">
      <header className="reader-toolbar">
        <div className="reader-title"><span>{readingResource.category}</span><h1>{readingResource.title}</h1><small>{progressLabel(selectedProgress?.progressRatio || 0)} · Markdown 阅读器 v1</small></div>
        <div className="reader-controls">
          <div className="reader-segment" aria-label="翻译显示方式">
            <button className={translationMode === "original" ? "active" : ""} onClick={() => setTranslationMode("original")}>原文</button>
            <button className={translationMode === "bilingual" ? "active" : ""} onClick={() => setTranslationMode("bilingual")} disabled={!document.hasTranslation}>双语</button>
            <button className={translationMode === "translation" ? "active" : ""} onClick={() => setTranslationMode("translation")} disabled={!document.hasTranslation}>译文</button>
          </div>
          <div className="reader-segment" aria-label="文章字号">
            <button onClick={() => setFontSize((value) => Math.max(14, value - 1))}>A−</button><span>{fontSize}</span><button onClick={() => setFontSize((value) => Math.min(30, value + 1))}>A＋</button>
          </div>
          <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)} aria-label="文章字体"><option value="serif">衬线字体</option><option value="sans">无衬线字体</option></select>
          <select value={lineHeight} onChange={(event) => setLineHeight(Number(event.target.value))} aria-label="文章行距"><option value="1.65">紧凑行距</option><option value="1.9">舒适行距</option><option value="2.15">宽松行距</option></select>
          <select value={contentWidth} onChange={(event) => setContentWidth(event.target.value)} aria-label="文章版心"><option value="narrow">窄版</option><option value="standard">标准</option><option value="wide">宽版</option></select>
          <button className="button secondary" onClick={() => setWordbookOpen((value) => !value)}>{wordbookOpen ? "隐藏词典" : "打开词典"}</button>
        </div>
        <div className="reader-progress-track"><span style={{ width: `${Math.round((selectedProgress?.progressRatio || 0) * 100)}%` }} /></div>
      </header>
      <div className={`reader-scroll reader-font-${fontFamily} reader-width-${contentWidth}`} style={readerStyle} ref={scrollRef} onScroll={handleScroll} onDoubleClick={handleWordSelection}>
        {readerLoading ? <div className="empty-state">正在读取并优化文章排版…</div> : <article className="reader-article">
          {document.sections.map((section) => <section id={section.id} data-reader-section data-section-id={section.id} key={section.id}>
            <h2>{section.title}</h2>
            {translationMode === "original" && section.originalBlocks.map((block, index) => <MarkdownBlock key={index} markdown={block} className="reader-block" />)}
            {translationMode === "translation" && section.translationBlocks.map((block, index) => <MarkdownBlock key={index} markdown={block} className="reader-block reader-translation" />)}
            {translationMode === "bilingual" && section.originalBlocks.map((block, index) => <div className="reader-bilingual-pair" data-reader-block key={index}><MarkdownBlock markdown={block} className="reader-original" />{section.translationBlocks[index] && <MarkdownBlock markdown={section.translationBlocks[index]} className="reader-translation" />}</div>)}
          </section>)}
          {!document.sections.length && <div className="empty-state">文章正文为空，可在资源库编辑Markdown后重新打开。</div>}
        </article>}
      </div>
    </section>

    {wordbookOpen && <aside className="panel reader-dictionary">
      <div className="reader-dictionary-heading"><div><p className="eyebrow">WORD BOOK</p><h2>阅读词典</h2><p>双击正文单词，自动查询并结合原句解释。</p></div><button onClick={() => setWordbookOpen(false)} aria-label="关闭阅读词典">×</button></div>
      {lookup ? <div className="reader-word-detail">
        <div className="reader-word-title"><strong>{lookup.word}</strong><span>{lookup.phonetic}</span>{lookupLoading && <i>查询中…</i>}</div>
        <section><h3>词典释义</h3><p>{lookup.dictionaryDefinition || "暂未查询到"}</p>{lookup.dictionaryEnglish && <details><summary>查看英文词典原义</summary><p>{lookup.dictionaryEnglish}</p></details>}</section>
        <section><h3>AI 语境解释</h3><p>{lookup.aiExplanation || "等待生成"}</p></section>
        {lookup.sourceSentence && <section><h3>文章原句</h3><blockquote>{lookup.sourceSentence}</blockquote></section>}
        {lookup.example && <section><h3>雅思风格例句</h3><blockquote>{lookup.example}</blockquote>{lookup.exampleTranslation && <p>{lookup.exampleTranslation}</p>}<small>学习用仿写例句，并非真实雅思试题原句。</small></section>}
        <label><span>自己的释义 / 记忆提示</span><textarea value={manualDefinition} onChange={(event) => setManualDefinition(event.target.value)} placeholder="写下你自己的理解、联想或易错点…" /></label>
        <div className="reader-word-actions"><button className="button secondary" disabled={lookupLoading} onClick={() => void lookupWord(lookup.word, lookup.sourceSentence, selectedProgress?.anchor || "")}>重新查询</button><button className="button primary" disabled={lookupLoading} onClick={() => void addLookupToWordbook()}>加入单词本</button></div>
      </div> : <div className="reader-word-empty"><strong>双击一个英文单词</strong><span>这里会显示词典释义、AI解释、文章原句和雅思风格例句。</span></div>}
      <div className="reader-saved-words"><h3>本文生词 · {articleWords.length}</h3>{articleWords.slice(0, 30).map((item) => <button key={item.id} onClick={() => showExistingWord(item)}><strong>{item.word}</strong><small>{item.dictionaryDefinition || item.definition || "等待补充释义"}</small></button>)}</div>
    </aside>}
  </div>;
}
