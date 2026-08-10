"use client";

import { useCallback, useEffect, useState } from "react";
import LearningDesk, { type DeskTab } from "./LearningDesk";
import MaintenanceCenter from "./MaintenanceCenter";
import ResourceLibrary from "./ResourceLibrary";
import ToolDirectory from "./ToolDirectory";
import type {
  ActivityItem,
  CourseItem,
  NoteItem,
  OneDriveStatus,
  PlanItem,
  ProcessingJob,
  ProviderStatus,
  ProgressItem,
  ResourceItem,
  UploadItem,
  VocabularyItem,
} from "./types";
import type { LearningUse } from "./resource-model";

type View = "desk" | "tools" | "library" | "admin";
type FontSize = "compact" | "standard" | "large" | "xlarge";

const NAVIGATION: { id: View; label: string; icon: string }[] = [
  { id: "desk", label: "学习台", icon: "⌂" },
  { id: "library", label: "资源库", icon: "◇" },
  { id: "tools", label: "学习工具", icon: "▦" },
  { id: "admin", label: "维护中心", icon: "⚙" },
];

const DESK_TABS: { id: DeskTab; label: string; icon: string }[] = [
  { id: "overview", label: "学习首页", icon: "·" },
  { id: "courses", label: "在学课程", icon: "·" },
  { id: "reading", label: "文章阅读", icon: "·" },
  { id: "listening", label: "听力训练", icon: "·" },
  { id: "speaking", label: "口语训练", icon: "·" },
  { id: "vocabulary", label: "单词学习", icon: "·" },
  { id: "grammar", label: "语法学习", icon: "·" },
  { id: "notes", label: "学习笔记", icon: "·" },
  { id: "progress", label: "学习进度", icon: "·" },
];

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

