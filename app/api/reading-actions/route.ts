import { getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";

type ReadingAction = "explain" | "translate";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: ReadingAction; text?: string; context?: string };
    const action = body.action;
    const text = body.text?.replace(/\s+/g, " ").trim() || "";
    if (action !== "explain" && action !== "translate") return jsonError(new Error("不支持的精读操作"), 400);
    if (text.length < 2 || text.length > 1600) return jsonError(new Error("请选择一句适当长度的英文"), 400);

    const bindings = getRuntimeBindings();
    if (!bindings.DEEPSEEK_API_KEY) return jsonError(new Error("AI Provider 尚未配置，请先在运行环境配置 DeepSeek API"), 503);
    const instruction = action === "translate"
      ? "把所选英文准确翻译成自然、忠实的中文。只输出译文，不扩写，不翻译未选中的内容。"
      : "用简洁中文解释所选英文句子的结构、关键表达和在当前上下文中的含义。不要续写文章，不要虚构背景。";
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bindings.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: bindings.DEEPSEEK_MODEL || "deepseek-chat",
        temperature: 0.2,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: `所选句子：\n${text}\n\n上下文：\n${(body.context || "").slice(0, 2400)}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI Provider 请求失败（${response.status}）`);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const result = payload.choices?.[0]?.message?.content?.trim();
    if (!result) throw new Error("AI Provider 未返回有效内容");
    return Response.json({ action, result });
  } catch (error) {
    return jsonError(error);
  }
}
