import type { ResourceItem } from "../../types";
import { parseResourceMetadata } from "../../resource-model";

export type ResourceActionId =
  | "open"
  | "preview"
  | "read"
  | "play"
  | "intensive"
  | "transcript"
  | "subtitle"
  | "favorite"
  | "move"
  | "tags"
  | "review"
  | "processing"
  | "resume"
  | "retry"
  | "reprocess"
  | "providers"
  | "source"
  | "archive";

export type ResourceAction = {
  id: ResourceActionId;
  label: string;
  icon: string;
  shortcut?: string;
  danger?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  handler: () => void | Promise<void>;
};

export type ResourceActionContext = {
  selectionCount: number;
  hasProcessingJob: boolean;
  canStart: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onRead: () => void;
  onPlay: () => void;
  onIntensive: () => void | Promise<void>;
  onTranscript: () => void;
  onSubtitle: () => void;
  onFavorite: () => void | Promise<void>;
  onMove: () => void;
  onTags: () => void;
  onReview: () => void;
  onProcessing: () => void;
  onResume: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onReprocess: () => void | Promise<void>;
  onProviders: () => void;
  onSource: () => void;
  onArchive: () => void | Promise<void>;
};

const readableTypes = new Set(["Article", "PDF", "Image", "Text", "Subtitle"]);

export function resourceDefaultAction(resource: ResourceItem): ResourceActionId {
  const metadata = parseResourceMetadata(resource.metadataJson, resource.resourceType);
  const isMedia = ["Audio", "Video", "Podcast"].includes(resource.resourceType);
  if (resource.processingStatus === "review_required") return "review";
  if (["failed", "needs_action", "queued", "waiting", "processing", "running", "paused", "pausing"].includes(resource.processingStatus)) return "processing";
  if (resource.processingStatus === "needs_provider") return "providers";
  if (isMedia && ["ready", "completed"].includes(resource.processingStatus) && metadata.media?.intensiveStatus !== "ready") return "play";
  if (["ready", "completed"].includes(resource.processingStatus) && resource.resourceType !== "Dictionary") return "read";
  if (resource.markdownObjectKey && readableTypes.has(resource.resourceType)) return "read";
  if (resource.resourceType === "Dictionary") return "open";
  return "preview";
}

export function buildResourceActions(resource: ResourceItem, context: ResourceActionContext): ResourceAction[] {
  const multiple = context.selectionCount > 1;
  const status = resource.processingStatus;
  const metadata = parseResourceMetadata(resource.metadataJson, resource.resourceType);
  const isMedia = ["Audio", "Video", "Podcast"].includes(resource.resourceType);
  const intensiveStatus = String(metadata.media?.intensiveStatus || metadata.podcast?.intensiveStatus || "not_requested");
  const actions: ResourceAction[] = [
    { id: "open", label: multiple ? `查看所选 ${context.selectionCount} 项` : "查看详情", icon: "ⓘ", handler: context.onOpen },
    { id: "preview", label: "快速预览", icon: "◫", shortcut: "Space", hidden: multiple, handler: context.onPreview },
    { id: "read", label: "开始 / 继续学习", icon: "↗", hidden: multiple || !context.canStart, handler: context.onRead },
    { id: "play", label: resource.resourceType === "Podcast" ? "Apple / 来源播放" : "普通播放", icon: "▶", hidden: multiple || !isMedia, handler: context.onPlay },
    { id: "intensive", label: "加入精听", icon: "＋", hidden: multiple || !isMedia || !["not_requested", "unavailable", "failed"].includes(intensiveStatus), handler: context.onIntensive },
    { id: "transcript", label: "查看 Transcript", icon: "CC", hidden: multiple || !isMedia || !metadata.mediaSegments.length, handler: context.onTranscript },
    { id: "subtitle", label: "添加字幕", icon: "+CC", hidden: multiple || !isMedia, handler: context.onSubtitle },
    { id: "favorite", label: resource.isFavorite && !multiple ? "取消收藏" : "收藏", icon: "★", shortcut: "F", handler: context.onFavorite },
    { id: "move", label: "移动到文件夹…", icon: "▣", shortcut: "M", handler: context.onMove },
    { id: "tags", label: "管理标签…", icon: "#", shortcut: "T", handler: context.onTags },
    { id: "review", label: "打开复核工作区", icon: "✓", hidden: multiple || status !== "review_required", handler: context.onReview },
    { id: "processing", label: ["failed", "needs_action"].includes(status) ? "查看问题与处理记录" : "查看处理任务", icon: "↻", shortcut: "R", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action", "queued", "waiting", "running", "paused", "pausing", "processing"].includes(status), handler: context.onProcessing },
    { id: "resume", label: "从断点继续", icon: "▶", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action", "paused"].includes(status), handler: context.onResume },
    { id: "retry", label: "重试失败步骤", icon: "↻", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action"].includes(status), handler: context.onRetry },
    { id: "providers", label: "打开能力配置", icon: "⚙", hidden: multiple || status !== "needs_provider", handler: context.onProviders },
    { id: "source", label: "打开来源", icon: "↗", hidden: multiple || !/^https?:/i.test(resource.sourceUrl || resource.url), handler: context.onSource },
    { id: "reprocess", label: isMedia ? "重新处理文字稿" : "重新处理", icon: "⟳", hidden: multiple || !["ready", "completed", "review_required"].includes(status), handler: context.onReprocess },
    { id: "archive", label: multiple ? `归档所选 ${context.selectionCount} 项` : "归档", icon: "⌫", danger: true, handler: context.onArchive },
  ];
  const orders: Record<string, ResourceActionId[]> = {
    review: ["review", "preview", "play", "processing", "source", "move", "tags", "favorite", "reprocess", "subtitle", "archive", "open"],
    problem: ["play", "processing", "resume", "retry", "subtitle", "preview", "source", "move", "tags", "archive", "open"],
    provider: ["play", "providers", "processing", "subtitle", "preview", "source", "move", "tags", "archive", "open"],
    processing: ["play", "processing", "preview", "source", "move", "tags", "favorite", "archive", "open"],
    ready: ["read", "play", "intensive", "transcript", "preview", "open", "source", "subtitle", "move", "tags", "favorite", "reprocess", "archive"],
    multiple: ["move", "tags", "favorite", "archive", "open"],
  };
  const key = multiple ? "multiple" : status === "review_required" ? "review" : ["failed", "needs_action"].includes(status) ? "problem" : status === "needs_provider" ? "provider" : ["queued", "waiting", "processing", "running", "paused", "pausing"].includes(status) ? "processing" : "ready";
  const order = orders[key];
  return [...actions].sort((first, second) => order.indexOf(first.id) - order.indexOf(second.id));
}
