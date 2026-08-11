export const PIPELINE_STEPS = [
  { key: "original", label: "原始资料", order: 10 },
  { key: "extract", label: "文字提取", order: 20 },
  { key: "structure", label: "正文结构化", order: 30 },
  { key: "blockify", label: "Block 生成", order: 40 },
  { key: "enrich", label: "AI 内容整理", order: 50 },
  { key: "translate", label: "中文翻译", order: 60 },
  { key: "qa", label: "自动 QA", order: 70 },
  { key: "review", label: "人工复核", order: 80 },
  { key: "publish", label: "发布", order: 90 },
  { key: "sync", label: "OneDrive 同步", order: 100 },
];

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "pausing"]);

export function normalizeJobStatus(status) {
  return ({ waiting: "queued", processing: "running", complete: "completed" })[status] || status || "queued";
}

export function createPipelineSteps(resourceType = "Article", startAt = "original") {
  const startIndex = Math.max(0, PIPELINE_STEPS.findIndex((step) => step.key === startAt));
  return PIPELINE_STEPS.map((step, index) => ({
    ...step,
    status: index < startIndex ? "skipped" : "pending",
    attemptCount: 0,
    progressCurrent: 0,
    progressTotal: 0,
    resourceType,
  }));
}

export function nextRunnableStep(steps) {
  return [...steps]
    .sort((a, b) => Number(a.sortOrder ?? a.order) - Number(b.sortOrder ?? b.order))
    .find((step) => !["completed", "skipped"].includes(step.status));
}

export function resumeTransition(job, steps) {
  const next = nextRunnableStep(steps);
  return { ...job, status: next ? "queued" : "completed", pauseRequested: false, currentStep: next?.stepKey || next?.key || "" };
}

export function pauseTransition(job) {
  if (!["queued", "running", "pausing"].includes(normalizeJobStatus(job.status))) return job;
  return { ...job, status: job.status === "running" ? "pausing" : "paused", pauseRequested: true };
}

export function retryStepTransition(steps, stepKey) {
  return steps.map((step) => (step.stepKey || step.key) === stepKey
    ? { ...step, status: "pending", errorCode: "", errorMessage: "", errorDetailJson: "", completedAt: "" }
    : step);
}

export function detectTruncatedJson(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const opens = (text.match(/[[{]/g) || []).length;
  const closes = (text.match(/[\]}]/g) || []).length;
  return opens > closes || /unterminated|string.*position|unexpected end/i.test(text);
}

export function safeParseAIJson(value) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error("AI 没有返回内容"), { code: "AI_RESPONSE_EMPTY" });
  try { return JSON.parse(text); }
  catch (error) {
    const code = detectTruncatedJson(`${text}\n${error instanceof Error ? error.message : ""}`)
      ? "AI_RESPONSE_TRUNCATED"
      : "AI_RESPONSE_INVALID_JSON";
    throw Object.assign(new Error(code === "AI_RESPONSE_TRUNCATED" ? "AI 返回内容不完整" : "AI 返回格式无效"), {
      code,
      technicalMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export function mapProcessingError(error, context = {}) {
  const technicalMessage = error instanceof Error ? error.message : String(error || "未知错误");
  const explicitCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  let code = explicitCode || "UNKNOWN_PROCESSING_ERROR";
  if (!explicitCode) {
    if (/\b403\b|拒绝自动|access denied/i.test(technicalMessage)) code = "SOURCE_HTTP_403";
    else if (/\b404\b|not found/i.test(technicalMessage)) code = "SOURCE_HTTP_404";
    else if (/OCR.*未配置|扫描PDF/i.test(technicalMessage)) code = "OCR_REQUIRED";
    else if (/STT.*未配置/i.test(technicalMessage)) code = "STT_REQUIRED";
    else if (/PDF.*没有可提取|PDF.*文字.*空/i.test(technicalMessage)) code = "PDF_TEXT_EMPTY";
    else if (/DeepSeek|AI.*请求|Provider请求/i.test(technicalMessage)) code = "AI_HTTP_ERROR";
    else if (/OneDrive/i.test(technicalMessage)) code = "ONEDRIVE_SYNC_ERROR";
    else if (/R2|存储|object/i.test(technicalMessage)) code = "STORAGE_ERROR";
  }
  const catalog = {
    SOURCE_HTTP_403: ["来源网站拒绝自动读取。", true, ["打开原网页", "粘贴正文", "上传文件", "重试读取"], "needs_action"],
    SOURCE_HTTP_404: ["来源网页不存在或已经移动。", false, ["检查链接", "粘贴正文", "上传文件"], "needs_action"],
    SOURCE_BLOCKED: ["来源网站阻止了自动读取。", true, ["打开原网页", "粘贴正文", "上传文件"], "needs_action"],
    SOURCE_EXTRACTION_FAILED: ["没有成功提取到可用正文。", true, ["粘贴正文", "上传文件", "重试读取"], "needs_action"],
    PDF_TEXT_EMPTY: ["PDF 没有可直接提取的文字。", false, ["配置 OCR", "上传可搜索 PDF"], "needs_provider"],
    OCR_REQUIRED: ["该资料需要 OCR，但尚未配置 OCR Provider。", false, ["去能力配置", "上传可复制文字版本"], "needs_provider"],
    STT_REQUIRED: ["该媒体需要 STT，但尚未配置 STT Provider。", false, ["去能力配置", "上传字幕文件"], "needs_provider"],
    AI_HTTP_ERROR: ["AI 服务请求失败，本步骤尚未完成。", true, ["稍后重试本步骤", "检查 DeepSeek 配置"], "failed"],
    AI_TIMEOUT: ["AI 服务响应超时，本步骤尚未完成。", true, ["重试本步骤", "缩小单次处理量"], "failed"],
    AI_RESPONSE_EMPTY: ["DeepSeek 没有返回内容。", true, ["重试本步骤", "检查 DeepSeek 状态"], "failed"],
    AI_RESPONSE_INVALID_JSON: ["DeepSeek 返回的格式无法识别，本批没有写入。", true, ["只重试本步骤", "查看技术详情"], "failed"],
    AI_RESPONSE_TRUNCATED: ["DeepSeek 返回内容不完整，本批翻译未完成。", true, ["只重试本步骤", "减少批量大小"], "failed"],
    TRANSLATION_PARTIAL: ["部分段落翻译失败，已完成译文不会丢失。", true, ["从断点继续", "只重试翻译步骤"], "failed"],
    QA_FAILED: ["自动质量检查发现必须处理的问题。", true, ["打开复核", "修正问题后重新验证"], "needs_action"],
    STORAGE_ERROR: ["处理中间结果保存失败。", true, ["重试本步骤", "稍后再试"], "failed"],
    ONEDRIVE_SYNC_ERROR: ["OneDrive 同步失败，R2 中的内容仍然保留。", true, ["重新连接 OneDrive", "重试同步"], "needs_action"],
    UNKNOWN_PROCESSING_ERROR: ["资料处理遇到未识别的问题。", true, ["从断点继续", "查看技术详情"], "failed"],
  };
  const [userMessage, retryable, suggestedActions, status] = catalog[code] || catalog.UNKNOWN_PROCESSING_ERROR;
  return {
    code, userMessage, technicalMessage,
    retryable, suggestedActions, status,
    detail: { ...context, ...(error && typeof error === "object" && "technicalMessage" in error ? { parseError: error.technicalMessage } : {}) },
  };
}
