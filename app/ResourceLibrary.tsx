"use client";

/* Native media previews intentionally reuse the source file without generating a second caption track. */
/* Resource rows support richer desktop selection semantics than a native button can contain. */
/* eslint-disable jsx-a11y/media-has-caption, @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */

import { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { buildResourceActions, resourceDefaultAction, type ResourceAction } from "./components/library/resource-actions";
import { LEARNING_USES, RESOURCE_TYPES, parseResourceMetadata, resourceTypeLabel, type LearningUse, type ResourceType } from "./resource-model";
import type { ProcessingJob, ProgressItem, ReadingFolderItem, ReadingProgressItem, ResourceItem } from "./types";

type MaintenanceTarget = { section: "processing" | "providers"; jobId?: number; resourceId?: number };
type Props = {
  resources: ResourceItem[];
  jobs: ProcessingJob[];
  mediaProgress: ProgressItem[];
  onRead: (resource: ResourceItem) => void;
  onStartLearning: (resource: ResourceItem, use: LearningUse) => void;
  onOpenMaintenance: (target: MaintenanceTarget) => void;
  onReloadResources: () => Promise<void>;
  onNotice: (message: string) => void;
  onToggleFavorite: (resource: ResourceItem) => Promise<void>;
};
type SmartView = "all" | "continue" | "inbox" | "ready" | "review" | "problems" | "favorite" | "archived";
type ResourceSort = "added" | "studied" | "title-asc" | "title-desc" | "progress" | "custom";
type InspectorTab = "overview" | "content" | "processing" | "source";
type MenuState = { x: number; y: number; resourceId: number } | null;
type FolderMenuState = { x: number; y: number; folderId: number } | null;
type PickerState = { kind: "folder" | "tags"; ids: number[] } | null;

const SMART_VIEWS: { id: SmartView; icon: string; label: string }[] = [
  { id: "all", icon: "▦", label: "全部资源" },
  { id: "continue", icon: "▶", label: "继续学习" },
  { id: "inbox", icon: "⌑", label: "收件箱" },
  { id: "ready", icon: "✓", label: "可学习" },
  { id: "review", icon: "◌", label: "待复核" },
  { id: "problems", icon: "!", label: "有问题" },
  { id: "favorite", icon: "★", label: "收藏" },
  { id: "archived", icon: "⌫", label: "已归档" },
];
const PROBLEM_STATES = new Set(["failed", "needs_action", "needs_provider"]);
const INBOX_STATES = new Set(["waiting", "queued", "processing", "running", "pausing", "paused", "needs_action", "needs_provider", "review_required"]);

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function statusLabel(status: string) {
  return ({ queued: "排队中", waiting: "等待处理", processing: "处理中", running: "处理中", paused: "已暂停", pausing: "等待暂停", review_required: "待复核", needs_action: "需要处理", needs_provider: "待配置", failed: "失败", sync_pending: "待同步", ready: "可学习", completed: "已完成" } as Record<string, string>)[status] || status;
}

function resourceIcon(type: ResourceType) {
  return ({ Article: "Aa", PDF: "PDF", Image: "▧", Audio: "♪", Video: "▶", Podcast: "◉", Subtitle: "CC", Text: "T", WordList: "W", Dictionary: "D", Other: "◇" } as Record<ResourceType, string>)[type];
}

function clockText(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function clampMenu(x: number, y: number, width = 238, height = 430) {
  if (typeof window === "undefined") return { x, y };
  return { x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - height - 8)) };
}

function isInSmartView(item: ResourceItem, view: SmartView, ratio: number) {
  if (view === "archived") return item.status === "archived";
  if (item.status === "archived") return false;
  if (view === "continue") return ratio > 0 && ratio < .98;
  if (view === "inbox") return INBOX_STATES.has(item.processingStatus) || (["ready", "completed"].includes(item.processingStatus) && (!item.readingFolderId || !item.tags.length));
  if (view === "ready") return item.processingStatus === "ready";
  if (view === "review") return item.processingStatus === "review_required";
  if (view === "problems") return PROBLEM_STATES.has(item.processingStatus);
  if (view === "favorite") return item.isFavorite;
  return true;
}

