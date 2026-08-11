"use client";

/* Dynamic source names are the visible text for their wrapped controls. */
/* eslint-disable jsx-a11y/label-has-associated-control */
/* The modal backdrop only offers an optional pointer shortcut; the close button remains the accessible control. */
/* eslint-disable jsx-a11y/no-static-element-interactions */

import { FormEvent, useEffect, useMemo, useState } from "react";
import ResourceReviewWorkspace from "./components/ResourceReviewWorkspace";
import type { DictionarySourceItem, OneDriveStatus, ProcessingJob, ProcessingJobStep, ProviderStatus, ResourceItem, UploadItem } from "./types";

type Props = { oneDrive: OneDriveStatus | null; aiConfigured: boolean; providers: ProviderStatus[]; jobs: ProcessingJob[]; uploads: UploadItem[]; resources: ResourceItem[]; onReload: () => Promise<void>; onNotice: (message: string) => void; onExport: () => void };
type CenterSection = "processing" | "dictionaries" | "vocabulary" | "providers" | "data";
type ProcessingTab = "queue" | "review" | "history";
type AddMode = "file" | "url" | "paste";

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

const statusLabel: Record<string, string> = { queued: "排队中", running: "处理中", pausing: "等待暂停", paused: "已暂停", needs_action: "需要处理", needs_provider: "缺少能力", review_required: "待复核", failed: "失败", completed: "已完成", cancelled: "已取消" };
const stepIcon: Record<string, string> = { completed: "✓", skipped: "−", running: "…", failed: "×", needs_action: "!", needs_provider: "!", paused: "Ⅱ", pending: "○" };

function currentProgress(job: ProcessingJob) {
  const step = job.steps.find((item) => item.stepKey === job.currentStep);
  return step?.progressTotal ? `${step.progressCurrent} / ${step.progressTotal} ${["Audio", "Video"].includes(String(step.detail.resourceType || "")) ? "Segments" : "Blocks"}` : `${job.progress}%`;
}

function reviewInfo(resource: ResourceItem) {
  try {
    const metadata = JSON.parse(resource.metadataJson || "{}") as { review?: { issues?: { severity?: string }[]; translatedBlocks?: number; totalBlocks?: number } };
    const issues = metadata.review?.issues || [];
    return { errors: issues.filter((issue) => issue.severity === "error").length, warnings: issues.filter((issue) => issue.severity === "warning").length, translated: metadata.review?.translatedBlocks || 0, total: metadata.review?.totalBlocks || 0 };
  } catch { return { errors: 0, warnings: 0, translated: 0, total: 0 }; }
}

