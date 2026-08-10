"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { LEARNING_USES, RESOURCE_TYPES, parseResourceMetadata, resourceTypeLabel, type LearningUse, type ResourceType } from "./resource-model";
import type { ReadingFolderItem, ReadingProgressItem, ResourceItem } from "./types";

type Props = {
  resources: ResourceItem[];
  onRead: (resource: ResourceItem) => void;
  onStartLearning: (resource: ResourceItem, use: LearningUse) => void;
  onReloadResources: () => Promise<void>;
  onNotice: (message: string) => void;
  onToggleFavorite: (resource: ResourceItem) => Promise<void>;
};

type LibraryTab = "all" | "inbox" | "favorite" | "archived";

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function statusLabel(status: string) {
  return ({ queued: "排队中", waiting: "等待处理", processing: "处理中", review_required: "待复核", needs_provider: "待配置", failed: "失败", sync_pending: "待同步", ready: "可学习" } as Record<string, string>)[status] || status;
}

function ResourceImportModal({ folders, onClose, onDone, onNotice }: { folders: ReadingFolderItem[]; onClose: () => void; onDone: () => Promise<void>; onNotice: (message: string) => void }) {
  const [tab, setTab] = useState<"file" | "link" | "wordlist" | "dictionary">("file");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType | "">("");
  const [tags, setTags] = useState("");
  const [folderId, setFolderId] = useState(0);
  const [learningUses, setLearningUses] = useState<LearningUse[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      if (tab === "link") {
        await jsonRequest("/api/resources/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, title, resourceType: resourceType || undefined, tags: tags.split(/[,，]/), folderId: folderId || undefined, learningUses }) });
      } else {
        const input = event.currentTarget.elements.namedItem("files") as HTMLInputElement;
        if (!input.files?.length) throw new Error("请选择文件");
        const body = new FormData();
        [...input.files].forEach((file) => body.append("files", file));
        body.append("resourceType", tab === "wordlist" ? "WordList" : tab === "dictionary" ? "Dictionary" : resourceType);
        body.append("tags", tags); body.append("folderId", String(folderId)); body.append("learningUses", learningUses.join(","));
        await jsonRequest("/api/resources/import", { method: "POST", body });
      }
      await onDone(); onNotice("资源已建立；需处理的内容已进入处理队列。原始文件会保留。 "); onClose();
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }

  const accept = tab === "wordlist" ? ".csv,.tsv,.txt,.json" : tab === "dictionary" ? ".csv,.tsv,.json" : ".pdf,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.mp4,.webm,.md,.txt,.html,.srt,.vtt";
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="统一添加资源"><div className="panel resource-modal">
    <header><div><p className="eyebrow">UNIFIED IMPORT</p><h2>添加资源</h2><p>文件先建立资源记录，再进入提取、翻译与复核；不会因为处理失败而消失。</p></div><button onClick={onClose}>×</button></header>
    <nav className="modal-tabs">{([['file','文件'],['link','链接'],['wordlist','词库'],['dictionary','词典']] as const).map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => { setTab(id); setResourceType(id === "wordlist" ? "WordList" : id === "dictionary" ? "Dictionary" : ""); }}>{label}</button>)}</nav>
    <form className="stack-form" onSubmit={submit}>
      {tab === "link" ? <><label><span>网页或媒体链接</span><input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label><label><span>标题（可选）</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label></> : <label className="resource-drop-zone"><input name="files" type="file" multiple={tab === "file"} required accept={accept} /><strong>{tab === "wordlist" ? "选择词表文件" : tab === "dictionary" ? "选择结构化词典" : "选择一个或多个文件"}</strong><small>{accept}</small></label>}
      {tab === "file" || tab === "link" ? <label><span>资源类型（留空自动识别）</span><select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType | "")}><option value="">自动识别</option>{RESOURCE_TYPES.map((type) => <option key={type} value={type}>{resourceTypeLabel(type)}</option>)}</select></label> : null}
      <div className="two-column-form"><label><span>资源文件夹</span><select value={folderId} onChange={(event) => setFolderId(Number(event.target.value))}><option value="0">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label><span>标签（逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="经济学人, 新闻" /></label></div>
      <fieldset><legend>学习用途（可多选）</legend><div className="check-chip-row">{LEARNING_USES.map((use) => <label key={use}><input type="checkbox" checked={learningUses.includes(use)} onChange={(event) => setLearningUses((current) => event.target.checked ? [...new Set([...current, use])] : current.filter((item) => item !== use))} />{use}</label>)}</div></fieldset>
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? "正在导入…" : "建立资源并处理"}</button></div>
    </form>
  </div></div>;
}

