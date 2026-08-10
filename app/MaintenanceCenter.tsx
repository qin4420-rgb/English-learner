"use client";

/* Dynamic resource names are the visible text for their wrapped checkboxes. */
/* eslint-disable jsx-a11y/label-has-associated-control */

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DictionarySourceItem, OneDriveStatus, ProcessingJob, ProviderStatus, ResourceItem, UploadItem } from "./types";

type Props = {
  oneDrive: OneDriveStatus | null;
  aiConfigured: boolean;
  providers: ProviderStatus[];
  jobs: ProcessingJob[];
  uploads: UploadItem[];
  resources: ResourceItem[];
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
  onExport: () => void;
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function dateText(value: string) {
  if (!value) return "尚未";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value.replace(" ", "T")));
}

export default function MaintenanceCenter({ oneDrive, aiConfigured, providers, jobs, uploads, resources, onReload, onNotice, onExport }: Props) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlCategory, setUrlCategory] = useState("收藏的网站文章");
  const [fileCategory, setFileCategory] = useState("离线文章阅读");
  const [processing, setProcessing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchCategory, setBatchCategory] = useState("");
  const [jobTab, setJobTab] = useState<"processing" | "review" | "failed" | "complete">("processing");
  const [dictionaries, setDictionaries] = useState<DictionarySourceItem[]>([]);
  const [dictionaryTest, setDictionaryTest] = useState("");
  const [dictionaryResult, setDictionaryResult] = useState("");
  const library = resources.filter((item) => item.collection === "library");
  const visibleJobs = useMemo(() => jobs.filter((job) => jobTab === "processing" ? ["queued", "waiting", "processing", "needs_provider"].includes(job.status) : jobTab === "review" ? job.status === "review_required" : jobTab === "failed" ? job.status === "failed" : job.status === "complete"), [jobTab, jobs]);

  async function loadDictionaries() {
    const data = await jsonRequest<{ sources: DictionarySourceItem[] }>("/api/dictionaries"); setDictionaries(data.sources);
  }
  useEffect(() => { queueMicrotask(() => void loadDictionaries().catch((error: Error) => onNotice(error.message))); }, [onNotice]);

  async function connectOneDrive() {
    try {
      const data = await jsonRequest<{ authorizationUrl: string }>("/api/onedrive/connect", { method: "POST" });
      window.location.href = data.authorizationUrl;
    } catch (error) { onNotice((error as Error).message); }
  }

  async function disconnectOneDrive() {
    if (!window.confirm("断开后不会删除OneDrive文件，但自动同步会停止。确定断开吗？")) return;
    await jsonRequest("/api/onedrive/disconnect", { method: "POST" });
    await onReload();
  }

  async function processUrl(event: FormEvent) {
    event.preventDefault();
    setProcessing(true);
    try {
      const result = await jsonRequest<{ oneDriveSynced: boolean; aiEnhanced: boolean }>("/api/processing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputType: "url", sourceUrl, category: urlCategory }) });
      setSourceUrl("");
      await onReload();
      onNotice(`网页已保存为Markdown${result.aiEnhanced ? "，并完成AI摘要与翻译" : "；AI内容等待密钥配置"}${result.oneDriveSynced ? "，已同步OneDrive" : "，等待OneDrive连接"}`);
    } catch (error) { await onReload(); onNotice((error as Error).message); } finally { setProcessing(false); }
  }

  async function processFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("source-file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      const uploadBody = new FormData(); uploadBody.append("files", file); uploadBody.append("tags", fileCategory);
      await jsonRequest<{ resources: number[] }>("/api/resources/import", { method: "POST", body: uploadBody });
      form.reset();
      await onReload();
      onNotice("资源记录已建立并进入处理队列；原文件会保留在OneDrive/R2，处理失败也不会丢失。");
    } catch (error) { await onReload(); onNotice((error as Error).message); } finally { setProcessing(false); }
  }

  async function batchAction(action: "archive" | "category" | "hide") {
    if (!selectedIds.length) return onNotice("请先勾选要维护的资源");
    if (action === "archive" && !window.confirm(`确定归档选中的 ${selectedIds.length} 条资源记录吗？原始文件不会删除。`)) return;
    try {
      await jsonRequest("/api/resources/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedIds, action, category: batchCategory }) });
      setSelectedIds([]);
      await onReload();
      onNotice("批量维护已完成");
    } catch (error) { onNotice((error as Error).message); }
  }

  async function jobAction(id: number, action: "retry" | "confirm" | "later") {
    try { await jsonRequest("/api/processing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) }); await onReload(); onNotice(action === "retry" ? "任务已重新处理" : action === "confirm" ? "资源已确认入库" : "任务已标记为稍后复核"); } catch (error) { onNotice((error as Error).message); }
  }

  async function updateDictionary(id: number, change: Record<string, unknown>) {
    try { await jsonRequest("/api/dictionaries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...change }) }); await loadDictionaries(); } catch (error) { onNotice((error as Error).message); }
  }

  async function testDictionary() {
    if (!dictionaryTest.trim()) return;
    try { const result = await jsonRequest<{ dictionaryDefinition: string; dictionarySource?: string }>("/api/vocabulary/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: dictionaryTest }) }); setDictionaryResult(`${result.dictionarySource || "基础词典"}：${result.dictionaryDefinition}`); } catch (error) { onNotice((error as Error).message); }
  }

  return <section>
    <div className="page-heading"><div><p className="eyebrow">MAINTENANCE CENTER</p><h1>维护与资料处理中心</h1><p>日常只需在这里提交文件或链接；页面结构和新功能继续在Codex桌面客户端调整。</p></div><button className="button secondary" onClick={onExport}>导出索引备份</button></div>
    <div className="system-status-grid">
      <article className={`panel system-card ${oneDrive?.connected ? "connected" : ""}`}><div className="system-card-icon">☁</div><div><span className="status-label">主要数据中心</span><h2>个人版 OneDrive</h2><p>{oneDrive?.connected ? `已连接：${oneDrive.accountLabel}` : oneDrive?.configured ? "应用已经配置，等待你的微软授权" : "网站功能已就绪，等待配置微软应用信息"}</p><small>{oneDrive?.connected ? `${oneDrive.appFolder} · 最近同步 ${dateText(oneDrive.lastSyncAt)}` : `回调地址：${oneDrive?.redirectUri || "加载中…"}`}</small></div>{oneDrive?.connected ? <button className="button secondary" onClick={() => void disconnectOneDrive()}>断开</button> : <button className="button primary" disabled={!oneDrive?.configured} onClick={() => void connectOneDrive()}>连接OneDrive</button>}</article>
      <article className={`panel system-card ${aiConfigured ? "connected" : ""}`}><div className="system-card-icon">AI</div><div><span className="status-label">内容整理引擎</span><h2>DeepSeek API</h2><p>{aiConfigured ? "已配置：自动摘要、专业翻译与重点词汇" : "尚未配置：仍可提取正文并生成基础Markdown"}</p><small>密钥只保存在网站后台，不写入GitHub或OneDrive。</small></div><span className="connection-state">{aiConfigured ? "可用" : "待配置"}</span></article>
    </div>
    <section className="panel provider-status-panel"><div className="panel-heading"><div><p className="eyebrow">PROVIDER STATUS</p><h2>能力接口状态</h2><p>AI、OCR、STT、发音评估和TTS均采用可替换接口；未配置时明确降级。</p></div></div><div className="provider-status-list">{providers.map((provider) => <article className={provider.configured ? "configured" : ""} key={provider.id}><span>{provider.id === "ai" ? "AI" : provider.id === "ocr" ? "OCR" : provider.id === "stt" ? "STT" : provider.id === "tts" ? "TTS" : "PR"}</span><div><strong>{provider.label}</strong><small>{provider.provider}</small></div><em>{provider.configured ? "已配置" : provider.id === "tts" ? "浏览器回退" : "未配置"}</em></article>)}</div></section>
    {oneDrive && !oneDrive.configured && <div className="setup-callout"><strong>OneDrive还差一次后台配置</strong><p>在微软应用注册中选择“仅个人Microsoft账户”，平台类型选择Web，权限使用 Files.ReadWrite.AppFolder；然后把客户端编号、密钥和令牌加密密钥放入网站的安全运行设置。不要把密钥发到聊天或提交到GitHub。</p><code>{oneDrive.redirectUri}</code></div>}
    <div className="processing-grid">
      <form className="panel processing-card" onSubmit={processFile}><div className="panel-heading"><div><p className="eyebrow">FILE TO RESOURCE</p><h2>上传文件并整理</h2><p>支持PDF、图片、音视频、Markdown、TXT、HTML与字幕；原文件始终保留。</p></div></div><label className="drop-zone"><input name="source-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.mp4,.webm,.md,.markdown,.txt,.html,.htm,.srt,.vtt,text/*,application/pdf,audio/*,video/*,image/*" required /><span>选择文件</span><small>单文件上限25MB</small></label><label><span>保存分类</span><select value={fileCategory} onChange={(event) => setFileCategory(event.target.value)}><option>离线文章阅读</option><option>课程资料</option><option>学习心得记录</option></select></label><button className="button primary" disabled={processing}>{processing ? "正在建立资源…" : "上传并进入处理队列"}</button></form>
      <form className="panel processing-card" onSubmit={processUrl}><div className="panel-heading"><div><p className="eyebrow">WEB TO MARKDOWN</p><h2>保存网页文章</h2><p>正文保存下来，原链接只用于来源标记和以后查询。</p></div></div><label><span>文章网址</span><input type="url" required value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label><label><span>保存分类</span><select value={urlCategory} onChange={(event) => setUrlCategory(event.target.value)}><option>收藏的网站文章</option><option>离线文章阅读</option><option>课程资料</option></select></label><label className="processing-rule"><input type="checkbox" checked readOnly /> 保存英文原文、中文翻译、摘要、主题与重点词汇</label><button className="button primary" disabled={processing}>{processing ? "正在读取并整理…" : "抓取网页并生成Markdown"}</button></form>
    </div>
    <section className="panel jobs-panel"><div className="panel-heading"><div><p className="eyebrow">PROCESSING CONSOLE</p><h2>资源处理台</h2><p>处理、复核、失败与完成都有持久记录；失败不会删除原始资料。</p></div><span className="count-badge">{jobs.length} 项</span></div><nav className="job-tabs">{([['processing','处理中'],['review','待复核'],['failed','失败'],['complete','已完成']] as const).map(([id,label]) => <button className={jobTab === id ? "active" : ""} key={id} onClick={() => setJobTab(id)}>{label}</button>)}</nav><div className="job-list">{visibleJobs.map((job) => <article key={job.id}><span className={`job-state ${job.status}`}>{job.status === "complete" ? "✓" : job.status === "failed" ? "!" : job.status === "review_required" ? "?" : "…"}</span><div><strong>{job.sourceName}</strong><small>{job.stage}{job.error ? ` · ${job.error}` : ""}</small><i><b style={{ width: `${job.progress}%` }} /></i></div><em>{dateText(job.createdAt)}</em><div className="job-actions">{job.status === "review_required" && <><button onClick={() => void jobAction(job.id, "confirm")}>确认入库</button><button onClick={() => void jobAction(job.id, "later")}>稍后</button></>}{["failed", "needs_provider"].includes(job.status) && <button onClick={() => void jobAction(job.id, "retry")}>重试</button>}</div></article>)}{!visibleJobs.length && <div className="empty-state small">当前栏目没有处理记录。</div>}</div></section>
    <section className="panel dictionary-manager"><div className="panel-heading"><div><p className="eyebrow">LOCAL DICTIONARIES</p><h2>本地词典管理</h2><p>查词顺序：启用的本地词典 → 在线基础词典 → AI语境解释。</p></div></div><div className="dictionary-source-list">{dictionaries.map((source) => <article key={source.id}><label><input type="checkbox" checked={source.enabled} onChange={(event) => void updateDictionary(source.id, { enabled: event.target.checked })} /><span><strong>{source.name}</strong><small>{source.entryCount} 条词目</small></span></label><div><button onClick={() => void updateDictionary(source.id, { direction: "up" })}>↑</button><button onClick={() => void updateDictionary(source.id, { direction: "down" })}>↓</button></div></article>)}{!dictionaries.length && <div className="empty-state small">在资源库“添加资源 → 词典”导入CSV、TSV或JSON。</div>}</div><form className="dictionary-test" onSubmit={(event) => { event.preventDefault(); void testDictionary(); }}><input value={dictionaryTest} onChange={(event) => setDictionaryTest(event.target.value)} placeholder="输入英文单词测试查词顺序" /><button className="button secondary">测试</button></form>{dictionaryResult && <p className="dictionary-test-result">{dictionaryResult}</p>}</section>
    <section className="panel batch-panel"><div className="panel-heading"><div><p className="eyebrow">BATCH MAINTENANCE</p><h2>资源库批量维护</h2><p>日常删除改为可恢复的归档；原始文件不受影响。</p></div><span className="count-badge">已选 {selectedIds.length}</span></div><div className="batch-toolbar"><input value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)} placeholder="新的分类名称" /><button className="button secondary" onClick={() => void batchAction("category")}>批量改分类</button><button className="button secondary" onClick={() => void batchAction("hide")}>批量隐藏</button><button className="button danger" onClick={() => void batchAction("archive")}>批量归档</button></div><div className="batch-list"><label className="batch-all"><input type="checkbox" checked={Boolean(library.length) && selectedIds.length === library.length} onChange={(event) => setSelectedIds(event.target.checked ? library.map((item) => item.id) : [])} /> 全选当前 {library.length} 项</label>{library.slice(0, 150).map((item) => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><strong>{item.title}</strong><small>{item.category} · {item.processingStatus} · {item.markdownPath || "未生成Markdown"}</small></span></label>)}</div></section>
    <section className="panel file-audit-panel"><div className="panel-heading"><div><p className="eyebrow">ORIGINAL FILE AUDIT</p><h2>原文件处理记录</h2></div></div>{uploads.map((file) => <article key={file.id}><span>{file.contentType.includes("pdf") ? "PDF" : "FILE"}</span><div><strong>{file.filename}</strong><small>{file.externalPath || "临时文件区"} · {file.status === "recycle_bin" ? `回收站，预计 ${dateText(file.deleteAfter)} 清理` : file.status}</small></div></article>)}{!uploads.length && <div className="empty-state small">还没有上传记录。</div>}</section>
  </section>;
}