export default function MaintenanceCenter({ oneDrive, aiConfigured, providers, jobs, uploads, resources, onReload, onNotice, onExport }: Props) {
  const [section, setSection] = useState<CenterSection>("processing");
  const [processingTab, setProcessingTab] = useState<ProcessingTab>("queue");
  const [jobList, setJobList] = useState(jobs);
  const [selectedJobId, setSelectedJobId] = useState(0);
  const [selectedStepKey, setSelectedStepKey] = useState("");
  const [reviewResourceId, setReviewResourceId] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("file");
  const [busy, setBusy] = useState(false);
  const [runnerVersion, setRunnerVersion] = useState(0);
  const [dictionaries, setDictionaries] = useState<DictionarySourceItem[]>([]);
  const [dictionaryTest, setDictionaryTest] = useState("");
  const [dictionaryResult, setDictionaryResult] = useState("");
  const library = resources.filter((item) => item.collection === "library");
  const reviewResources = useMemo(() => library.filter((item) => item.processingStatus === "review_required"), [library]);
  const selectedJob = jobList.find((job) => job.id === selectedJobId) || null;
  const selectedStep = selectedJob?.steps.find((step) => step.stepKey === selectedStepKey) || selectedJob?.steps.find((step) => step.stepKey === selectedJob.currentStep) || null;

  useEffect(() => { void jsonRequest<{ sources: DictionarySourceItem[] }>("/api/dictionaries").then((data) => setDictionaries(data.sources)).catch((error: Error) => onNotice(error.message)); }, [onNotice]);

  useEffect(() => {
    if (section !== "processing") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        let data = await jsonRequest<{ jobs: ProcessingJob[] }>("/api/processing");
        if (stopped) return;
        setJobList(data.jobs);
        const runnable = data.jobs.find((job) => ["queued", "running", "pausing"].includes(job.status) && !job.legacy);
        if (!runnable) return;
        const result = await jsonRequest<{ status: string }>("/api/processing/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: runnable.id }) });
        data = await jsonRequest<{ jobs: ProcessingJob[] }>("/api/processing");
        if (stopped) return;
        setJobList(data.jobs);
        if (result.status === "review_required") await onReload();
        if (data.jobs.some((job) => ["queued", "running", "pausing"].includes(job.status))) timer = setTimeout(tick, 2400);
      } catch (error) { if (!stopped) onNotice((error as Error).message); }
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [section, runnerVersion, onReload, onNotice]);

  const counts = useMemo(() => ({
    running: jobList.filter((job) => ["queued", "running", "pausing"].includes(job.status)).length,
    paused: jobList.filter((job) => job.status === "paused").length,
    action: jobList.filter((job) => ["needs_action", "needs_provider"].includes(job.status)).length,
    review: jobList.filter((job) => job.status === "review_required").length,
    failed: jobList.filter((job) => job.status === "failed").length,
  }), [jobList]);

  async function refreshJobs() {
    const data = await jsonRequest<{ jobs: ProcessingJob[] }>("/api/processing"); setJobList(data.jobs); setRunnerVersion((value) => value + 1);
  }

  async function jobAction(job: ProcessingJob, action: string, stepKey?: string) {
    if (action === "restart" && !window.confirm("将建立一个全新的处理任务，并保留当前任务历史。确定从头重新处理吗？")) return;
    try {
      await jsonRequest("/api/processing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, action, stepKey }) });
      await refreshJobs(); onNotice(action === "pause" ? "已请求在安全点暂停" : action === "cancel" ? "任务已取消，原始资料仍然保留" : "任务状态已更新");
    } catch (error) { onNotice((error as Error).message); }
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      if (addMode === "file") {
        const file = form.get("file"); if (!(file instanceof File) || !file.size) throw new Error("请选择文件");
        const body = new FormData(); body.append("files", file); body.append("tags", String(form.get("category") || "离线文章阅读"));
        await jsonRequest("/api/resources/import", { method: "POST", body });
      } else {
        const sourceUrl = String(form.get("sourceUrl") || "").trim();
        const pastedText = String(form.get("pastedText") || "").trim();
        await jsonRequest("/api/processing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputType: addMode, sourceUrl, pastedText, title: String(form.get("title") || ""), category: String(form.get("category") || "待整理") }) });
      }
      setAddOpen(false); await onReload(); await refreshJobs(); onNotice("资源与处理任务已经建立，可以关闭页面后稍后继续。");
    } catch (error) { onNotice((error as Error).message); } finally { setBusy(false); }
  }

  async function updateDictionary(id: number, change: Record<string, unknown>) {
    await jsonRequest("/api/dictionaries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...change }) });
    const data = await jsonRequest<{ sources: DictionarySourceItem[] }>("/api/dictionaries"); setDictionaries(data.sources);
  }

  if (reviewResourceId) return <ResourceReviewWorkspace resourceId={reviewResourceId} onClose={() => setReviewResourceId(0)} onPublished={async () => { await onReload(); await refreshJobs(); setReviewResourceId(0); }} onNotice={onNotice} />;

  return <section className="maintenance-workspace">
    <header className="maintenance-header"><div><p className="eyebrow">MAINTENANCE CENTER 2.0</p><h1>维护中心</h1><p>资料处理已经任务化；每一步都有记录，失败后可从断点继续。</p></div><button className="button secondary" onClick={onExport}>导出索引备份</button></header>
    <div className="maintenance-shell">
      <nav className="maintenance-secondary-nav" aria-label="维护中心二级导航">{([
        ["processing", "▦", "资源处理"], ["dictionaries", "Aa", "词典管理"], ["vocabulary", "W", "单词数据"], ["providers", "⚙", "能力配置"], ["data", "↥", "数据与备份"],
      ] as const).map(([id, icon, label]) => <button className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}><span>{icon}</span>{label}</button>)}</nav>

      <main className="maintenance-main">
        {section === "processing" && <>
          <div className="processing-topbar"><div><h2>资源处理</h2><p>Runner 每次只推进一个安全工作单元，已完成内容实时保存。</p></div><button className="button primary" onClick={() => setAddOpen(true)}>＋ 添加资料</button></div>
          <div className="processing-overview">{[["处理中", counts.running], ["已暂停", counts.paused], ["需要处理", counts.action], ["待复核", counts.review], ["失败", counts.failed]].map(([label, count]) => <article key={label}><strong>{count}</strong><span>{label}</span></article>)}</div>
          <nav className="processing-subtabs">{(["queue", "review", "history"] as const).map((id) => <button className={processingTab === id ? "active" : ""} key={id} onClick={() => { setProcessingTab(id); setSelectedJobId(0); }}>{id === "queue" ? "任务队列" : id === "review" ? `待复核 ${reviewResources.length}` : "历史记录"}</button>)}</nav>

          {processingTab === "review" ? <div className="review-resource-list">{reviewResources.map((resource) => { const info = reviewInfo(resource); return <article key={resource.id}><div><strong>{resource.title}</strong><small>{info.translated}/{info.total} 译文块 · {info.errors} 错误 · {info.warnings} 警告</small></div><button className="button primary" onClick={() => setReviewResourceId(resource.id)}>打开复核</button></article>; })}{!reviewResources.length && <div className="empty-state">当前没有待复核文章。</div>}</div> : selectedJob ? <JobDetail job={selectedJob} selectedStep={selectedStep} onSelectStep={setSelectedStepKey} onBack={() => setSelectedJobId(0)} onAction={jobAction} onReview={(id) => setReviewResourceId(id)} onProviders={() => setSection("providers")} /> : <div className="processing-job-grid">{jobList.filter((job) => processingTab === "queue" ? !["completed", "cancelled"].includes(job.status) : ["completed", "cancelled", "failed", "review_required"].includes(job.status)).map((job) => <JobCard key={job.id} job={job} onDetail={() => { setSelectedJobId(job.id); setSelectedStepKey(job.currentStep); }} onAction={jobAction} onReview={(id) => setReviewResourceId(id)} onProviders={() => setSection("providers")} />)}{!jobList.length && <div className="empty-state">还没有处理任务。点击“添加资料”开始。</div>}</div>}
        </>}

        {section === "dictionaries" && <section className="panel dictionary-manager"><div className="panel-heading"><div><p className="eyebrow">DICTIONARIES</p><h2>词典管理</h2><p>维护本地词典顺序并测试实际查词结果。</p></div></div><div className="dictionary-source-list">{dictionaries.map((source) => <article key={source.id}><label><input type="checkbox" checked={source.enabled} onChange={(event) => void updateDictionary(source.id, { enabled: event.target.checked })} /><span><strong>{source.name}</strong><small>{source.entryCount} 条词目</small></span></label><div><button onClick={() => void updateDictionary(source.id, { direction: "up" })}>↑</button><button onClick={() => void updateDictionary(source.id, { direction: "down" })}>↓</button></div></article>)}</div><form className="dictionary-test" onSubmit={(event) => { event.preventDefault(); void jsonRequest<{ dictionaryDefinition: string; dictionarySource?: string }>("/api/vocabulary/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: dictionaryTest }) }).then((result) => setDictionaryResult(`${result.dictionarySource || "基础词典"}：${result.dictionaryDefinition}`)).catch((error: Error) => onNotice(error.message)); }}><input value={dictionaryTest} onChange={(event) => setDictionaryTest(event.target.value)} placeholder="输入英文单词测试" /><button className="button secondary">测试</button></form>{dictionaryResult && <p className="dictionary-test-result">{dictionaryResult}</p>}</section>}

        {section === "vocabulary" && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">VOCABULARY DATA</p><h2>单词数据</h2><p>本区保留给词表导入、词典映射与 FSRS 数据维护；本轮没有改动背单词算法。</p></div></div><div className="empty-state small">可继续通过资源导入 WordList；已有单词与复习记录保持不变。</div></section>}

        {section === "providers" && <><div className="system-status-grid"><article className={`panel system-card ${oneDrive?.connected ? "connected" : ""}`}><div className="system-card-icon">☁</div><div><span className="status-label">主要数据中心</span><h2>个人版 OneDrive</h2><p>{oneDrive?.connected ? `已连接：${oneDrive.accountLabel}` : "等待连接或授权"}</p><small>{oneDrive?.appFolder || "English Room 应用目录"}</small></div></article><article className={`panel system-card ${aiConfigured ? "connected" : ""}`}><div className="system-card-icon">AI</div><div><span className="status-label">内容整理引擎</span><h2>DeepSeek API</h2><p>{aiConfigured ? "已配置，可断点翻译和审核" : "尚未配置"}</p></div></article></div><section className="panel provider-status-panel"><div className="panel-heading"><div><p className="eyebrow">PROVIDER STATUS</p><h2>能力接口状态</h2></div></div><div className="provider-status-list">{providers.map((provider) => <article className={provider.configured ? "configured" : ""} key={provider.id}><span>{provider.id.toUpperCase().slice(0, 3)}</span><div><strong>{provider.label}</strong><small>{provider.provider}</small></div><em>{provider.configured ? "已配置" : provider.id === "tts" ? "浏览器回退" : "未配置"}</em></article>)}</div></section></>}

        {section === "data" && <><section className="panel"><div className="panel-heading"><div><p className="eyebrow">DATA & BACKUP</p><h2>数据与备份</h2><p>失败、取消和暂停不会删除 Resource 或原始资料。</p></div><button className="button secondary" onClick={onExport}>导出索引</button></div></section><section className="panel file-audit-panel"><div className="panel-heading"><div><h2>原文件记录</h2></div></div>{uploads.map((file) => <article key={file.id}><span>{file.contentType.includes("pdf") ? "PDF" : "FILE"}</span><div><strong>{file.filename}</strong><small>{file.externalPath || "R2 原始文件区"} · {file.status}</small></div></article>)}</section></>}
      </main>
    </div>

    {addOpen && <div className="processing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}><form className="processing-modal" onSubmit={addResource}><header><div><p className="eyebrow">NEW RESOURCE</p><h2>添加资料</h2></div><button type="button" onClick={() => setAddOpen(false)} aria-label="关闭">×</button></header><nav>{(["file", "url", "paste"] as const).map((mode) => <button type="button" className={addMode === mode ? "active" : ""} key={mode} onClick={() => setAddMode(mode)}>{mode === "file" ? "文件" : mode === "url" ? "网页链接" : "粘贴正文"}</button>)}</nav>{addMode === "file" && <label className="drop-zone"><input name="file" type="file" required /><span>选择文件</span><small>原文件保留；处理任务会立即建立</small></label>}{addMode === "url" && <label><span>文章网址</span><input name="sourceUrl" type="url" required placeholder="https://…" /></label>}{addMode === "paste" && <><label><span>文章标题</span><input name="title" placeholder="可选；默认使用正文第一行" /></label><label><span>英文正文</span><textarea name="pastedText" required rows={12} placeholder="适用于403网站、付费墙或已经复制好的文章…" /></label></>}<label><span>保存分类</span><input name="category" defaultValue={addMode === "file" ? "离线文章阅读" : "待整理"} /></label><footer><button type="button" className="button secondary" onClick={() => setAddOpen(false)}>取消</button><button className="button primary" disabled={busy}>{busy ? "正在建立任务…" : "建立资源与任务"}</button></footer></form></div>}
  </section>;
}

function JobCard({ job, onDetail, onAction, onReview, onProviders }: { job: ProcessingJob; onDetail: () => void; onAction: (job: ProcessingJob, action: string, stepKey?: string) => Promise<void>; onReview: (id: number) => void; onProviders: () => void }) {
  return <article className={`processing-job-card ${job.status}`}><header><span className="job-type">{job.inputType.toUpperCase()}</span><em>{statusLabel[job.status] || job.status}</em></header><h3>{job.sourceName || `资源 #${job.resultResourceId}`}</h3><dl><div><dt>当前步骤</dt><dd>{job.legacy ? "旧版处理记录" : job.steps.find((step) => step.stepKey === job.currentStep)?.stepLabel || job.stage}</dd></div><div><dt>真实进度</dt><dd>{currentProgress(job)}</dd></div><div><dt>最后成功</dt><dd>{job.steps.find((step) => step.stepKey === job.lastSuccessfulStep)?.stepLabel || "尚无"}</dd></div></dl>{job.errorMessage && <p className="job-card-error">{job.errorMessage}</p>}<div className="job-card-actions">{["running", "queued"].includes(job.status) && <button onClick={() => void onAction(job, "pause")}>暂停</button>}{job.status === "pausing" && <span>等待安全暂停…</span>}{job.status === "paused" && <><button onClick={() => void onAction(job, "resume")}>继续</button><button onClick={() => void onAction(job, "cancel")}>取消</button></>}{["failed", "needs_action"].includes(job.status) && !job.legacy && <><button onClick={() => void onAction(job, "resume_from_failure", job.currentStep)}>从断点继续</button><button onClick={() => void onAction(job, "retry_step", job.currentStep)}>重试本步骤</button></>}{job.status === "needs_provider" && <button onClick={onProviders}>去能力配置</button>}{job.status === "review_required" && job.resultResourceId && <button onClick={() => onReview(job.resultResourceId!)}>打开复核</button>}{job.status === "completed" && job.resultResourceId && <button onClick={() => { window.location.hash = "library"; }}>打开资源</button>}<button onClick={onDetail}>详情</button></div></article>;
}

function JobDetail({ job, selectedStep, onSelectStep, onBack, onAction, onReview, onProviders }: { job: ProcessingJob; selectedStep: ProcessingJobStep | null; onSelectStep: (key: string) => void; onBack: () => void; onAction: (job: ProcessingJob, action: string, stepKey?: string) => Promise<void>; onReview: (id: number) => void; onProviders: () => void }) {
  const technical = selectedStep?.errorDetail.technicalMessage || job.errorDetail.technicalMessage;
  return <section className="job-detail-workspace"><header><button className="button secondary" onClick={onBack}>← 返回任务</button><div><p className="eyebrow">JOB #{job.id}</p><h2>{job.sourceName}</h2><p>{statusLabel[job.status] || job.status} · {currentProgress(job)}</p></div><div className="job-detail-actions"><button onClick={() => void onAction(job, "restart")}>从头重新处理</button>{job.status === "paused" && <button onClick={() => void onAction(job, "resume")}>继续</button>}{job.status === "failed" && <button onClick={() => void onAction(job, "retry_step", job.currentStep)}>重试本步骤</button>}{job.status === "review_required" && job.resultResourceId && <button onClick={() => onReview(job.resultResourceId!)}>打开复核</button>}{job.status === "needs_provider" && <button onClick={onProviders}>去能力配置</button>}</div></header>{job.legacy ? <div className="legacy-job-note"><strong>旧版处理记录</strong><p>这个任务创建于 Processing 2.0 以前，没有可恢复的 Step Checkpoint。原始 Resource 仍在，可以选择“从头重新处理”建立新任务。</p></div> : <div className="job-detail-grid"><aside className="step-timeline">{job.steps.map((step) => <button className={`${step.status} ${selectedStep?.stepKey === step.stepKey ? "active" : ""}`} key={step.stepKey} onClick={() => onSelectStep(step.stepKey)}><span>{stepIcon[step.status] || "○"}</span><div><strong>{step.stepLabel}</strong><small>{step.progressTotal ? `${step.progressCurrent}/${step.progressTotal}` : statusLabel[step.status] || step.status}</small></div></button>)}</aside><article className="step-inspector">{selectedStep ? <><div className="step-inspector-title"><div><p className="eyebrow">{selectedStep.stepKey}</p><h3>{selectedStep.stepLabel}</h3></div><span className={selectedStep.status}>{statusLabel[selectedStep.status] || selectedStep.status}</span></div><dl><div><dt>尝试次数</dt><dd>{selectedStep.attemptCount}</dd></div><div><dt>开始时间</dt><dd>{dateText(selectedStep.startedAt)}</dd></div><div><dt>完成时间</dt><dd>{dateText(selectedStep.completedAt)}</dd></div><div><dt>Checkpoint</dt><dd>{selectedStep.outputRef ? "已保存" : "尚未生成"}</dd></div></dl>{(selectedStep.errorMessage || job.errorMessage) && <section className="processing-error-panel"><h4>{selectedStep.errorMessage || job.errorMessage}</h4><p>影响：{selectedStep.progressTotal ? `${selectedStep.progressCurrent}/${selectedStep.progressTotal} 已完成并保留。` : "之前已完成步骤和原始资料不会丢失。"}</p><div>{job.suggestedActions.map((action) => <span key={action}>{action}</span>)}</div>{technical && <details><summary>技术详情</summary><pre>{String(technical)}</pre></details>}</section>}<details className="step-output-detail"><summary>步骤输出与详细数据</summary><pre>{JSON.stringify({ outputRef: selectedStep.outputRef, detail: selectedStep.detail, error: selectedStep.errorDetail }, null, 2)}</pre></details></> : <div className="empty-state">选择一个步骤查看详情。</div>}</article></div>}</section>;
}