function ResourceDetailModal({ resource, folders, onClose, onChanged, onStartLearning, onNotice }: { resource: ResourceItem; folders: ReadingFolderItem[]; onClose: () => void; onChanged: () => Promise<void>; onStartLearning: (resource: ResourceItem, use: LearningUse) => void; onNotice: (message: string) => void }) {
  const [tab, setTab] = useState<"overview" | "transcript" | "translation" | "original" | "processing">("overview");
  const [content, setContent] = useState("");
  const [wordList, setWordList] = useState<{ count: number; importedCount: number; words: { word: string; definition?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const metadata = parseResourceMetadata(resource.metadataJson, resource.resourceType);
  useEffect(() => {
    if (resource.markdownObjectKey) fetch(`/api/resources/${resource.id}/content`).then((response) => response.ok ? response.json() : Promise.reject(new Error("正文读取失败"))).then((data: { markdown?: string }) => setContent(data.markdown || "")).catch(() => setContent(""));
    if (resource.resourceType === "WordList") jsonRequest<typeof wordList>(`/api/resources/${resource.id}/word-list`).then(setWordList).catch((error: Error) => onNotice(error.message));
  }, [onNotice, resource.id, resource.markdownObjectKey, resource.resourceType]);

  async function patch(change: Record<string, unknown>) {
    setBusy(true); try { await jsonRequest("/api/resources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: resource.id, ...change }) }); await onChanged(); onNotice("资源信息已更新"); } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }
  async function importWordList() {
    setBusy(true); try { const result = await jsonRequest<{ processed: number }>(`/api/resources/${resource.id}/word-list`, { method: "POST" }); await onChanged(); onNotice(`已把 ${result.processed} 个词加入单词本，重复词保留原FSRS进度。`); } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }
  async function importCandidates() {
    if (!metadata.candidateVocabulary.length) return;
    setBusy(true);
    try {
      for (const item of metadata.candidateVocabulary) {
        await jsonRequest("/api/vocabulary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: item.word, definition: item.meaning, example: item.example, sourceType: "resource-candidate", resourceId: resource.id, sourceTitle: resource.title, tags: resource.tags.join(",") }) });
      }
      onNotice(`已把 ${metadata.candidateVocabulary.length} 个候选词加入单词本；重复词不会重置FSRS。`);
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="资源详情"><div className="panel resource-detail-modal">
    <header><div><span className="resource-type">{resourceTypeLabel(resource.resourceType)}</span><h2>{resource.title}</h2><p>{resource.description || "尚未补充资源说明"}</p></div><button onClick={onClose}>×</button></header>
    <nav className="modal-tabs">{([['overview','概览'],['transcript','文字稿'],['translation','译文'],['original','原始资料'],['processing','处理信息']] as const).map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="resource-detail-body">
      {tab === "overview" && <div className="resource-overview-grid"><section><h3>学习用途</h3><div className="tag-row">{resource.learningUses.map((use) => <button className="tag" key={use} onClick={() => onStartLearning(resource, use)}>{use} →</button>)}{!resource.learningUses.length && <small>尚未指定</small>}</div><h3>标签</h3><div className="tag-row">{resource.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}{!resource.tags.length && <small>尚无标签</small>}</div><h3>内容摘要</h3><p>{metadata.summary || resource.description || "等待整理"}</p></section><aside><label>文件夹<select value={resource.readingFolderId || 0} disabled={busy} onChange={(event) => void patch({ readingFolderId: Number(event.target.value) || null })}><option value="0">未分类</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label><label>标签<input defaultValue={resource.tags.join(", ")} onBlur={(event) => void patch({ tags: event.target.value.split(/[,，]/) })} /></label><small>来源：{resource.sourceName || "手工添加"}</small><small>状态：{statusLabel(resource.processingStatus)}</small></aside></div>}
      {tab === "transcript" && <div className="detail-reading-copy">{metadata.mediaSegments.length ? metadata.mediaSegments.map((segment) => <p key={segment.id}><time>{Math.floor(segment.startMs / 1000)}s</time>{segment.originalText}{segment.translationText && <small>{segment.translationText}</small>}</p>) : <pre>{content || "还没有文字稿；如为音视频，请在维护中心配置STT并重新处理。"}</pre>}</div>}
      {tab === "translation" && <pre className="detail-reading-copy">{content.match(/## 中文翻译[\s\S]*?(?=\n## |$)/)?.[0] || "尚未生成译文"}</pre>}
      {tab === "original" && <div className="resource-original"><p>原始资料会保留在OneDrive/R2，不会因生成Markdown而自动删除。</p>{/^https?:/.test(resource.sourceUrl || resource.url) && <a className="button secondary" href={resource.sourceUrl || resource.url} target="_blank" rel="noreferrer">打开原始链接 ↗</a>}<code>{resource.markdownPath || resource.url}</code></div>}
      {tab === "processing" && <div className="processing-summary"><strong>{statusLabel(resource.processingStatus)}</strong><p>翻译：{resource.translationStatus}</p><p>最后更新：{resource.updatedAt}</p>{metadata.candidateVocabulary.length > 0 && <div className="candidate-vocabulary"><p>候选词汇：{metadata.candidateVocabulary.length} 个（默认不会自动加入）</p><div className="tag-row">{metadata.candidateVocabulary.slice(0, 30).map((item) => <span className="tag" key={item.word}>{item.word}</span>)}</div><button className="button secondary" disabled={busy} onClick={() => void importCandidates()}>全部加入单词本</button></div>}</div>}
      {resource.resourceType === "WordList" && <section className="wordlist-preview"><h3>词库预览 · {wordList?.count || 0} 词</h3><div>{wordList?.words.slice(0, 30).map((item) => <span key={item.word}><strong>{item.word}</strong>{item.definition && ` · ${item.definition}`}</span>)}</div><button className="button primary" disabled={busy || !wordList?.count} onClick={() => void importWordList()}>全部加入单词本</button></section>}
    </div>
    <footer><button className="button secondary" onClick={onClose}>关闭</button>{resource.learningUses.map((use) => <button className="button primary" key={use} onClick={() => onStartLearning(resource, use)}>开始{use}</button>)}</footer>
  </div></div>;
}

export default function ResourceLibrary({ resources, onRead, onStartLearning, onReloadResources, onNotice, onToggleFavorite }: Props) {
  const [tab, setTab] = useState<LibraryTab>("all");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ResourceType | "">("");
  const [folderId, setFolderId] = useState(0);
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [folders, setFolders] = useState<ReadingFolderItem[]>([]);
  const [progress, setProgress] = useState<Record<number, ReadingProgressItem>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<ResourceItem | null>(null);
  const [newFolder, setNewFolder] = useState("");

  async function loadSupportingData() {
    const [folderData, progressData] = await Promise.all([jsonRequest<{ folders: ReadingFolderItem[] }>("/api/reading-folders"), jsonRequest<{ progress: ReadingProgressItem[] }>("/api/reading-progress")]);
    setFolders(folderData.folders); setProgress(Object.fromEntries(progressData.progress.map((item) => [item.resourceId, item])));
  }
  useEffect(() => { queueMicrotask(() => void loadSupportingData().catch((error: Error) => onNotice(error.message))); }, [onNotice]);

  const library = useMemo(() => resources.filter((item) => item.collection === "library"), [resources]);
  const tags = useMemo(() => [...new Set(library.flatMap((item) => item.tags))].sort((a,b) => a.localeCompare(b, "zh-CN")), [library]);
  const filtered = useMemo(() => library.filter((item) => {
    if (tab === "archived" ? item.status !== "archived" : item.status === "archived") return false;
    if (tab === "favorite" && !item.isFavorite) return false;
    if (tab === "inbox" && !["queued", "waiting", "processing", "review_required", "needs_provider", "failed"].includes(item.processingStatus)) return false;
    if (type && item.resourceType !== type) return false;
    if (folderId === -1 && item.readingFolderId) return false;
    if (folderId > 0 && item.readingFolderId !== folderId) return false;
    if (status && item.processingStatus !== status) return false;
    if (tag && !item.tags.includes(tag)) return false;
    return `${item.title} ${item.description} ${item.sourceName} ${item.tags.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase());
  }), [folderId, library, search, status, tab, tag, type]);

  async function batch(action: string, extra: Record<string, unknown> = {}) {
    if (!selectedIds.length) return;
    try { await jsonRequest("/api/resources/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedIds, action, ...extra }) }); setSelectedIds([]); await Promise.all([onReloadResources(), loadSupportingData()]); onNotice("批量维护已完成"); } catch (error) { onNotice((error as Error).message); }
  }
  async function createFolder() {
    if (!newFolder.trim()) return;
    try { await jsonRequest("/api/reading-folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newFolder }) }); setNewFolder(""); await loadSupportingData(); onNotice("资源文件夹已建立"); } catch (error) { onNotice((error as Error).message); }
  }

  return <section><div className="page-heading"><div><p className="eyebrow">RESOURCE LIBRARY 2.0</p><h1>资源库</h1><p>文章、PDF、图片、音视频、字幕、词库和词典共用一套资源核心；一个资源可以用于多种学习方式。</p></div><button className="button primary" onClick={() => setImportOpen(true)}>＋ 添加资源</button></div>
    <nav className="resource-tabs">{([['all','全部'],['inbox','待处理'],['favorite','收藏'],['archived','归档']] as const).map(([id,label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}<span>{id === "all" ? library.filter((item) => item.status !== "archived").length : id === "archived" ? library.filter((item) => item.status === "archived").length : ""}</span></button>)}</nav>
    <div className="panel resource-filterbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、来源、标签…" /></div><select value={type} onChange={(event) => setType(event.target.value as ResourceType | "")}><option value="">全部类型</option>{RESOURCE_TYPES.map((item) => <option value={item} key={item}>{resourceTypeLabel(item)}</option>)}</select><select value={folderId} onChange={(event) => setFolderId(Number(event.target.value))}><option value="0">全部文件夹</option><option value="-1">未分类</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tags.map((item) => <option value={item} key={item}>{item}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{["queued","processing","review_required","needs_provider","failed","ready"].map((item) => <option value={item} key={item}>{statusLabel(item)}</option>)}</select></div>
    <div className="resource-manager-layout"><aside className="panel resource-folder-panel"><h2>资源文件夹</h2><button className={folderId === 0 ? "active" : ""} onClick={() => setFolderId(0)}>全部资源 <span>{library.length}</span></button><button className={folderId === -1 ? "active" : ""} onClick={() => setFolderId(-1)}>未分类 <span>{library.filter((item) => !item.readingFolderId).length}</span></button>{folders.map((folder) => <button className={folderId === folder.id ? "active" : ""} key={folder.id} onClick={() => setFolderId(folder.id)}>{folder.name}<span>{folder.resourceCount}</span></button>)}<form onSubmit={(event) => { event.preventDefault(); void createFolder(); }}><input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="新文件夹" /><button>＋</button></form></aside>
      <div className="resource-table-wrap"><div className="resource-batchbar"><label><input type="checkbox" checked={Boolean(filtered.length) && filtered.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((item) => item.id) : [])} /> 已选 {selectedIds.length}</label>{selectedIds.length > 0 && <><select defaultValue="" onChange={(event) => { const value = Number(event.target.value); if (event.target.value) void batch("folder", { folderId: value || null }); event.currentTarget.value = ""; }}><option value="">移动到…</option><option value="0">未分类</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select><button onClick={() => { const tags = window.prompt("输入要添加的标签（逗号分隔）"); if (tags) void batch("addTags", { tags: tags.split(/[,，]/) }); }}>添加标签</button><button onClick={() => void batch("archive")}>归档</button></>}</div>
        <div className="panel resource-table"><header><span></span><span>资源</span><span>类型 / 用途</span><span>状态</span><span>学习进度</span><span>操作</span></header>{filtered.map((item) => { const ratio = progress[item.id]?.progressRatio || 0; return <article key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} /><button className="resource-title-cell" onClick={() => setDetail(item)}><strong>{item.title}</strong><small>{item.sourceName || item.category}{item.tags.length ? ` · ${item.tags.slice(0,2).join(" / ")}` : ""}</small></button><div><span className="resource-type">{resourceTypeLabel(item.resourceType)}</span><small>{item.learningUses.join(" / ") || "未指定用途"}</small></div><span className={`processing-pill ${item.processingStatus}`}>{statusLabel(item.processingStatus)}</span><div className="resource-progress-cell"><i><em style={{ width: `${Math.round(ratio * 100)}%` }} /></i><small>{ratio ? `${Math.round(ratio * 100)}%` : "未开始"}</small></div><div className="resource-row-actions"><button className={item.isFavorite ? "active" : ""} onClick={() => void onToggleFavorite(item)}>★</button>{item.markdownObjectKey && <button onClick={() => onRead(item)}>阅读</button>}<button onClick={() => setDetail(item)}>详情</button></div></article>; })}{!filtered.length && <div className="empty-state"><strong>没有匹配资源</strong><span>调整筛选，或通过“添加资源”建立第一条记录。</span></div>}</div>
      </div></div>
    {importOpen && <ResourceImportModal folders={folders} onClose={() => setImportOpen(false)} onDone={async () => { await Promise.all([onReloadResources(), loadSupportingData()]); }} onNotice={onNotice} />}
    {detail && <ResourceDetailModal resource={resources.find((item) => item.id === detail.id) || detail} folders={folders} onClose={() => setDetail(null)} onChanged={async () => { await Promise.all([onReloadResources(), loadSupportingData()]); }} onStartLearning={onStartLearning} onNotice={onNotice} />}
  </section>;
}
