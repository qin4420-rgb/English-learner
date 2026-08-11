import type { ResourceItem } from "../../types";

export type ResourceActionId =
  | "open"
  | "preview"
  | "read"
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
  if (resource.processingStatus === "review_required") return "review";
  if (["failed", "needs_action", "queued", "waiting", "processing", "running", "paused", "pausing"].includes(resource.processingStatus)) return "processing";
  if (resource.processingStatus === "needs_provider") return "providers";
  if (["ready", "completed"].includes(resource.processingStatus) && resource.resourceType !== "Dictionary") return "read";
  if (resource.markdownObjectKey && readableTypes.has(resource.resourceType)) return "read";
  if (resource.resourceType === "Dictionary") return "open";
  return "preview";
}

export function buildResourceActions(resource: ResourceItem, context: ResourceActionContext): ResourceAction[] {
  const multiple = context.selectionCount > 1;
  const status = resource.processingStatus;
  const actions: ResourceAction[] = [
    { id: "open", label: multiple ? `查看所选 ${context.selectionCount} 项` : "查看详情", icon: "ⓘ", handler: context.onOpen },
    { id: "preview", label: "快速预览", icon: "◫", shortcut: "Space", hidden: multiple, handler: context.onPreview },
    { id: "read", label: "开始 / 继续学习", icon: "↗", hidden: multiple || !context.canStart, handler: context.onRead },
    { id: "favorite", label: resource.isFavorite && !multiple ? "取消收藏" : "收藏", icon: "★", shortcut: "F", handler: context.onFavorite },
    { id: "move", label: "移动到文件夹…", icon: "▣", shortcut: "M", handler: context.onMove },
    { id: "tags", label: "管理标签…", icon: "#", shortcut: "T", handler: context.onTags },
    { id: "review", label: "打开复核工作区", icon: "✓", hidden: multiple || status !== "review_required", handler: context.onReview },
    { id: "processing", label: ["failed", "needs_action"].includes(status) ? "查看问题与处理记录" : "查看处理任务", icon: "↻", shortcut: "R", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action", "queued", "waiting", "running", "paused", "pausing", "processing"].includes(status), handler: context.onProcessing },
    { id: "resume", label: "从断点继续", icon: "▶", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action", "paused"].includes(status), handler: context.onResume },
    { id: "retry", label: "重试失败步骤", icon: "↻", hidden: multiple || !context.hasProcessingJob || !["failed", "needs_action"].includes(status), handler: context.onRetry },
    { id: "providers", label: "打开能力配置", icon: "⚙", hidden: multiple || status !== "needs_provider", handler: context.onProviders },
    { id: "source", label: "打开来源", icon: "↗", hidden: multiple || !/^https?:/i.test(resource.sourceUrl || resource.url), handler: context.onSource },
    { id: "reprocess", label: "重新处理", icon: "⟳", hidden: multiple || !["ready", "completed", "review_required"].includes(status), handler: context.onReprocess },
    { id: "archive", label: multiple ? `归档所选 ${context.selectionCount} 项` : "归档", icon: "⌫", danger: true, handler: context.onArchive },
  ];
  const orders: Record<string, ResourceActionId[]> = {
    review: ["review", "preview", "processing", "source", "move", "tags", "favorite", "reprocess", "archive", "open"],
    problem: ["processing", "resume", "retry", "preview", "source", "move", "tags", "archive", "open"],
    provider: ["providers", "processing", "preview", "source", "move", "tags", "archive", "open"],
    processing: ["processing", "preview", "source", "move", "tags", "favorite", "archive", "open"],
    ready: ["read", "preview", "open", "source", "move", "tags", "favorite", "reprocess", "archive"],
    multiple: ["move", "tags", "favorite", "archive", "open"],
  };
  const key = multiple ? "multiple" : status === "review_required" ? "review" : ["failed", "needs_action"].includes(status) ? "problem" : status === "needs_provider" ? "provider" : ["queued", "waiting", "processing", "running", "paused", "pausing"].includes(status) ? "processing" : "ready";
  const order = orders[key];
  return [...actions].sort((first, second) => order.indexOf(first.id) - order.indexOf(second.id));
}
