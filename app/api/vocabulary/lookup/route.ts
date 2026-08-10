import { getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";

type DictionaryEntry = {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: {
    partOfSpeech?: string;
    definitions?: { definition?: string; example?: string }[];
  }[];
};

type AiLookup = {
  dictionaryTranslation?: string;
  aiExplanation?: string;
  ieltsExample?: string;
  exampleTranslation?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { word?: string; context?: string };
    const word = body.word?.trim().toLowerCase().match(/^[a-z][a-z'-]{0,60}$/)?.[0];
    if (!word) return jsonError(new Error("请选择一个有效的英文单词"), 400);
    const context = String(body.context || "").replace(/\s+/g, " ").trim().slice(0, 800);

    let phonetic = "";
    let dictionaryDefinition = "";
    let dictionaryExample = "";
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        const entries = await response.json() as DictionaryEntry[];
        const first = entries[0];
        phonetic = first?.phonetic || first?.phonetics?.find((item) => item.text)?.text || "";
        const definitions = (first?.meanings || []).flatMap((meaning) =>
          (meaning.definitions || []).slice(0, 2).map((item) => ({
            part: meaning.partOfSpeech || "",
            definition: item.definition || "",
            example: item.example || "",
          })),
        ).filter((item) => item.definition).slice(0, 5);
        dictionaryDefinition = definitions.map((item) => `${item.part ? `${item.part}. ` : ""}${item.definition}`).join("\n");
        dictionaryExample = definitions.find((item) => item.example)?.example || "";
      }
    } catch {
      // The AI explanation below remains available if the public dictionary is temporarily unavailable.
    }

    const bindings = getRuntimeBindings();
    let ai: AiLookup = {};
    if (bindings.DEEPSEEK_API_KEY) {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bindings.DEEPSEEK_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: bindings.DEEPSEEK_MODEL || "deepseek-v4-pro",
          response_format: { type: "json_object" },
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content: "你是英语学习词典编辑。只输出JSON，字段为 dictionaryTranslation, aiExplanation, ieltsExample, exampleTranslation。dictionaryTranslation 给出简洁准确的中文词性和义项；aiExplanation 结合文章语境说明含义、搭配、语法和易错点；ieltsExample 给出一条自然、适合雅思6.5-7.5水平的英文例句；exampleTranslation 是该例句中文译文。不得声称例句来自真实雅思试题。",
            },
            {
              role: "user",
              content: `单词：${word}\n文章语境：${context || "未提供"}\n英文词典释义：${dictionaryDefinition || "未查询到"}`,
            },
          ],
        }),
      });
      const data = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (response.ok && data.choices?.[0]?.message?.content) {
        try { ai = JSON.parse(data.choices[0].message.content) as AiLookup; } catch { /* Preserve dictionary result. */ }
      }
    }

    return Response.json({
      word,
      phonetic,
      dictionaryDefinition: String(ai.dictionaryTranslation || dictionaryDefinition || "暂未查询到词典释义"),
      dictionaryEnglish: dictionaryDefinition,
      aiExplanation: String(ai.aiExplanation || (context ? `文章原句中使用了“${word}”：${context}` : "配置 DeepSeek API 后可生成语境化解释。")),
      example: String(ai.ieltsExample || dictionaryExample || ""),
      exampleTranslation: String(ai.exampleTranslation || ""),
      sourceSentence: context,
      aiEnhanced: Boolean(bindings.DEEPSEEK_API_KEY && ai.aiExplanation),
    });
  } catch (error) {
    return jsonError(error);
  }
}
