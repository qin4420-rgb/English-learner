import { ensureDatabase, getDatabase, getOwnerId, getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";

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
  contextMeaning?: string;
  usage?: string[];
  examples?: { english?: string; chinese?: string }[];
  mnemonic?: string[];
  roots?: string[];
  etymology?: string[];
  collocations?: string[];
  synonyms?: string[];
  similarWords?: string[];
  replacements?: string[];
  derivedForms?: string[];
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
}

function normalizeTerm(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return /^[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,7}$/.test(normalized) ? normalized : "";
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { word?: string; context?: string };
    const term = normalizeTerm(String(body.word || ""));
    if (!term) return jsonError(new Error("请选择一个有效的英文单词或短语（最多 8 个词）"), 400);
    const context = String(body.context || "").replace(/\s+/g, " ").trim().slice(0, 1000);
    const isSingleWord = !term.includes(" ");

    let phonetic = "";
    let dictionaryDefinition = "";
    let dictionaryExample = "";
    let dictionarySource = "";
    if (isSingleWord) {
      const local = await getDatabase().prepare(`SELECT e.*,s.name AS source_name FROM dictionary_entries e JOIN dictionary_sources s ON s.id=e.source_id WHERE s.owner_id=? AND s.enabled=1 AND e.headword=? ORDER BY s.sort_order,s.id LIMIT 1`).bind(ownerId, term).first<Record<string, unknown>>();
      if (local) {
        phonetic = String(local.phonetic || "");
        dictionaryDefinition = [local.part_of_speech ? `${local.part_of_speech}.` : "", local.definition, local.definition_en].filter(Boolean).join(" ").trim();
        dictionaryExample = String(local.example || "");
        dictionarySource = String(local.source_name || "本地词典");
      }
    }
    if (isSingleWord && !dictionaryDefinition) {
      try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`, {
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
          dictionarySource = "在线基础词典";
        }
      } catch {
        // AI contextual explanation remains available when the public dictionary is unavailable.
      }
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
          max_tokens: 1800,
          messages: [
            {
              role: "system",
              content: `你是面向中文学习者的英语词典编辑。任务只解释用户选中的英文单词或短语，不翻译、概括或续写整篇文章。必须结合给定原句判断本处含义和语法作用；若语境不足要明确说明，禁止编造词源或考试出处。只输出JSON：
dictionaryTranslation 为简洁中文词性和义项；contextMeaning 为当前语境中的准确含义与作用；usage 为语法、语域或易错点数组；examples 为至多2个对象，每个含 english 和 chinese，均为学习用仿写例句；mnemonic、roots、etymology、collocations、synonyms、similarWords、replacements、derivedForms 均为字符串数组。没有可靠或有用内容的字段返回空数组。`,
            },
            {
              role: "user",
              content: `选中词或短语：${term}\n文章原句或当前段落：${context || "未提供"}\n英文词典释义：${dictionaryDefinition || "未查询到"}`,
            },
          ],
        }),
      });
      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      if (response.ok && data.choices?.[0]?.message?.content) {
        try { ai = JSON.parse(data.choices[0].message.content) as AiLookup; } catch { /* Preserve dictionary result. */ }
      }
    }

    const examples = Array.isArray(ai.examples)
      ? ai.examples.map((item) => [String(item?.english || "").trim(), String(item?.chinese || "").trim()].filter(Boolean).join("\n")).filter(Boolean).slice(0, 2)
      : [];
    if (!examples.length && dictionaryExample) examples.push(dictionaryExample);
    const contextMeaning = String(ai.contextMeaning || (context
      ? `当前原句中出现了“${term}”。连接 DeepSeek 后可生成精确的语境、语法和搭配说明。`
      : "未提供原句，暂时只能按词典常见义理解。"));

    return Response.json({
      word: term,
      phonetic,
      dictionaryDefinition: String(ai.dictionaryTranslation || dictionaryDefinition || (isSingleWord ? "暂未查询到词典释义" : "短语释义由 AI 结合语境生成")),
      dictionaryEnglish: dictionaryDefinition,
      aiExplanation: contextMeaning,
      example: examples[0]?.split("\n")[0] || "",
      exampleTranslation: examples[0]?.split("\n").slice(1).join("\n") || "",
      sourceSentence: context,
      aiDetails: {
        context: [contextMeaning],
        usage: stringList(ai.usage),
        examples,
        mnemonic: stringList(ai.mnemonic),
        roots: stringList(ai.roots),
        etymology: stringList(ai.etymology),
        collocations: stringList(ai.collocations),
        synonyms: stringList(ai.synonyms),
        similarWords: stringList(ai.similarWords),
        replacements: stringList(ai.replacements),
        derivedForms: stringList(ai.derivedForms),
      },
      aiEnhanced: Boolean(bindings.DEEPSEEK_API_KEY && ai.contextMeaning),
      dictionarySource,
    });
  } catch (error) {
    return jsonError(error);
  }
}
