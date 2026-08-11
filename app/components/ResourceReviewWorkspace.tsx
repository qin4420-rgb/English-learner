"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ResourceReviewPayload, ReviewBlock } from "../types";

type Props = {
  resourceId: number;
  onClose: () => void;
  onPublished: () => Promise<void>;
  onNotice: (message: string) => void;
};

async function requestReview(resourceId: number, options?: RequestInit) {
  const response = await fetch(`/api/resources/${resourceId}/review`, options);
  const data = await response.json() as ResourceReviewPayload & { error?: string };
  if (!response.ok) {
    const error = new Error(data.error || "复核操作失败") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

function cloneBlocks(blocks: ReviewBlock[]) {
  return blocks.map((block) => ({ ...block }));
}

export default function ResourceReviewWorkspace({ resourceId, onClose, onPublished, onNotice }: Props) {
  const [payload, setPayload] = useState<ResourceReviewPayload | null>(null);
  const [blocks, setBlocks] = useState<ReviewBlock[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    requestReview(resourceId).then((data) => {
      if (!active) return;
      setPayload(data);
      setBlocks(cloneBlocks(data.blocks));
    }).catch((error: Error) => onNotice(error.message));
    return () => { active = false; };
  }, [onNotice, resourceId]);

  const issueBlocks = useMemo(() => new Set((payload?.review.issues || []).map((issue) => issue.blockId).filter(Boolean)), [payload]);
  const errors = payload?.review.issues.filter((issue) => issue.severity === "error") || [];
  const warnings = payload?.review.issues.filter((issue) => issue.severity === "warning") || [];

  function updateBlock(id: string, field: "original" | "translation" | "type", value: string) {
    setBlocks((current) => current.map((block) => block.id === id ? { ...block, [field]: value, manualEdited: field === "original" || field === "translation" ? true : block.manualEdited } : block));
  }

  function moveBlock(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    setBlocks((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }

  function mergeBlock(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    const first = Math.min(index, target);
    const second = Math.max(index, target);
    setBlocks((current) => current.filter((_, blockIndex) => blockIndex !== second).map((block, blockIndex) => blockIndex === first ? {
      ...block,
      original: `${current[first].original}\n\n${current[second].original}`.trim(),
      translation: `${current[first].translation}\n\n${current[second].translation}`.trim(),
      manualEdited: current[first].manualEdited || current[second].manualEdited,
    } : block));
  }

  function splitBlock(index: number) {
    const block = blocks[index];
    const parts = block.original.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    if (parts.length < 2) return onNotice("请先在英文块中用空行分隔要拆开的内容");
    const translations = block.translation.split(/\n{2,}/).map((item) => item.trim());
    setBlocks((current) => current.flatMap((item, blockIndex) => blockIndex !== index ? [item] : parts.map((part, partIndex) => ({
      ...item, id: `${item.id}-${partIndex + 1}`, original: part, translation: translations[partIndex] || "", manualEdited: true,
    }))));
  }

  async function action(name: "save" | "validate" | "translate" | "aiReview" | "publish", extra: Record<string, unknown> = {}) {
    setBusy(name);
    try {
      const data = await requestReview(resourceId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, blocks, ...extra }),
      });
      setPayload(data);
      setBlocks(cloneBlocks(data.blocks));
      if (name === "publish") {
        onNotice("复核稿已发布，阅读器现在会读取这个版本");
        await onPublished();
      } else onNotice(name === "translate" ? "所选段落已局部重译并重新校验" : name === "aiReview" ? "AI审核建议已生成，不会自动改写译文" : name === "validate" ? "自动检查已完成" : "复核草稿已保存");
      return true;
    } catch (error) {
      const typed = error as Error & { status?: number };
      if (name === "publish" && typed.status === 409 && window.confirm(`${typed.message}。是否仍要强制发布？`)) return action("publish", { force: true });
      onNotice(typed.message);
      return false;
    } finally { setBusy(""); }
  }

  function adoptSuggestion(blockId: string, suggestion: string) {
    updateBlock(blockId, "translation", suggestion);
    setPayload((current) => current ? { ...current, review: { ...current.review, aiReviews: { ...current.review.aiReviews, [blockId]: { status: "pass", issues: [], suggestedTranslation: "" } } } } : current);
  }

  if (!payload) return <section className="panel review-loading">正在打开复核草稿…</section>;

  return <section className="review-workspace">
    <header className="review-workspace-header">
      <button className="button secondary" onClick={onClose}>← 返回维护中心</button>
      <div><p className="eyebrow">ARTICLE REVIEW WORKFLOW</p><h1>{payload.resource.title}</h1><p>{payload.resource.sourceName || payload.resource.sourceUrl || "文件导入"} · {blocks.length} 个内容块 · {payload.hasPublished ? "旧发布版仍在线" : "首次导入，尚未发布"}</p></div>
      <div className="review-header-actions"><button onClick={() => void action("validate")} disabled={Boolean(busy)}>自动检查</button><button onClick={() => setPreviewOpen(true)}>阅读预览</button><button onClick={() => void action("save")} disabled={Boolean(busy)}>保存草稿</button><button className="button primary" onClick={() => void action("publish")} disabled={Boolean(busy)}>发布文章</button></div>
    </header>

    <div className="review-status-strip"><strong className={errors.length ? "has-errors" : "ok"}>{errors.length} 个错误</strong><span>{warnings.length} 个警告</span><span>{payload.review.translatedBlocks}/{payload.review.totalBlocks} 已有译文</span><span>{payload.review.manualEditedBlocks.length} 个手工修改块</span></div>

    <aside className="review-source-panel"><div><p className="eyebrow">ORIGINAL SOURCE</p><strong>{payload.resource.sourceName || (payload.resource.sourceUrl ? "网页来源" : "上传文件")}</strong><small>{payload.resource.sourceUrl || payload.resource.url || payload.resource.markdownPath || "原文件入口暂不可用"}</small></div><div><span>类型：{payload.resource.resourceType}</span><span>处理状态：{payload.resource.processingStatus}</span><span>{payload.hasPublished ? "已有Published版本，复核期间继续可读" : "首次导入，发布前不会进入Reader"}</span></div>{payload.resource.sourceUrl && <a className="button secondary" href={payload.resource.sourceUrl} target="_blank" rel="noreferrer">打开原网页</a>}</aside>

    <div className="review-batch-toolbar"><label><input type="checkbox" checked={selectedIds.length === blocks.length && Boolean(blocks.length)} onChange={(event) => setSelectedIds(event.target.checked ? blocks.map((block) => block.id) : [])} /> 全选</label><button onClick={() => void action("translate", { blockIds: selectedIds })} disabled={!selectedIds.length || Boolean(busy)}>重译所选</button><button onClick={() => { const ids = [...issueBlocks] as string[]; setSelectedIds(ids); void action("translate", { blockIds: ids }); }} disabled={!issueBlocks.size || Boolean(busy)}>重译异常块</button><button onClick={() => void action("aiReview", { blockIds: selectedIds.length ? selectedIds : [...issueBlocks] })} disabled={(!selectedIds.length && !issueBlocks.size) || Boolean(busy)}>AI审核异常</button><small>AI只给建议；手工修改过的译文默认不会被重译覆盖。</small></div>

    <div className="review-column-labels"><span>Block / 结构</span><span>English Original</span><span>中文译文</span></div>
    <div className="review-block-list">{blocks.map((block, index) => {
      const issues = payload.review.issues.filter((issue) => issue.blockId === block.id);
      const aiReview = payload.review.aiReviews?.[block.id];
      return <article className={`review-block ${issues.some((issue) => issue.severity === "error") ? "has-error" : issues.length ? "has-warning" : ""}`} key={block.id}>
        <aside><label><input type="checkbox" checked={selectedIds.includes(block.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, block.id])] : current.filter((id) => id !== block.id))} /><strong>{block.id}</strong></label><select value={block.type} onChange={(event) => updateBlock(block.id, "type", event.target.value)}><option value="paragraph">段落</option><option value="h2">H2</option><option value="h3">H3</option><option value="list">列表</option><option value="quote">引用</option><option value="caption">图片说明</option><option value="link">相关链接</option></select><div className="review-block-actions"><button onClick={() => moveBlock(index, -1)} title="上移">↑</button><button onClick={() => moveBlock(index, 1)} title="下移">↓</button><button onClick={() => mergeBlock(index, -1)} title="与上一块合并">⇡并</button><button onClick={() => mergeBlock(index, 1)} title="与下一块合并">⇣并</button><button onClick={() => splitBlock(index)} title="按空行拆分">拆</button><button onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))} title="删除">删</button><button onClick={() => void action("aiReview", { blockIds: [block.id] })} disabled={Boolean(busy)} title="AI只审核此块">AI查</button></div></aside>
        <textarea value={block.original} onChange={(event) => updateBlock(block.id, "original", event.target.value)} aria-label={`${block.id} 英文原文`} />
        <div className="review-translation-cell"><textarea value={block.translation} onChange={(event) => updateBlock(block.id, "translation", event.target.value)} aria-label={`${block.id} 中文译文`} />{block.manualEdited && <em>手工修改</em>}<button onClick={() => void action("translate", { blockIds: [block.id] })} disabled={Boolean(busy) || block.manualEdited} title={block.manualEdited ? "手工译文受保护；请先另存或使用批量覆盖确认" : "重译此块"}>局部重译</button></div>
        {issues.length > 0 && <div className="review-block-issues">{issues.map((issue) => <span className={issue.severity} key={issue.id}>{issue.message}</span>)}</div>}
        {aiReview && <div className="review-ai-suggestion"><strong>AI审核建议</strong>{aiReview.issues.map((issue) => <span key={issue}>{issue}</span>)}{aiReview.suggestedTranslation && <p>{aiReview.suggestedTranslation}</p>}<div>{aiReview.suggestedTranslation && <button onClick={() => adoptSuggestion(block.id, aiReview.suggestedTranslation)}>采用建议</button>}<button onClick={() => setPayload((current) => current ? { ...current, review: { ...current.review, aiReviews: Object.fromEntries(Object.entries(current.review.aiReviews || {}).filter(([id]) => id !== block.id)) } } : current)}>忽略</button></div></div>}
      </article>;
    })}</div>

    {previewOpen && <div className="review-preview-backdrop"><section className="review-preview" role="dialog" aria-modal="true" aria-label="文章阅读预览"><header><div><p className="eyebrow">READER PREVIEW</p><h2>{payload.resource.title}</h2></div><button onClick={() => setPreviewOpen(false)} aria-label="关闭预览">×</button></header>{blocks.map((block) => <section key={block.id}><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.original}</ReactMarkdown>{block.translation && <div className="review-preview-translation"><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.translation}</ReactMarkdown></div>}</section>)}</section></div>}
  </section>;
}