export default function EnglishHub({ displayName }: { displayName: string }) {
  const [view, setViewState] = useState<View>("desk");
  const [deskTab, setDeskTabState] = useState<DeskTab>("overview");
  const [deskMenuOpen, setDeskMenuOpen] = useState(true);
  const [fontSize, setFontSize] = useState<FontSize>("standard");
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [oneDrive, setOneDrive] = useState<OneDriveStatus | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);

  const loadResources = useCallback(async () => setResources((await jsonRequest<{ resources: ResourceItem[] }>("/api/resources")).resources), []);
  const loadProgress = useCallback(async () => setProgress((await jsonRequest<{ progress: ProgressItem[] }>("/api/progress")).progress), []);
  const loadPlans = useCallback(async () => setPlans((await jsonRequest<{ plans: PlanItem[] }>("/api/plans")).plans), []);
  const loadUploads = useCallback(async () => setUploads((await jsonRequest<{ uploads: UploadItem[] }>("/api/uploads")).uploads), []);
  const loadCourses = useCallback(async () => setCourses((await jsonRequest<{ courses: CourseItem[] }>("/api/courses")).courses), []);
  const loadNotes = useCallback(async () => setNotes((await jsonRequest<{ notes: NoteItem[] }>("/api/notes")).notes), []);
  const loadVocabulary = useCallback(async () => setVocabulary((await jsonRequest<{ vocabulary: VocabularyItem[] }>("/api/vocabulary")).vocabulary), []);
  const loadActivities = useCallback(async () => setActivities((await jsonRequest<{ activities: ActivityItem[] }>("/api/activities")).activities), []);
  const loadSystem = useCallback(async () => {
    const [processing, drive, providerData] = await Promise.all([
      jsonRequest<{ jobs: ProcessingJob[]; aiConfigured: boolean }>("/api/processing"),
      jsonRequest<OneDriveStatus>("/api/onedrive/status"),
      jsonRequest<{ providers: ProviderStatus[] }>("/api/providers"),
    ]);
    setJobs(processing.jobs);
    setAiConfigured(processing.aiConfigured);
    setOneDrive(drive);
    setProviders(providerData.providers);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadResources(), loadProgress(), loadPlans(), loadUploads(), loadCourses(), loadNotes(), loadVocabulary(), loadActivities(), loadSystem()]);
  }, [loadActivities, loadCourses, loadNotes, loadPlans, loadProgress, loadResources, loadSystem, loadUploads, loadVocabulary]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const hash = window.location.hash.replace("#", "");
      const savedFontSize = window.localStorage.getItem("english-room-font-size") as FontSize | null;
      if (savedFontSize && ["compact", "standard", "large", "xlarge"].includes(savedFontSize)) setFontSize(savedFontSize);
      if (hash === "dashboard") setViewState("desk");
      else if (hash === "course" || hash === "desk-nce") { setViewState("desk"); setDeskTabState("listening"); }
      else if (hash === "progress") { setViewState("desk"); setDeskTabState("progress"); }
      else if (hash.startsWith("desk-")) {
        const requestedTab = hash.slice(5) as DeskTab;
        if (DESK_TABS.some((item) => item.id === requestedTab)) { setViewState("desk"); setDeskTabState(requestedTab); }
      } else if (NAVIGATION.some((item) => item.id === hash)) setViewState(hash as View);
      refreshAll().catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false));
    });
    return () => { active = false; };
  }, [refreshAll]);

  useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize;
    window.localStorage.setItem("english-room-font-size", fontSize);
  }, [fontSize]);

  function setView(next: View) {
    setViewState(next);
    if (next === "desk") setDeskMenuOpen(true);
    window.history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (next === "tools" && !resources.some((item) => item.collection === "tool") && !importing) void importDirectory();
  }

  function setDeskTab(next: DeskTab) {
    setViewState("desk");
    setDeskMenuOpen(true);
    setDeskTabState(next);
    window.history.replaceState(null, "", `#desk-${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleFavorite(item: ResourceItem) {
    setResources((current) => current.map((resource) => resource.id === item.id ? { ...resource, isFavorite: !resource.isFavorite } : resource));
    try {
      await jsonRequest("/api/resources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, isFavorite: !item.isFavorite }) });
    } catch (error) { setNotice((error as Error).message); await loadResources(); }
  }

  async function removeResource(id: number) {
    if (!window.confirm("确定移除这条目录记录吗？")) return;
    await jsonRequest(`/api/resources?id=${id}&permanent=true`, { method: "DELETE" });
    await loadResources();
  }

  async function importDirectory() {
    if (resources.some((item) => item.collection === "tool")) return;
    setImporting(true);
    setNotice("正在一次性读取并整理 EngLearner 的公开网站目录…");
    try {
      const data = await jsonRequest<{ imported: number }>("/api/resources/import-englearner", { method: "POST" });
      await loadResources();
      setNotice(`已导入 ${data.imported} 个网站，并保存原始图标和分类。目录现在由你独立维护，不再自动同步。`);
    } catch (error) { setNotice((error as Error).message); } finally { setImporting(false); }
  }

  async function reorderResources(category: string, orderedIds: number[]) {
    const categoryItems = resources.filter((item) => item.category === category && item.collection === "tool");
    const baseOrder = categoryItems.length ? Math.min(...categoryItems.map((item) => item.sortOrder)) : 0;
    const orderById = new Map(orderedIds.map((id, index) => [id, baseOrder + index]));
    setResources((current) => current.map((item) => orderById.has(item.id) ? { ...item, sortOrder: orderById.get(item.id)! } : item));
    try {
      await jsonRequest("/api/resources/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, orderedIds }) });
    } catch (error) { setNotice((error as Error).message); await loadResources(); }
  }

  function exportData() {
    const payload = { exportedAt: new Date().toISOString(), resources, courses, notes, vocabulary, progress, activities, plans, uploads, jobs };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `english-room-index-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function startLearning(resource: ResourceItem, learningUse: LearningUse) {
    const target: DeskTab = learningUse === "Listening" ? "listening" : learningUse === "Speaking" ? "speaking" : learningUse === "Vocabulary" ? "vocabulary" : "reading";
    window.localStorage.setItem("english-room-reader-resource", String(resource.id));
    window.localStorage.setItem("english-room-media-resource", String(resource.id));
    window.localStorage.setItem("english-room-speaking-resource", String(resource.id));
    setDeskTab(target);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("desk")}><span className="brand-mark">E</span><span><strong>English Room</strong><small>私人英语学习空间</small></span></button>
        <nav className="main-nav" aria-label="主导航">
          {NAVIGATION.map((item) => <div className="nav-group" key={item.id}><button className={view === item.id ? "active" : ""} onClick={() => item.id === "desk" && view === "desk" ? setDeskMenuOpen((open) => !open) : setView(item.id)}><span>{item.icon}</span>{item.label}{item.id === "desk" && <em>{view === "desk" && deskMenuOpen ? "⌃" : "⌄"}</em>}</button>{item.id === "desk" && view === "desk" && deskMenuOpen && <div className="desk-subnav"><div><small>学习课程</small><button className="subnav-pin" onClick={() => setDeskMenuOpen(false)}>收起</button></div>{DESK_TABS.map((tab) => <button key={tab.id} className={deskTab === tab.id ? "active" : ""} onClick={() => setDeskTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}</div>}</div>)}
        </nav>
        <div className="sidebar-note"><span className="status-dot" /><div><strong>个人数据空间</strong><small>{oneDrive?.connected ? "OneDrive 已连接" : "等待连接个人版 OneDrive"}</small></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><button className="mobile-brand" onClick={() => setView("desk")}><span className="brand-mark">E</span> English Room</button><div className="topbar-copy"><span>学习、整理和复习，都在同一个空间。</span></div><div className="topbar-actions"><label className="font-size-control"><span>A</span><select aria-label="调整网页字体大小" value={fontSize} onChange={(event) => setFontSize(event.target.value as FontSize)}><option value="compact">紧凑</option><option value="standard">标准</option><option value="large">大字</option><option value="xlarge">特大</option></select><strong>A+</strong></label><div className="user-chip"><span>{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><small>学习者</small></div></div></div></header>
        <nav className="mobile-nav" aria-label="移动端导航">{NAVIGATION.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        {view === "desk" && <nav className="mobile-desk-tabs" aria-label="学习台功能">{DESK_TABS.map((tab) => <button key={tab.id} className={deskTab === tab.id ? "active" : ""} onClick={() => setDeskTab(tab.id)}>{tab.label}</button>)}</nav>}
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示">×</button></div>}

        <div className="content-wrap">
          {loading ? <div className="loading-screen"><span className="loader" />正在打开你的学习空间…</div> : <>
            {view === "desk" && <LearningDesk activeTab={deskTab} onTabChange={setDeskTab} courses={courses} resources={resources} notes={notes} vocabulary={vocabulary} progress={progress} activities={activities} plans={plans} providers={providers} onReloadResources={loadResources} onReloadCourses={loadCourses} onReloadNotes={loadNotes} onReloadVocabulary={loadVocabulary} onReloadProgress={loadProgress} onReloadActivities={loadActivities} onReloadPlans={loadPlans} onNotice={setNotice} />}
            {view === "tools" && <ToolDirectory resources={resources} importing={importing} onImport={importDirectory} onReload={loadResources} onNotice={setNotice} onToggleFavorite={toggleFavorite} onRemove={removeResource} onReorder={reorderResources} />}
            {view === "library" && <ResourceLibrary resources={resources} onRead={(resource) => startLearning(resource, "Reading")} onStartLearning={startLearning} onReloadResources={loadResources} onNotice={setNotice} onToggleFavorite={toggleFavorite} />}
            {view === "admin" && <MaintenanceCenter oneDrive={oneDrive} aiConfigured={aiConfigured} providers={providers} jobs={jobs} uploads={uploads} resources={resources} onReload={refreshAll} onNotice={setNotice} onExport={exportData} />}
          </>}
        </div>
        <footer><span>English Room · 私人英语学习空间</span><span>Markdown 内容与学习记录由你维护 · 外部资源版权归原作者所有</span></footer>
      </main>
    </div>
  );
}