function SortableFolderRow({ folder, active, dropActive, editing, editName, onSelect, onContext, onEditName, onSaveRename, onCancelRename, onDropResources }: {
  folder: ReadingFolderItem;
  active: boolean;
  dropActive: boolean;
  editing: boolean;
  editName: string;
  onSelect: () => void;
  onContext: (event: ReactMouseEvent) => void;
  onEditName: (value: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onDragHover: () => void;
  onDropResources: () => void;
}) {
  const sortableId = `folder-${folder.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId });
  return <div className={`library-folder-row ${active ? "active" : ""} ${dropActive ? "drop-active" : ""} ${isDragging ? "dragging" : ""}`} ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} onContextMenu={onContext} onDragEnter={onDragHover} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); onDropResources(); }}>
    <button className="library-folder-handle" {...attributes} {...listeners} aria-label={`拖动文件夹 ${folder.name}`}>⋮⋮</button>
    {editing ? <form onSubmit={(event) => { event.preventDefault(); onSaveRename(); }}><input value={editName} onChange={(event) => onEditName(event.target.value)} maxLength={60} aria-label="新文件夹名称" /><button>保存</button><button type="button" onClick={onCancelRename}>取消</button></form> : <button className="library-folder-name" onClick={onSelect}><span>▣</span><strong>{folder.name}</strong><em>{folder.resourceCount}</em></button>}
  </div>;
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
      if (tab === "link") await jsonRequest("/api/resources/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, title, resourceType: resourceType || undefined, tags: tags.split(/[,，]/), folderId: folderId || undefined, learningUses }) });
      else {
        const input = event.currentTarget.elements.namedItem("files") as HTMLInputElement;
        if (!input.files?.length) throw new Error("请选择文件");
        const body = new FormData(); [...input.files].forEach((file) => body.append("files", file));
        body.append("resourceType", tab === "wordlist" ? "WordList" : tab === "dictionary" ? "Dictionary" : resourceType);
        body.append("tags", tags); body.append("folderId", String(folderId)); body.append("learningUses", learningUses.join(","));
        await jsonRequest("/api/resources/import", { method: "POST", body });
      }
      await onDone(); onNotice("资源已建立；需要处理的内容已进入任务队列。"); onClose();
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }
  const accept = tab === "wordlist" ? ".csv,.tsv,.txt,.json" : tab === "dictionary" ? ".csv,.tsv,.json" : ".pdf,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.mp4,.webm,.md,.txt,.html,.srt,.vtt";
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="统一添加资源"><div className="panel resource-modal"><header><div><p className="eyebrow">UNIFIED IMPORT</p><h2>添加资源</h2><p>文件、链接、词库和词典统一进入资源库；原始资料仍会保留。</p></div><button onClick={onClose}>×</button></header><nav className="modal-tabs">{([['file','文件'],['link','链接'],['wordlist','词库'],['dictionary','词典']] as const).map(([id,label]) => <button type="button" className={tab === id ? "active" : ""} key={id} onClick={() => { setTab(id); setResourceType(id === "wordlist" ? "WordList" : id === "dictionary" ? "Dictionary" : ""); }}>{label}</button>)}</nav><form className="stack-form" onSubmit={submit}>
    {tab === "link" ? <><label><span>网页或媒体链接</span><input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label><label><span>标题（可选）</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label></> : <label className="resource-drop-zone"><input name="files" type="file" multiple={tab === "file"} required accept={accept} /><strong>{tab === "wordlist" ? "选择词表文件" : tab === "dictionary" ? "选择结构化词典" : "选择一个或多个文件"}</strong><small>{accept}</small></label>}
    <label><span>资源文件夹（可选）</span><select value={folderId} onChange={(event) => setFolderId(Number(event.target.value))}><option value="0">先放入 Inbox</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
    <details className="resource-import-advanced"><summary>高级设置：类型、标签与学习用途</summary><div>
      {(tab === "file" || tab === "link") && <label><span>资源类型（留空自动识别）</span><select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType | "")}><option value="">自动识别</option>{RESOURCE_TYPES.map((item) => <option key={item} value={item}>{resourceTypeLabel(item)}</option>)}</select></label>}
      <label><span>标签（逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
      <fieldset><legend>学习用途</legend><div className="check-chip-row">{LEARNING_USES.map((use) => <label key={use}><input type="checkbox" checked={learningUses.includes(use)} onChange={(event) => setLearningUses((current) => event.target.checked ? [...new Set([...current, use])] : current.filter((item) => item !== use))} />{use}</label>)}</div></fieldset>
    </div></details>
    <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? "正在导入…" : "建立资源并处理"}</button></div>
  </form></div></div>;
}

function ActionMenu({ actions, x, y, onClose }: { actions: ResourceAction[]; x: number; y: number; onClose: () => void }) {
  return <div className="library-context-menu" style={{ left: x, top: y }} role="menu">{actions.filter((action) => !action.hidden).map((action) => <button role="menuitem" key={action.id} className={action.danger ? "danger" : ""} disabled={action.disabled} onClick={() => { onClose(); void action.handler(); }}><span>{action.icon}</span><b>{action.label}</b>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>)}</div>;
}

export default function ResourceLibrary({ resources, jobs, mediaProgress, onRead, onStartLearning, onOpenMaintenance, onReloadResources, onNotice, onToggleFavorite }: Props) {
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<ResourceType | "">("");
  const [folderId, setFolderId] = useState(0);
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState("");
  const [learningUse, setLearningUse] = useState<LearningUse | "">("");
  const [dateFilter, setDateFilter] = useState<"" | "7" | "30" | "365">("");
  const [sort, setSort] = useState<ResourceSort>("added");
  const [density, setDensity] = useState<"compact" | "comfortable">(() => typeof window !== "undefined" && window.localStorage.getItem("english-room-library-density") === "comfortable" ? "comfortable" : "compact");
  const [filterOpen, setFilterOpen] = useState(false);
  const [folders, setFolders] = useState<ReadingFolderItem[]>([]);
  const [readingProgress, setReadingProgress] = useState<Record<number, ReadingProgressItem>>({});
  const [localPatches, setLocalPatches] = useState<Record<number, Partial<ResourceItem>>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState(0);
  const lastSelectedIndex = useRef(-1);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [inspectorMobileOpen, setInspectorMobileOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(() => typeof window === "undefined" ? 360 : Math.min(520, Math.max(300, Number(window.localStorage.getItem("english-room-library-inspector-width")) || 360)));
  const [contentCache, setContentCache] = useState<Record<number, string>>({});
  const [contentLoadingId, setContentLoadingId] = useState(0);
  const [wordListCache, setWordListCache] = useState<Record<number, { count: number; importedCount: number; words: { word: string; definition?: string }[] }>>({});
  const [resourceMenu, setResourceMenu] = useState<MenuState>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [quickPreviewId, setQuickPreviewId] = useState(0);
  const [newFolder, setNewFolder] = useState("");
  const [editingFolderId, setEditingFolderId] = useState(0);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [dragResourceIds, setDragResourceIds] = useState<number[]>([]);
  const [dropFolderId, setDropFolderId] = useState(0);
  const [undoArchivedIds, setUndoArchivedIds] = useState<number[]>([]);
  const [triageIds, setTriageIds] = useState<number[]>([]);
  const [triageIndex, setTriageIndex] = useState(0);
  const [triageFolderId, setTriageFolderId] = useState(0);
  const [triageTags, setTriageTags] = useState("");
  const folderSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function loadSupportingData() {
    const [folderData, progressData] = await Promise.all([jsonRequest<{ folders: ReadingFolderItem[] }>("/api/reading-folders"), jsonRequest<{ progress: ReadingProgressItem[] }>("/api/reading-progress")]);
    setFolders(folderData.folders); setReadingProgress(Object.fromEntries(progressData.progress.map((item) => [item.resourceId, item])));
  }
  useEffect(() => { queueMicrotask(() => void loadSupportingData().catch((error: Error) => onNotice(error.message))); }, [onNotice]);
  useEffect(() => { window.localStorage.setItem("english-room-library-density", density); }, [density]);
  useEffect(() => {
    const close = (event: Event) => { if (!(event.target as Element | null)?.closest?.(".library-context-menu")) { setResourceMenu(null); setFolderMenu(null); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setResourceMenu(null); setFolderMenu(null); setPicker(null); setQuickPreviewId(0); setInspectorMobileOpen(false); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("scroll", close, true); };
  }, []);

  const library = useMemo(() => resources.filter((item) => item.collection === "library").map((item) => ({ ...item, ...localPatches[item.id] })), [resources, localPatches]);
  const tags = useMemo(() => [...new Set(library.flatMap((item) => item.tags))].sort((a,b) => a.localeCompare(b, "zh-CN")), [library]);
  const sources = useMemo(() => [...new Set(library.map((item) => item.sourceName).filter(Boolean))].sort((a,b) => a.localeCompare(b, "zh-CN")), [library]);
  const jobByResource = useMemo(() => new Map(jobs.filter((job) => job.resultResourceId).map((job) => [job.resultResourceId!, job])), [jobs]);
  const metadataById = useMemo(() => new Map(library.map((item) => [item.id, parseResourceMetadata(item.metadataJson, item.resourceType)])), [library]);
  const mediaProgressById = useMemo(() => new Map(mediaProgress.filter((item) => item.lessonKey.startsWith("resource:")).map((item) => [Number(item.lessonKey.split(":")[1]), item])), [mediaProgress]);
  const progress = useMemo<Record<number, ReadingProgressItem>>(() => ({
    ...readingProgress,
    ...Object.fromEntries([...mediaProgressById.entries()].map(([resourceId, item]) => [resourceId, {
      id: -resourceId,
      resourceId,
      progressRatio: item.durationSeconds ? Math.min(1, item.progressSeconds / item.durationSeconds) : 0,
      anchor: "",
      completed: item.completed,
      fontSize: 18,
      fontFamily: "serif",
      lineHeight: 1.8,
      contentWidth: "standard",
      translationMode: "original",
      outlineJson: "[]",
      formatVersion: 1,
      lastReadAt: item.lastStudiedAt,
    }]))
  }), [mediaProgressById, readingProgress]);
  const ratioById = useMemo(() => Object.fromEntries(library.map((item) => { const mediaItem = mediaProgressById.get(item.id); const ratio = ["Audio", "Video", "Podcast"].includes(item.resourceType) && mediaItem?.durationSeconds ? Math.min(1, mediaItem.progressSeconds / mediaItem.durationSeconds) : progress[item.id]?.progressRatio || 0; return [item.id, ratio]; })), [library, mediaProgressById, progress]);
  const smartCounts = useMemo(() => Object.fromEntries(SMART_VIEWS.map((view) => [view.id, library.filter((item) => isInSmartView(item, view.id, ratioById[item.id] || 0)).length])) as Record<SmartView, number>, [library, ratioById]);
  const filtered = useMemo(() => library.filter((item) => {
    if (!isInSmartView(item, smartView, ratioById[item.id] || 0)) return false;
    if (type && item.resourceType !== type) return false;
    if (folderId === -1 && item.readingFolderId) return false;
    if (folderId > 0 && item.readingFolderId !== folderId) return false;
    if (status && item.processingStatus !== status) return false;
    if (tag && !item.tags.includes(tag)) return false;
    if (source && item.sourceName !== source) return false;
    if (learningUse && !item.learningUses.includes(learningUse)) return false;
    if (dateFilter) {
      const created = new Date(String(item.createdAt || "").replace(" ", "T")).getTime();
      if (!created || Date.now() - created > Number(dateFilter) * 86400000) return false;
    }
    const query = deferredSearch.trim().toLowerCase();
    const folderName = folders.find((folder) => folder.id === item.readingFolderId)?.name || "";
    return !query || `${item.title} ${item.description} ${item.sourceName} ${item.sourceUrl} ${item.tags.join(" ")} ${folderName}`.toLowerCase().includes(query);
  }).sort((first, second) => {
    if (smartView === "continue" && sort === "added") return String(progress[second.id]?.lastReadAt || "").localeCompare(String(progress[first.id]?.lastReadAt || ""));
    if (sort === "title-asc") return first.title.localeCompare(second.title, "en");
    if (sort === "title-desc") return second.title.localeCompare(first.title, "en");
    if (sort === "studied") return String(progress[second.id]?.lastReadAt || "").localeCompare(String(progress[first.id]?.lastReadAt || ""));
    if (sort === "progress") return (ratioById[second.id] || 0) - (ratioById[first.id] || 0);
    if (sort === "custom") return first.sortOrder - second.sortOrder || first.id - second.id;
    return String(second.createdAt || "").localeCompare(String(first.createdAt || "")) || second.id - first.id;
  }), [dateFilter, deferredSearch, folderId, folders, learningUse, library, progress, ratioById, smartView, sort, source, status, tag, type]);
  const selectedResource = library.find((item) => item.id === activeId) || library.find((item) => selectedIds.includes(item.id)) || null;
  const quickResource = library.find((item) => item.id === quickPreviewId) || null;
  const triageResource = library.find((item) => item.id === triageIds[triageIndex]) || null;
  const selectedJob = selectedResource ? jobByResource.get(selectedResource.id) : undefined;
  const emptyCopy = smartView === "inbox" ? ["Inbox 已经整理干净", "新导入或仍需处理的资料会出现在这里。"] : smartView === "review" ? ["没有等待复核的资料", "需要人工确认的内容会集中显示在这里。"] : smartView === "problems" ? ["当前没有处理异常", "失败、需要操作或缺少能力的资源会显示在这里。"] : ["这里还没有资源", "调整筛选、切换智能视图，或添加一份新资料。"];

  async function ensureContent(resource: ResourceItem) {
    if (contentCache[resource.id] !== undefined || contentLoadingId === resource.id) return;
    if (!resource.markdownObjectKey) { setContentCache((current) => ({ ...current, [resource.id]: "" })); return; }
    setContentLoadingId(resource.id);
    try {
      const data = await jsonRequest<{ markdown?: string }>(`/api/resources/${resource.id}/content`);
      setContentCache((current) => ({ ...current, [resource.id]: data.markdown || "" }));
    } catch (error) { onNotice((error as Error).message); setContentCache((current) => ({ ...current, [resource.id]: "" })); }
    finally { setContentLoadingId(0); }
  }
  async function ensureWordList(resource: ResourceItem) {
    if (wordListCache[resource.id]) return;
    try { const data = await jsonRequest<{ count: number; importedCount: number; words: { word: string; definition?: string }[] }>(`/api/resources/${resource.id}/word-list`); setWordListCache((current) => ({ ...current, [resource.id]: data })); }
    catch (error) { onNotice((error as Error).message); }
  }
  async function importWordList(resource: ResourceItem) {
    try {
      const result = await jsonRequest<{ processed: number }>(`/api/resources/${resource.id}/word-list`, { method: "POST" });
      await onReloadResources(); onNotice(`已把 ${result.processed} 个词加入单词本；重复词会保留原有 FSRS 进度。`);
    } catch (error) { onNotice((error as Error).message); }
  }
  async function reloadAndClear() { await Promise.all([onReloadResources(), loadSupportingData()]); setLocalPatches({}); }
  async function patchResource(resource: ResourceItem, change: Partial<ResourceItem>, message: string) {
    const previous = localPatches;
    setLocalPatches((current) => ({ ...current, [resource.id]: { ...current[resource.id], ...change } }));
    try { await jsonRequest("/api/resources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: resource.id, ...change }) }); await reloadAndClear(); onNotice(message); }
    catch (error) { setLocalPatches(previous); onNotice((error as Error).message); }
  }
  async function batch(action: string, ids: number[], extra: Record<string, unknown> = {}) {
    if (!ids.length) return;
    await jsonRequest("/api/resources/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action, ...extra }) });
  }
  async function moveResources(ids: number[], nextFolderId: number | null) {
    if (!ids.length) return;
    const previous = localPatches;
    setLocalPatches((current) => Object.fromEntries([...Object.entries(current), ...ids.map((id) => [id, { ...current[id], readingFolderId: nextFolderId }])]));
    setPicker(null); setDropFolderId(0);
    try { await jsonRequest("/api/reading-folders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceIds: ids, folderId: nextFolderId }) }); if (nextFolderId) window.localStorage.setItem("english-room-library-last-folder", String(nextFolderId)); await reloadAndClear(); onNotice(ids.length > 1 ? `已移动 ${ids.length} 项资源` : "资源已移动"); }
    catch (error) { setLocalPatches(previous); onNotice((error as Error).message); }
  }
  async function saveTags(ids: number[]) {
    const nextTags = tagDraft.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    try {
      if (ids.length === 1) {
        const item = library.find((resource) => resource.id === ids[0]);
        if (item) await patchResource(item, { tags: [...new Set([...item.tags.filter((itemTag) => !removeTags.includes(itemTag)), ...nextTags])] }, "标签已更新");
      } else {
        if (nextTags.length) await batch("addTags", ids, { tags: nextTags });
        if (removeTags.length) await batch("removeTags", ids, { tags: removeTags });
        await reloadAndClear(); onNotice(`已更新 ${ids.length} 项资源的标签`);
      }
      setPicker(null); setTagDraft(""); setRemoveTags([]);
    } catch (error) { onNotice((error as Error).message); }
  }
  async function archiveResources(ids: number[], onSuccess?: () => void) {
    if (!ids.length || !window.confirm(`确定归档 ${ids.length} 项资源吗？原始资料和处理记录不会删除。`)) return;
    const previous = localPatches;
    setLocalPatches((current) => Object.fromEntries([...Object.entries(current), ...ids.map((id) => [id, { ...current[id], status: "archived" }])]));
    setSelectedIds([]); setUndoArchivedIds(ids);
    try { await batch("archive", ids); await reloadAndClear(); onSuccess?.(); onNotice("资源已归档，可使用页面下方的撤销恢复"); }
    catch (error) { setLocalPatches(previous); setUndoArchivedIds([]); onNotice((error as Error).message); }
  }
  async function restoreArchived() {
    const ids = undoArchivedIds; if (!ids.length) return;
    try { await batch("restore", ids); setUndoArchivedIds([]); await reloadAndClear(); onNotice("已撤销归档"); }
    catch (error) { onNotice((error as Error).message); }
  }
  async function favoriteSelection(ids: number[], resource: ResourceItem) {
    try {
      if (ids.length === 1) await onToggleFavorite(resource);
      else { await batch("favorite", ids); await reloadAndClear(); onNotice(`已收藏 ${ids.length} 项资源`); }
    } catch (error) { onNotice((error as Error).message); }
  }

  function openPicker(kind: "folder" | "tags", ids: number[]) {
    setPicker({ kind, ids });
    setFolderSearch(""); setTagSearch("");
    if (kind === "tags") { setTagDraft(""); setRemoveTags([]); }
  }
  function canStartResource(resource: ResourceItem) {
    if (!["ready", "completed"].includes(resource.processingStatus)) return false;
    if (["Article", "PDF", "Image", "Text", "Subtitle"].includes(resource.resourceType)) return Boolean(resource.markdownObjectKey);
    return ["Audio", "Video", "Podcast", "WordList"].includes(resource.resourceType) || Boolean(resource.learningUses.length);
  }
  function startResource(resource: ResourceItem) {
    const saved = typeof window === "undefined" ? "" : window.localStorage.getItem(`english-room-resource-last-use-${resource.id}`);
    const remembered = resource.learningUses.find((use) => use === saved);
    const preferred = remembered || (["Article", "PDF", "Image", "Text", "Subtitle"].includes(resource.resourceType) ? "Reading" : ["Audio", "Video", "Podcast"].includes(resource.resourceType) ? "Listening" : resource.resourceType === "WordList" ? "Vocabulary" : resource.learningUses[0]);
    if (preferred) {
      window.localStorage.setItem(`english-room-resource-last-use-${resource.id}`, preferred);
      if (preferred === "Reading") onRead(resource);
      else onStartLearning(resource, preferred);
    }
    else { setActiveId(resource.id); setInspectorMobileOpen(true); }
  }
  async function runJobAction(job: ProcessingJob | undefined, action: string) {
    if (!job) return;
    try {
      await jsonRequest("/api/processing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, action, stepKey: job.currentStep }) });
      onNotice(action === "retry_step" ? "已请求重试失败步骤" : "已从安全断点继续处理"); onOpenMaintenance({ section: "processing", jobId: job.id });
    } catch (error) { onNotice((error as Error).message); }
  }
  async function reprocessResource(resource: ResourceItem) {
    if (!window.confirm("重新处理会建立一条新任务，现有资源、草稿和历史记录都会保留。继续吗？")) return;
    try {
      const isMedia = ["Audio", "Video", "Podcast"].includes(resource.resourceType);
      const result = await jsonRequest<{ jobId: number }>(isMedia ? `/api/resources/${resource.id}/media` : "/api/processing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(isMedia ? { action: "reprocess_transcript" } : { resourceId: resource.id }) });
      onNotice("已建立新的处理任务"); onOpenMaintenance({ section: "processing", jobId: result.jobId });
    } catch (error) { onNotice((error as Error).message); }
  }
  async function requestIntensive(resource: ResourceItem) {
    try {
      const result = await jsonRequest<{ jobId: number }>(`/api/resources/${resource.id}/media`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "request_intensive" }) });
      await reloadAndClear(); onNotice("已加入精听处理；泛听仍然可用。"); onOpenMaintenance({ section: "processing", jobId: result.jobId });
    } catch (error) { onNotice((error as Error).message); }
  }
  function uploadSubtitle(resource: ResourceItem) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".srt,.vtt,text/vtt,application/x-subrip";
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const body = new FormData(); body.append("subtitle", file);
      void jsonRequest<{ jobId: number }>(`/api/resources/${resource.id}/media`, { method: "POST", body }).then(async (result) => {
        await reloadAndClear(); onNotice("字幕已加入；将从字幕解析继续，不会重新调用STT。"); onOpenMaintenance({ section: "processing", jobId: result.jobId });
      }).catch((error: Error) => onNotice(error.message));
    };
    input.click();
  }
  function actionsFor(resource: ResourceItem, ids = selectedIds.includes(resource.id) ? selectedIds : [resource.id]) {
    const job = jobByResource.get(resource.id);
    return buildResourceActions(resource, {
      selectionCount: ids.length,
      hasProcessingJob: Boolean(job),
      canStart: canStartResource(resource),
      onOpen: () => { setActiveId(resource.id); setInspectorMobileOpen(true); if (inspectorTab === "content") void ensureContent(resource); },
      onPreview: () => openQuickPreview(resource),
      onRead: () => startResource(resource),
      onPlay: () => startResource(resource),
      onIntensive: () => requestIntensive(resource),
      onTranscript: () => { setActiveId(resource.id); setInspectorTab("content"); setInspectorMobileOpen(true); },
      onSubtitle: () => uploadSubtitle(resource),
      onFavorite: () => favoriteSelection(ids, resource),
      onMove: () => openPicker("folder", ids),
      onTags: () => openPicker("tags", ids),
      onReview: () => onOpenMaintenance({ section: "processing", resourceId: resource.id }),
      onProcessing: () => onOpenMaintenance({ section: "processing", jobId: job?.id }),
      onResume: () => runJobAction(job, job?.status === "paused" ? "resume" : "resume_from_failure"),
      onRetry: () => runJobAction(job, "retry_step"),
      onReprocess: () => reprocessResource(resource),
      onProviders: () => onOpenMaintenance({ section: "providers", jobId: job?.id }),
      onSource: () => window.open(resource.sourceUrl || resource.url, "_blank", "noopener,noreferrer"),
      onArchive: () => archiveResources(ids),
    });
  }
  function executeDefault(resource: ResourceItem) {
    const actionId = resourceDefaultAction(resource);
    const action = actionsFor(resource, [resource.id]).find((item) => item.id === actionId && !item.hidden);
    if (action) void action.handler();
    else { setActiveId(resource.id); setInspectorMobileOpen(true); }
  }
  function openQuickPreview(resource: ResourceItem) {
    if (["Article", "PDF", "Text", "Subtitle"].includes(resource.resourceType)) void ensureContent(resource);
    if (resource.resourceType === "WordList") void ensureWordList(resource);
    setQuickPreviewId(resource.id);
  }
  function handleRowSelection(event: ReactMouseEvent, item: ResourceItem, index: number) {
    const target = event.target as Element;
    if (target.closest("button,a,input,select,label")) return;
    if (event.shiftKey && lastSelectedIndex.current >= 0) {
      const start = Math.min(lastSelectedIndex.current, index); const end = Math.max(lastSelectedIndex.current, index);
      setSelectedIds((current) => [...new Set([...current, ...filtered.slice(start, end + 1).map((resource) => resource.id)])]);
    } else if (event.metaKey || event.ctrlKey) setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]);
    else setSelectedIds([item.id]);
    lastSelectedIndex.current = index; setActiveId(item.id); setInspectorMobileOpen(true); if (inspectorTab === "content") void ensureContent(item);
  }
  function openResourceMenu(event: ReactMouseEvent, item: ResourceItem, fromButton = false) {
    event.preventDefault(); event.stopPropagation();
    if (!selectedIds.includes(item.id)) setSelectedIds([item.id]);
    setActiveId(item.id);
    const point = fromButton ? { x: (event.currentTarget as HTMLElement).getBoundingClientRect().right - 230, y: (event.currentTarget as HTMLElement).getBoundingClientRect().bottom + 5 } : { x: event.clientX, y: event.clientY };
    setResourceMenu({ ...clampMenu(point.x, point.y), resourceId: item.id });
  }
  function openFolderMenu(event: ReactMouseEvent, folder: ReadingFolderItem) { event.preventDefault(); const point = clampMenu(event.clientX, event.clientY, 190, 160); setFolderMenu({ ...point, folderId: folder.id }); }

  /* Keyboard routing intentionally rebinds when the active resource or visible ordering changes. */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable=true]") && event.key !== "Escape") return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return; }
      if (event.key === "Escape") { setSelectedIds([]); setActiveId(0); return; }
      const currentIndex = Math.max(0, filtered.findIndex((item) => item.id === activeId));
      if (["ArrowDown", "ArrowUp"].includes(event.key) && filtered.length) {
        event.preventDefault(); const nextIndex = Math.max(0, Math.min(filtered.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1))); const item = filtered[nextIndex]; setActiveId(item.id); setSelectedIds([item.id]); if (inspectorTab === "content") void ensureContent(item); document.querySelector(`[data-resource-id="${item.id}"]`)?.scrollIntoView({ block: "nearest" }); return;
      }
      const resource = library.find((item) => item.id === activeId); if (!resource) return;
      if (event.key === "Enter") { event.preventDefault(); executeDefault(resource); }
      else if (event.code === "Space") { event.preventDefault(); openQuickPreview(resource); }
      else if (event.key.toLowerCase() === "f") { event.preventDefault(); void favoriteSelection(selectedIds.length ? selectedIds : [resource.id], resource); }
      else if (event.key.toLowerCase() === "m") { event.preventDefault(); openPicker("folder", selectedIds.length ? selectedIds : [resource.id]); }
      else if (event.key.toLowerCase() === "t") { event.preventDefault(); openPicker("tags", selectedIds.length ? selectedIds : [resource.id]); }
      else if (event.key.toLowerCase() === "r") { event.preventDefault(); const targetAction = resource.processingStatus === "review_required" ? "review" : resource.processingStatus === "needs_provider" ? "providers" : "processing"; const action = actionsFor(resource, [resource.id]).find((item) => item.id === targetAction && !item.hidden); if (action) void action.handler(); }
    };
    document.addEventListener("keydown", handler); return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, filtered, library, selectedIds]);

  async function createFolder() {
    if (!newFolder.trim()) return;
    try { await jsonRequest("/api/reading-folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newFolder }) }); setNewFolder(""); await loadSupportingData(); onNotice("资源文件夹已建立"); }
    catch (error) { onNotice((error as Error).message); }
  }
  async function renameFolder(folder: ReadingFolderItem) {
    if (editingFolderId !== folder.id) { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setFolderMenu(null); return; }
    try { await jsonRequest("/api/reading-folders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: folder.id, name: editingFolderName }) }); setEditingFolderId(0); await loadSupportingData(); onNotice("文件夹已重命名"); }
    catch (error) { onNotice((error as Error).message); }
  }
  async function deleteFolder(folder: ReadingFolderItem) {
    if (!window.confirm(`删除文件夹“${folder.name}”？其中资源会回到收件箱。`)) return;
    try { await jsonRequest(`/api/reading-folders?id=${folder.id}`, { method: "DELETE" }); if (folderId === folder.id) setFolderId(-1); setFolderMenu(null); await reloadAndClear(); onNotice("文件夹已删除，资源已回到收件箱"); }
    catch (error) { onNotice((error as Error).message); }
  }
  async function reorderFolders(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldId = Number(String(event.active.id).replace("folder-", "")); const newId = Number(String(event.over.id).replace("folder-", ""));
    const oldIndex = folders.findIndex((folder) => folder.id === oldId); const newIndex = folders.findIndex((folder) => folder.id === newId); if (oldIndex < 0 || newIndex < 0) return;
    const previous = folders; const next = arrayMove(folders, oldIndex, newIndex).map((folder, index) => ({ ...folder, sortOrder: index })); setFolders(next);
    try { await jsonRequest("/api/reading-folders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedIds: next.map((folder) => folder.id) }) }); }
    catch (error) { setFolders(previous); onNotice((error as Error).message); }
  }
  function startResize(event: ReactPointerEvent) {
    event.preventDefault(); const startX = event.clientX; const startWidth = inspectorWidth; let latestWidth = startWidth;
    const move = (pointer: PointerEvent) => { latestWidth = Math.min(520, Math.max(300, startWidth - (pointer.clientX - startX))); setInspectorWidth(latestWidth); };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); window.localStorage.setItem("english-room-library-inspector-width", String(latestWidth)); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }
  function startTriage() {
    const ids = library.filter((item) => isInSmartView(item, "inbox", progress[item.id]?.progressRatio || 0)).map((item) => item.id); setTriageIds(ids); setTriageIndex(0);
    const first = library.find((item) => item.id === ids[0]); setTriageTags(first?.tags.join(", ") || ""); setTriageFolderId(0);
  }
  function advanceTriage() {
    const next = triageIndex + 1;
    if (next >= triageIds.length) { setTriageIds([]); return; }
    setTriageIndex(next); const item = library.find((resource) => resource.id === triageIds[next]); setTriageTags(item?.tags.join(", ") || ""); setTriageFolderId(item?.readingFolderId || 0);
  }
  async function saveTriage() {
    if (!triageResource) return;
    try {
      await jsonRequest("/api/resources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: triageResource.id, readingFolderId: triageFolderId || null, tags: triageTags.split(/[,，]/) }) });
      await reloadAndClear(); if (triageIndex + 1 >= triageIds.length) onNotice("收件箱整理完成"); advanceTriage();
    } catch (error) { onNotice((error as Error).message); }
  }

  const activeFilterCount = [type, status, tag, source, learningUse, dateFilter, folderId !== 0 ? String(folderId) : ""].filter(Boolean).length;
  const contextResource = resourceMenu ? library.find((item) => item.id === resourceMenu.resourceId) : null;
  const contextFolder = folderMenu ? folders.find((item) => item.id === folderMenu.folderId) : null;
  const selectedTags = [...new Set(library.filter((item) => picker?.ids.includes(item.id)).flatMap((item) => item.tags))];
  const filteredFolders = folders.filter((folder) => folder.name.toLowerCase().includes(folderSearch.trim().toLowerCase())).sort((first, second) => {
    const recentId = typeof window === "undefined" ? 0 : Number(window.localStorage.getItem("english-room-library-last-folder"));
    return Number(second.id === recentId) - Number(first.id === recentId) || first.sortOrder - second.sortOrder;
  });
  const availableTags = tags.filter((item) => item.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const inspectorActions = selectedResource ? actionsFor(selectedResource) : [];
  const selectedMetadata = selectedResource ? parseResourceMetadata(selectedResource.metadataJson, selectedResource.resourceType) : null;
  const quickMetadata = quickResource ? parseResourceMetadata(quickResource.metadataJson, quickResource.resourceType) : null;
  const mediaUrl = quickResource ? String(quickMetadata?.media?.source || quickMetadata?.podcast?.audioUrl || (quickMetadata?.uploadId ? `/api/resources/${quickResource.id}/media` : quickResource.sourceUrl || quickResource.url)) : "";

  return <section className="library-workspace"><div className="library-page-heading"><div><p className="eyebrow">RESOURCE LIBRARY 3.0</p><h1>资源库</h1><p>像文件管理器一样整理资料；内容、处理状态与学习进度保持在同一处。</p></div><button className="button primary" onClick={() => setImportOpen(true)}>＋ 添加资源</button></div>
    <div className="library-commandbar panel"><div className="library-search-box"><span>⌕</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、来源、URL、标签或文件夹…  /" />{search && <button onClick={() => setSearch("")}>×</button>}</div><div className="library-command-actions"><div className="library-popover-wrap"><button className={filterOpen || activeFilterCount ? "active" : ""} onClick={() => setFilterOpen((value) => !value)}>筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}</button>{filterOpen && <div className="library-filter-popover"><label>类型<select value={type} onChange={(event) => setType(event.target.value as ResourceType | "")}><option value="">全部类型</option>{RESOURCE_TYPES.map((item) => <option key={item} value={item}>{resourceTypeLabel(item)}</option>)}</select></label><label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{["queued","processing","review_required","needs_action","needs_provider","failed","ready"].map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label><label>文件夹<select value={folderId} onChange={(event) => setFolderId(Number(event.target.value))}><option value="0">全部文件夹</option><option value="-1">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>标签<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">全部标签</option>{tags.map((item) => <option key={item}>{item}</option>)}</select></label><label>来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><label>学习用途<select value={learningUse} onChange={(event) => setLearningUse(event.target.value as LearningUse | "")}><option value="">全部用途</option>{LEARNING_USES.map((use) => <option key={use}>{use}</option>)}</select></label><label>添加日期<select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as "" | "7" | "30" | "365")}><option value="">不限日期</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="365">最近一年</option></select></label><button onClick={() => { setType(""); setStatus(""); setTag(""); setSource(""); setLearningUse(""); setDateFilter(""); setFolderId(0); }}>清除筛选</button></div>}</div><select value={sort} onChange={(event) => setSort(event.target.value as ResourceSort)} aria-label="排序"><option value="added">最近添加</option><option value="studied">最近学习</option><option value="title-asc">标题 A–Z</option><option value="title-desc">标题 Z–A</option><option value="progress">学习进度</option><option value="custom">自定义</option></select><button onClick={() => setDensity((value) => value === "compact" ? "comfortable" : "compact")}>视图 · {density === "compact" ? "紧凑" : "舒适"}</button><button className="primary" onClick={() => setImportOpen(true)}>＋</button></div></div>
    {activeFilterCount > 0 && <div className="library-filter-chips">{type && <button onClick={() => setType("")}>类型：{resourceTypeLabel(type)} ×</button>}{status && <button onClick={() => setStatus("")}>状态：{statusLabel(status)} ×</button>}{tag && <button onClick={() => setTag("")}>标签：{tag} ×</button>}{source && <button onClick={() => setSource("")}>来源：{source} ×</button>}{learningUse && <button onClick={() => setLearningUse("")}>用途：{learningUse} ×</button>}{dateFilter && <button onClick={() => setDateFilter("")}>日期：最近 {dateFilter} 天 ×</button>}{folderId !== 0 && <button onClick={() => setFolderId(0)}>位置：{folderId === -1 ? "收件箱" : folders.find((item) => item.id === folderId)?.name} ×</button>}<button className="clear" onClick={() => { setType(""); setStatus(""); setTag(""); setSource(""); setLearningUse(""); setDateFilter(""); setFolderId(0); }}>清除全部</button></div>}
    <div className={`library-manager ${density}`} style={{ "--library-inspector-width": `${inspectorWidth}px` } as CSSProperties}>
      <aside className="library-sidebar panel"><div className="library-sidebar-title"><strong>智能视图</strong>{smartView === "inbox" && smartCounts.inbox > 0 && <button onClick={startTriage}>整理</button>}</div><nav>{SMART_VIEWS.map((view) => <button key={view.id} className={smartView === view.id && folderId === 0 ? "active" : ""} onClick={() => { setSmartView(view.id); setFolderId(0); }}><span>{view.icon}</span><b>{view.label}</b><em>{smartCounts[view.id]}</em></button>)}</nav><div className="library-sidebar-title"><strong>文件夹</strong><span>{folders.length}</span></div><button className={`library-unfiled ${folderId === -1 ? "active" : ""}`} onClick={() => { setFolderId(-1); setSmartView("all"); }}><span>□</span><b>未分类</b><em>{smartCounts.inbox}</em></button><DndContext sensors={folderSensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorderFolders(event)}><SortableContext items={folders.map((folder) => `folder-${folder.id}`)} strategy={verticalListSortingStrategy}><div className="library-folder-list">{folders.map((folder) => <SortableFolderRow key={folder.id} folder={folder} active={folderId === folder.id} dropActive={dropFolderId === folder.id} editing={editingFolderId === folder.id} editName={editingFolderName} onSelect={() => { setFolderId(folder.id); setSmartView("all"); }} onContext={(event) => openFolderMenu(event, folder)} onEditName={setEditingFolderName} onSaveRename={() => void renameFolder(folder)} onCancelRename={() => setEditingFolderId(0)} onDragHover={() => { if (dragResourceIds.length) setDropFolderId(folder.id); }} onDropResources={() => void moveResources(dragResourceIds, folder.id)} />)}</div></SortableContext></DndContext><form className="library-folder-create" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}><input value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="新建文件夹" /><button>＋</button></form></aside>
      <main className="library-list-panel panel"><header><label><input type="checkbox" checked={Boolean(filtered.length) && filtered.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((item) => item.id) : [])} /><span>{filtered.length} 项</span></label><span>名称</span><span>状态</span><span>进度</span><span></span></header><div className="library-resource-list">{filtered.map((item, index) => { const ratio = progress[item.id]?.progressRatio || 0; const selected = selectedIds.includes(item.id); const itemMetadata = metadataById.get(item.id); const durationMs = Number(itemMetadata?.media?.durationMs || itemMetadata?.podcast?.durationMs || 0); const progressText = ratio >= .98 ? "✓" : ratio ? durationMs && ["Audio","Video","Podcast"].includes(item.resourceType) ? `${clockText(durationMs * ratio)} / ${clockText(durationMs)}` : `${Math.round(ratio * 100)}%` : "未开始"; return <article tabIndex={0} data-resource-id={item.id} draggable onDragStart={(event) => { const ids = selected ? selectedIds : [item.id]; setDragResourceIds(ids); event.dataTransfer.setData("text/plain", ids.join(",")); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragResourceIds([]); setDropFolderId(0); }} key={item.id} className={`${selected ? "selected" : ""} ${activeId === item.id ? "active" : ""}`} onClick={(event) => handleRowSelection(event, item, index)} onKeyDown={(event) => { if (event.key === "Enter") executeDefault(item); }} onDoubleClick={() => executeDefault(item)} onContextMenu={(event) => openResourceMenu(event, item)}><input type="checkbox" checked={selected} onClick={(event) => { event.stopPropagation(); const mouse = event.nativeEvent as MouseEvent; if (mouse.shiftKey && lastSelectedIndex.current >= 0) { const start = Math.min(lastSelectedIndex.current, index); const end = Math.max(lastSelectedIndex.current, index); setSelectedIds((current) => [...new Set([...current, ...filtered.slice(start, end + 1).map((resource) => resource.id)])]); } else setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); lastSelectedIndex.current = index; setActiveId(item.id); }} readOnly /><span className={`library-type-icon type-${item.resourceType.toLowerCase()}`}>{resourceIcon(item.resourceType)}</span><div className="library-resource-title"><strong>{item.title}</strong><small>{item.sourceName || item.category}{item.tags.length ? ` · ${item.tags.slice(0, 2).join(" / ")}` : ""}</small></div><div className="library-resource-state"><i className={item.processingStatus} /><span>{statusLabel(item.processingStatus)}</span></div><div className="library-resource-progress"><i><em style={{ width: `${Math.round(ratio * 100)}%` }} /></i><small>{progressText}</small></div><div className="library-row-actions"><button className={item.isFavorite ? "active" : ""} onClick={(event) => { event.stopPropagation(); void onToggleFavorite(item); }} aria-label={item.isFavorite ? "取消收藏" : "收藏"}>★</button><button onClick={(event) => openResourceMenu(event, item, true)} aria-label={`更多操作 ${item.title}`}>⋯</button></div></article>; })}{!filtered.length && <div className="empty-state"><strong>{emptyCopy[0]}</strong><span>{emptyCopy[1]}</span></div>}</div></main>
      <aside className={`library-inspector panel ${inspectorMobileOpen ? "mobile-open" : ""}`}><button className="library-inspector-resizer" onPointerDown={startResize} aria-label="调整详情栏宽度" /><header>{selectedResource ? <><div><span className="resource-type">{resourceTypeLabel(selectedResource.resourceType)}</span><h2>{selectedResource.title}</h2></div><button onClick={() => setInspectorMobileOpen(false)}>×</button></> : <div><p className="eyebrow">INSPECTOR</p><h2>资源详情</h2></div>}</header>{selectedResource ? <><nav>{([['overview','概览'],['content','内容'],['processing','处理'],['source','来源']] as const).map(([id,label]) => <button key={id} className={inspectorTab === id ? "active" : ""} onClick={() => { setInspectorTab(id); if (id === "content" && selectedResource.resourceType === "WordList") void ensureWordList(selectedResource); else if (id === "content") void ensureContent(selectedResource); }}>{label}</button>)}</nav><div className="library-inspector-body">
        {inspectorTab === "overview" && <><section className="library-inspector-summary"><span className={`library-large-icon type-${selectedResource.resourceType.toLowerCase()}`}>{resourceIcon(selectedResource.resourceType)}</span><p>{parseResourceMetadata(selectedResource.metadataJson, selectedResource.resourceType).summary || selectedResource.description || "尚未补充摘要"}</p></section>{["Audio","Video","Podcast"].includes(selectedResource.resourceType) && <dl><div><dt>Media Type</dt><dd>{selectedMetadata?.media?.kind || (selectedResource.resourceType === "Video" ? "video" : "audio")}</dd></div><div><dt>Duration</dt><dd>{clockText(Number(selectedMetadata?.media?.durationMs || selectedMetadata?.podcast?.durationMs || 0))}</dd></div><div><dt>泛听状态</dt><dd>{selectedMetadata?.media?.extensiveReady === false ? "不可用" : "可播放"}</dd></div><div><dt>精听状态</dt><dd>{String(selectedMetadata?.media?.intensiveStatus || "not_requested")}</dd></div><div><dt>Transcript Source</dt><dd>{selectedMetadata?.media?.transcriptSource || "尚无"}</dd></div><div><dt>Segments</dt><dd>{selectedMetadata?.mediaSegments.length || 0}</dd></div><div><dt>Translation / QA</dt><dd>{selectedResource.translationStatus} · {selectedMetadata?.mediaReview?.issues.length || 0} issues</dd></div></dl>}{selectedResource.learningUses.length > 0 && <div className="library-learning-uses">{selectedResource.learningUses.map((use) => <button key={use} onClick={() => onStartLearning(selectedResource, use)}>{use} ↗</button>)}</div>}{selectedResource.resourceType === "WordList" && <button className="button primary library-wordlist-import" onClick={() => void importWordList(selectedResource)}>全部加入单词本</button>}<label>标题<input key={`title-${selectedResource.id}`} defaultValue={selectedResource.title} onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== selectedResource.title) void patchResource(selectedResource, { title: event.target.value.trim() }, "标题已更新"); }} /></label><label>说明<textarea key={`description-${selectedResource.id}`} defaultValue={selectedResource.description} onBlur={(event) => { if (event.target.value !== selectedResource.description) void patchResource(selectedResource, { description: event.target.value }, "说明已更新"); }} /></label><dl><div><dt>文件夹</dt><dd><button onClick={() => openPicker("folder", selectedIds.length ? selectedIds : [selectedResource.id])}>{folders.find((folder) => folder.id === selectedResource.readingFolderId)?.name || "收件箱 / 未分类"}</button></dd></div><div><dt>标签</dt><dd><button onClick={() => openPicker("tags", selectedIds.length ? selectedIds : [selectedResource.id])}>{selectedResource.tags.join("、") || "添加标签"}</button></dd></div><div><dt>学习进度</dt><dd>{Math.round((progress[selectedResource.id]?.progressRatio || 0) * 100)}%</dd></div><div><dt>更新时间</dt><dd>{selectedResource.updatedAt || "—"}</dd></div></dl></>}
        {inspectorTab === "content" && <div className="library-content-preview">{["Article","PDF","Text","Subtitle"].includes(selectedResource.resourceType) && (contentLoadingId === selectedResource.id ? <span className="loader" /> : <pre>{contentCache[selectedResource.id] || "暂时没有可预览的 Markdown 内容。"}</pre>)}{["Audio","Video","Podcast"].includes(selectedResource.resourceType) && <><p>{selectedMetadata?.summary || "媒体资料"} · {selectedMetadata?.mediaSegments.length || 0} 个文字片段</p><div className="library-transcript-summary">{selectedMetadata?.mediaSegments.slice(0, 20).map((segment) => <p key={segment.id}><time>{Math.floor(segment.startMs / 1000)}s</time><span>{segment.originalText}</span></p>)}{!selectedMetadata?.mediaSegments.length && <small>尚未生成 Transcript；可在处理详情查看所需能力。</small>}</div></>}{selectedResource.resourceType === "WordList" && <div className="library-wordlist-preview"><strong>{wordListCache[selectedResource.id]?.count || 0} 个词</strong>{wordListCache[selectedResource.id]?.words.slice(0, 30).map((item) => <span key={item.word}><b>{item.word}</b>{item.definition && ` · ${item.definition}`}</span>)}</div>}{selectedResource.resourceType === "Dictionary" && <dl><div><dt>词典名称</dt><dd>{selectedResource.title}</dd></div><div><dt>词条数量</dt><dd>{selectedMetadata?.dictionary?.entryCount || 0}</dd></div><div><dt>查询状态</dt><dd>{selectedResource.status === "archived" ? "已停用" : "可用"}</dd></div></dl>}{["Image","Other"].includes(selectedResource.resourceType) && <p>{selectedMetadata?.summary || selectedResource.description || "此类型暂无额外内容预览。"}</p>}</div>}
        {inspectorTab === "processing" && <div className="library-processing-inspector"><div className="library-status-line"><i className={selectedResource.processingStatus} /><strong>{statusLabel(selectedResource.processingStatus)}</strong></div>{selectedJob ? <><dl><div><dt>当前步骤</dt><dd>{selectedJob.steps.find((step) => step.stepKey === selectedJob.currentStep)?.stepLabel || selectedJob.currentStep || "—"}</dd></div><div><dt>当前进度</dt><dd>{selectedJob.steps.find((step) => step.stepKey === selectedJob.currentStep)?.progressTotal ? `${selectedJob.steps.find((step) => step.stepKey === selectedJob.currentStep)?.progressCurrent}/${selectedJob.steps.find((step) => step.stepKey === selectedJob.currentStep)?.progressTotal}` : `${selectedJob.progress}%`}</dd></div><div><dt>最近完成</dt><dd>{selectedJob.steps.find((step) => step.stepKey === selectedJob.lastSuccessfulStep)?.stepLabel || "尚无"}</dd></div><div><dt>错误</dt><dd>{selectedJob.errorMessage || "无"}</dd></div></dl><button className="button secondary" onClick={() => onOpenMaintenance({ section: "processing", jobId: selectedJob.id })}>查看完整任务</button></> : <p>这个资源暂时没有关联的处理任务。</p>}</div>}
        {inspectorTab === "source" && <div className="library-source-inspector"><dl><div><dt>来源名称</dt><dd>{selectedResource.sourceName || "手工添加"}</dd></div><div><dt>原始地址</dt><dd><code>{selectedResource.sourceUrl || selectedResource.url || "—"}</code></dd></div><div><dt>Markdown</dt><dd><code>{selectedResource.markdownPath || "尚未生成"}</code></dd></div><div><dt>发布日期</dt><dd>{selectedResource.publishedAt || selectedResource.issueDate || "—"}</dd></div></dl>{/^https?:/i.test(selectedResource.sourceUrl || selectedResource.url) && <a className="button secondary" href={selectedResource.sourceUrl || selectedResource.url} target="_blank" rel="noreferrer">打开来源 ↗</a>}</div>}
      </div><footer>{inspectorActions.filter((action) => !action.hidden).slice(0, 4).map((action) => <button key={action.id} className={action.id === resourceDefaultAction(selectedResource) ? "primary" : ""} onClick={() => void action.handler()}>{action.icon} {action.label}</button>)}</footer></> : <div className="library-inspector-empty"><span>◇</span><strong>选择一个资源</strong><p>这里会显示内容、处理状态、来源和可执行操作。</p></div>}</aside>
    </div>

    {selectedIds.length > 1 && selectedResource && <div className="library-selection-toolbar"><strong>已选 {selectedIds.length} 项</strong>{actionsFor(selectedResource).filter((action) => ["favorite","move","tags","archive"].includes(action.id)).map((action) => <button key={action.id} className={action.danger ? "danger" : ""} onClick={() => void action.handler()}>{action.icon} {action.label}</button>)}<button onClick={() => setSelectedIds([])}>取消</button></div>}
    {undoArchivedIds.length > 0 && <div className="library-undo"><span>已归档 {undoArchivedIds.length} 项资源</span><button onClick={() => void restoreArchived()}>撤销</button><button onClick={() => setUndoArchivedIds([])}>×</button></div>}
    {resourceMenu && contextResource && <ActionMenu actions={actionsFor(contextResource)} x={resourceMenu.x} y={resourceMenu.y} onClose={() => setResourceMenu(null)} />}
    {folderMenu && contextFolder && <div className="library-context-menu folder" role="menu" style={{ left: folderMenu.x, top: folderMenu.y }}><button role="menuitem" onClick={() => { setFolderId(contextFolder.id); setSmartView("all"); setFolderMenu(null); }}><span>▣</span><b>打开</b></button><button role="menuitem" onClick={() => void renameFolder(contextFolder)}><span>✎</span><b>重命名</b></button><button role="menuitem" className="danger" onClick={() => void deleteFolder(contextFolder)}><span>⌫</span><b>删除</b></button></div>}
    {picker && <div className="modal-layer library-picker-layer" role="dialog" aria-modal="true"><div className="panel library-picker"><header><div><p className="eyebrow">{picker.ids.length > 1 ? `${picker.ids.length} ITEMS` : "RESOURCE"}</p><h2>{picker.kind === "folder" ? "移动到文件夹" : "管理标签"}</h2></div><button onClick={() => setPicker(null)}>×</button></header>{picker.kind === "folder" ? <div className="library-folder-picker"><input value={folderSearch} onChange={(event) => setFolderSearch(event.target.value)} placeholder="搜索文件夹" /><button onClick={() => void moveResources(picker.ids, null)}><span>□</span><b>收件箱 / 未分类</b></button>{filteredFolders.map((folder) => <button key={folder.id} onClick={() => void moveResources(picker.ids, folder.id)}><span>▣</span><b>{folder.name}</b><em>{folder.resourceCount}</em></button>)}</div> : <div className="library-tag-picker"><label>搜索已有标签<input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="搜索" /></label>{availableTags.length > 0 && <section><small>已有标签（点击加入）</small><div>{availableTags.map((item) => <button key={item} onClick={() => setTagDraft((current) => [...new Set([...current.split(/[,，]/).map((value) => value.trim()).filter(Boolean), item])].join(", "))}>{item}</button>)}</div></section>}<label>新增或将要加入的标签<input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="多个标签用逗号分隔" /></label>{selectedTags.length > 0 && <section><small>当前标签（点击标记移除）</small><div>{selectedTags.map((item) => <button key={item} className={removeTags.includes(item) ? "remove" : ""} onClick={() => setRemoveTags((current) => current.includes(item) ? current.filter((tagName) => tagName !== item) : [...current, item])}>{item}{removeTags.includes(item) ? " ×" : ""}</button>)}</div></section>}<footer><button className="button secondary" onClick={() => setPicker(null)}>取消</button><button className="button primary" onClick={() => void saveTags(picker.ids)}>保存标签</button></footer></div>}</div></div>}
    {quickResource && <div className="modal-layer library-preview-layer" role="dialog" aria-modal="true" aria-label="快速预览"><div className="panel library-quick-preview"><header><div><span className="resource-type">{resourceTypeLabel(quickResource.resourceType)} · 快速预览</span><h2>{quickResource.title}</h2></div><button onClick={() => setQuickPreviewId(0)}>×</button></header><div className="library-preview-meta"><span>{quickResource.sourceName || "手工添加"}</span><span>{statusLabel(quickResource.processingStatus)}</span>{quickMetadata?.summary && <p>{quickMetadata.summary}</p>}</div><div className="library-preview-body">{["Audio","Podcast"].includes(quickResource.resourceType) && <audio controls src={mediaUrl} />}{quickResource.resourceType === "Video" && <video controls src={mediaUrl} />}{quickResource.resourceType === "Image" && <img src={mediaUrl} alt={quickResource.title} />}{["Article","PDF","Text","Subtitle"].includes(quickResource.resourceType) && <pre>{contentLoadingId === quickResource.id ? "正在读取…" : contentCache[quickResource.id]?.slice(0, 6000) || "暂时没有可预览正文。"}</pre>}{quickResource.resourceType === "WordList" && <div className="library-wordlist-preview"><strong>{wordListCache[quickResource.id]?.count || 0} 个词</strong>{wordListCache[quickResource.id]?.words.slice(0, 30).map((item) => <span key={item.word}><b>{item.word}</b>{item.definition && ` · ${item.definition}`}</span>)}</div>}{quickResource.resourceType === "Dictionary" && <dl><div><dt>词典名称</dt><dd>{quickResource.title}</dd></div><div><dt>词条数量</dt><dd>{quickMetadata?.dictionary?.entryCount || 0}</dd></div><div><dt>查询顺序</dt><dd>{quickMetadata?.dictionary?.sourceId || "按词典管理顺序"}</dd></div><div><dt>状态</dt><dd>{quickResource.status === "archived" ? "已停用" : "可用"}</dd></div></dl>}{quickResource.resourceType === "Other" && <p>{quickResource.description || "此资源暂无可预览内容。"}</p>}</div><footer><small>快速预览不会写入阅读进度。</small><button className="button primary" onClick={() => executeDefault(quickResource)}>打开</button></footer></div></div>}
    {triageResource && <div className="modal-layer library-triage-layer" role="dialog" aria-modal="true"><div className="panel library-triage"><header><div><p className="eyebrow">INBOX TRIAGE · {triageIndex + 1}/{triageIds.length}</p><h2>{triageResource.title}</h2><p>{triageResource.description || parseResourceMetadata(triageResource.metadataJson, triageResource.resourceType).summary || "等待整理的新资源"}</p></div><button onClick={() => setTriageIds([])}>×</button></header><div className="library-triage-form"><div className="library-triage-meta"><span className="resource-type">{resourceTypeLabel(triageResource.resourceType)}</span><span>{statusLabel(triageResource.processingStatus)}</span><span>{triageResource.sourceName || "手工添加"}</span></div><label>放入文件夹<select value={triageFolderId} onChange={(event) => setTriageFolderId(Number(event.target.value))}><option value="0">暂留 Inbox</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><label>标签<input value={triageTags} onChange={(event) => setTriageTags(event.target.value)} placeholder="多个标签用逗号分隔" /></label></div><div className="library-triage-quick-actions"><button onClick={() => void onToggleFavorite(triageResource)}>{triageResource.isFavorite ? "取消收藏" : "★ 收藏"}</button>{triageResource.processingStatus === "review_required" ? <button onClick={() => onOpenMaintenance({ section: "processing", resourceId: triageResource.id })}>打开复核</button> : PROBLEM_STATES.has(triageResource.processingStatus) ? <button onClick={() => executeDefault(triageResource)}>处理问题</button> : canStartResource(triageResource) ? <button onClick={() => startResource(triageResource)}>开始学习</button> : null}<button className="danger" onClick={() => void archiveResources([triageResource.id], advanceTriage)}>归档</button></div><footer><button className="button secondary" onClick={advanceTriage}>稍后</button><button className="button primary" onClick={() => void saveTriage()}>保存并处理下一项</button></footer></div></div>}
    {importOpen && <ResourceImportModal folders={folders} onClose={() => setImportOpen(false)} onDone={reloadAndClear} onNotice={onNotice} />}
  </section>;
}
