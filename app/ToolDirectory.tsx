"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ResourceItem } from "./types";

const SOURCE_NAME = "EngLearner 资源目录";

type ToolDirectoryProps = {
  resources: ResourceItem[];
  importing: boolean;
  onImport: () => Promise<void>;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
  onToggleFavorite: (item: ResourceItem) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onReorder: (category: string, orderedIds: number[]) => Promise<void>;
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result;
}

async function saveResource(item: ResourceItem): Promise<void> {
  await jsonRequest("/api/resources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...item, collection: "tool" }),
  });
}

function SortableToolCard({
  item,
  sortingDisabled,
  batchMode,
  selected,
  onSelect,
  onEdit,
  onToggleFavorite,
}: {
  item: ResourceItem;
  sortingDisabled: boolean;
  batchMode: boolean;
  selected: boolean;
  onSelect: (item: ResourceItem, selected: boolean) => void;
  onEdit: (item: ResourceItem) => void;
  onToggleFavorite: (item: ResourceItem) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: sortingDisabled || batchMode });

  return (
    <article
      ref={setNodeRef}
      className={`tool-card panel ${isDragging ? "dragging" : ""} ${selected ? "selected" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      id={`tool-${item.id}`}
    >
      <div className="tool-card-top">
        <span className="tool-app-icon" aria-hidden="true">
          {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
          <i>◎</i>
        </span>
        <div className="tool-card-actions">
          {batchMode ? (
            <label className="tool-select" title="选择这个网站">
              <input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected} onChange={(event) => onSelect(item, event.target.checked)} />
            </label>
          ) : (
            <button className={`favorite-button ${item.isFavorite ? "active" : ""}`} onClick={() => void onToggleFavorite(item)} aria-label={item.isFavorite ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}>★</button>
          )}
          <button className="drag-handle" type="button" disabled={sortingDisabled || batchMode} aria-label={`拖动排序 ${item.title}`} title={sortingDisabled ? "清除搜索后可拖动" : batchMode ? "退出批量维护后可拖动" : "按住拖动排序"} {...attributes} {...listeners}>⠿</button>
        </div>
      </div>
      <h3>{item.title}</h3>
      <p>{item.description || "尚未填写网站说明"}</p>
      <div className="tool-meta"><span>{item.resourceType}</span><span>{item.skills}</span></div>
      <div className="tool-card-footer"><button type="button" onClick={() => onEdit(item)}>编辑</button><a href={item.url} target="_blank" rel="noopener noreferrer">打开网站 ↗</a></div>
    </article>
  );
}

export default function ToolDirectory({ resources, importing, onImport, onReload, onNotice, onToggleFavorite, onRemove, onReorder }: ToolDirectoryProps) {
  const [search, setSearch] = useState("");
  const [expandedCategory, setExpandedCategory] = useState("");
  const [editing, setEditing] = useState<ResourceItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchCategory, setBatchCategory] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tools = useMemo(() => resources
    .filter((item) => item.collection === "tool" || item.sourceName === SOURCE_NAME)
    .filter((item) => item.status !== "hidden")
    .sort((first, second) => first.sortOrder - second.sortOrder || first.title.localeCompare(second.title, "zh-CN")), [resources]);
  const categories = useMemo(() => Array.from(new Set(tools.map((item) => item.category))), [tools]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredBySearch = (item: ResourceItem) => `${item.title} ${item.description} ${item.category} ${item.skills}`.toLowerCase().includes(normalizedSearch);
  const visibleCount = tools.filter(filteredBySearch).length;
  const activeExpanded = expandedCategory;

  function jumpToCategory(category: string) {
    setExpandedCategory(category);
    document.getElementById(`tools-${encodeURIComponent(category)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDragEnd(category: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || normalizedSearch || batchMode) return;
    const categoryItems = tools.filter((item) => item.category === category);
    const oldIndex = categoryItems.findIndex((item) => item.id === active.id);
    const newIndex = categoryItems.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    await onReorder(category, arrayMove(categoryItems, oldIndex, newIndex).map((item) => item.id));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await saveResource(editing);
      await onReload();
      setEditing(null);
      onNotice("工具信息已保存。该目录已转为你的私人版本，不再依赖原网站同步。");
    } catch (error) { onNotice((error as Error).message); } finally { setSaving(false); }
  }

  async function handleRemove() {
    if (!editing) return;
    await onRemove(editing.id);
    setEditing(null);
  }

  function selectTool(item: ResourceItem, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, item.id])) : current.filter((id) => id !== item.id));
  }

  async function runBatch(action: "delete" | "category") {
    if (!selectedIds.length) return onNotice("请先选择要维护的网站");
    if (action === "category" && !batchCategory.trim()) return onNotice("请输入新的分类名称");
    if (action === "delete" && !window.confirm(`确定从私人目录移除选中的 ${selectedIds.length} 个网站吗？`)) return;
    try {
      await jsonRequest("/api/resources/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedIds, action, category: batchCategory.trim() }) });
      setSelectedIds([]);
      await onReload();
      onNotice("学习工具批量维护已完成");
    } catch (error) { onNotice((error as Error).message); }
  }

  return (
    <section>
      <div className="page-heading tools-heading">
        <div><p className="eyebrow">LEARNING TOOLBOX</p><h1>学习工具网站</h1><p>左侧目录用于快速定位，右侧按分类连续浏览。网站说明、分类和顺序都由你独立维护。</p></div>
        {tools.length ? <button className={`button ${batchMode ? "primary" : "secondary"}`} onClick={() => { setBatchMode((value) => !value); setSelectedIds([]); }}>{batchMode ? "完成批量维护" : "批量维护"}</button> : <button className="button primary" disabled={importing} onClick={() => void onImport()}>{importing ? "正在导入…" : "一次导入公开目录"}</button>}
      </div>

      {!tools.length ? (
        <div className="panel tools-empty"><span className="source-logo">EL</span><div><h2>{importing ? "正在整理公开网站目录…" : "学习工具目录尚未导入"}</h2><p>{importing ? "系统正在提取网站名称、原始图标、分类、说明和链接。" : "只需导入一次；完成后目录与原网站断开，由你独立修改维护。"}</p></div></div>
      ) : (
        <>
          <div className="tools-toolbar panel"><div className="search-box"><span aria-hidden="true">⌕</span><input aria-label="搜索学习工具" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索网站、用途或分类…" /></div><div className="tools-summary"><strong>{visibleCount}</strong> 个网站 · {categories.length} 个分类</div></div>
          {batchMode && <div className="panel tool-batch-bar"><span>已选 {selectedIds.length} 项</span><button className="text-button" onClick={() => setSelectedIds(tools.filter(filteredBySearch).map((item) => item.id))}>选择当前结果</button><input value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)} placeholder="移动到新分类" /><button className="button secondary" onClick={() => void runBatch("category")}>批量改分类</button><button className="button danger" onClick={() => void runBatch("delete")}>批量删除</button></div>}
          {normalizedSearch && !batchMode && <p className="sorting-note">搜索结果中暂不启用拖动；清除搜索后即可调整分类内顺序。</p>}
          <div className="directory-layout tool-directory-layout">
            <aside className="panel directory-sidebar">
              <div className="directory-title"><strong>网站分类</strong><small>展开一个，其它自动折叠</small></div>
              {categories.map((category) => {
                const items = tools.filter((item) => item.category === category && filteredBySearch(item));
                const open = activeExpanded === category;
                return <div className={`directory-group ${open ? "open" : ""}`} key={category}><button onClick={() => setExpandedCategory(open ? "" : category)}><span>{open ? "▾" : "▸"}</span><strong>{category}</strong><em>{items.length}</em></button>{open && <nav>{items.map((item) => <button key={item.id} onClick={() => { jumpToCategory(category); document.getElementById(`tool-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>{item.title}</button>)}</nav>}</div>;
              })}
            </aside>
            <div className="tool-category-list">
              {categories.map((category) => {
                const categoryItems = tools.filter((item) => item.category === category);
                const matchingItems = categoryItems.filter(filteredBySearch);
                if (!matchingItems.length) return null;
                return <section className="tool-category" id={`tools-${encodeURIComponent(category)}`} key={category}><div className="tool-category-heading"><div><h2>{category}</h2><span>{matchingItems.length} 项</span></div><small>{batchMode ? "勾选卡片进行批量维护" : "按住卡片右上角 ⠿ 拖动排序"}</small></div><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(category, event)}><SortableContext items={matchingItems.map((item) => item.id)} strategy={rectSortingStrategy}><div className="tool-grid">{matchingItems.map((item) => <SortableToolCard key={item.id} item={item} sortingDisabled={Boolean(normalizedSearch)} batchMode={batchMode} selected={selectedIds.includes(item.id)} onSelect={selectTool} onEdit={setEditing} onToggleFavorite={onToggleFavorite} />)}</div></SortableContext></DndContext></section>;
              })}
              {!visibleCount && <div className="panel empty-state wide"><strong>没有匹配的网站</strong><span>换一个关键词再试。</span></div>}
            </div>
          </div>
        </>
      )}

      {editing && <div className="editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="tool-editor panel" role="dialog" aria-modal="true" aria-label="编辑学习工具" onSubmit={handleSave}><div className="tool-editor-heading"><div><p className="eyebrow">EDIT TOOL</p><h2>编辑学习工具</h2></div><button type="button" onClick={() => setEditing(null)} aria-label="关闭编辑窗口">×</button></div><label><span>网站名称 *</span><input required value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label><label><span>网站说明</span><textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} placeholder="记录它适合练什么、怎么使用…" /></label><div className="form-two"><label><span>分类 *</span><input required list="tool-categories" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></label><label><span>类型</span><select value={editing.resourceType} onChange={(event) => setEditing({ ...editing, resourceType: event.target.value })}><option>网站</option><option>视频</option><option>音频</option><option>词典/词汇</option><option>网盘资料</option><option>其它</option></select></label></div><datalist id="tool-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist><div className="form-two"><label><span>适用程度</span><input value={editing.level} onChange={(event) => setEditing({ ...editing, level: event.target.value })} /></label><label><span>训练技能</span><input value={editing.skills} onChange={(event) => setEditing({ ...editing, skills: event.target.value })} /></label></div><label><span>原始网站图标</span><input type="url" value={editing.iconUrl} onChange={(event) => setEditing({ ...editing, iconUrl: event.target.value })} placeholder="https://…/favicon.png" /></label><label><span>网站链接 *</span><input type="url" required value={editing.url} onChange={(event) => setEditing({ ...editing, url: event.target.value })} /></label><div className="tool-editor-actions"><button type="button" className="danger-link" onClick={() => void handleRemove()}>从目录移除</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存修改"}</button></div></form></div>}
    </section>
  );
}
