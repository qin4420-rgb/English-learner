import { getRuntimeBindings } from "@/app/api/_lib/runtime";
import type { ProviderStatus } from "@/app/types";

export type AIProvider = {
  id: string;
  configured: boolean;
  explain(text: string, context?: string): Promise<string>;
  translate(text: string, targetLanguage?: string): Promise<string>;
};

export type OCRProvider = {
  id: string;
  configured: boolean;
  extract(input: ArrayBuffer, contentType: string): Promise<string>;
};

export type STTProvider = {
  id: string;
  configured: boolean;
  transcribe(input: ArrayBuffer, contentType: string): Promise<{ text: string; segments: unknown[] }>;
};

export type PronunciationProvider = {
  id: string;
  configured: boolean;
  assess(input: ArrayBuffer, referenceText: string): Promise<unknown>;
};

export type TTSProvider = {
  id: string;
  configured: boolean;
  synthesize(text: string, voice?: string): Promise<ArrayBuffer>;
};

async function callFileProvider(endpoint: string, apiKey: string | undefined, bytes: ArrayBuffer, contentType: string, filename: string) {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type: contentType || "application/octet-stream" }));
  const response = await fetch(endpoint, { method: "POST", headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined, body: form });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error || data.message || `Provider请求失败（${response.status}）`));
  return data;
}

export async function runOCR(bytes: ArrayBuffer, contentType: string, filename: string) {
  const bindings = getRuntimeBindings();
  if (!bindings.OCR_PROVIDER || !bindings.OCR_ENDPOINT) throw new Error("OCR Provider 尚未配置");
  const data = await callFileProvider(bindings.OCR_ENDPOINT, bindings.OCR_API_KEY, bytes, contentType, filename);
  const text = String(data.text || data.markdown || "").trim();
  if (!text) throw new Error("OCR Provider 未返回文字");
  return text;
}

export async function runSTT(bytes: ArrayBuffer, contentType: string, filename: string) {
  const bindings = getRuntimeBindings();
  if (!bindings.STT_PROVIDER || !bindings.STT_ENDPOINT) throw new Error("STT Provider 尚未配置");
  const data = await callFileProvider(bindings.STT_ENDPOINT, bindings.STT_API_KEY, bytes, contentType, filename);
  const text = String(data.text || "").trim();
  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (!text && !segments.length) throw new Error("STT Provider 未返回文字稿");
  return { text, segments };
}

export async function runSTTUrl(sourceUrl: string) {
  const bindings = getRuntimeBindings();
  if (!bindings.STT_PROVIDER || !bindings.STT_ENDPOINT) throw new Error("STT Provider 尚未配置");
  const response = await fetch(bindings.STT_ENDPOINT, { method: "POST", headers: { ...(bindings.STT_API_KEY ? { authorization: `Bearer ${bindings.STT_API_KEY}` } : {}), "content-type": "application/json" }, body: JSON.stringify({ url: sourceUrl }) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error || data.message || `STT Provider请求失败（${response.status}）`));
  const text = String(data.text || "").trim();
  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (!text && !segments.length) throw new Error("STT Provider 未返回文字稿");
  return { text, segments };
}

export async function runTTS(text: string, voice = "") {
  const bindings = getRuntimeBindings();
  if (!bindings.TTS_PROVIDER || !bindings.TTS_ENDPOINT) throw new Error("TTS Provider 尚未配置；前端将使用浏览器 SpeechSynthesis");
  const response = await fetch(bindings.TTS_ENDPOINT, {
    method: "POST",
    headers: { ...(bindings.TTS_API_KEY ? { authorization: `Bearer ${bindings.TTS_API_KEY}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ text, voice, language: "en-US" }),
  });
  if (!response.ok) throw new Error(`TTS Provider请求失败（${response.status}）`);
  return response.arrayBuffer();
}

function providerName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function getProviderStatuses(): ProviderStatus[] {
  const bindings = getRuntimeBindings();
  return [
    {
      id: "ai",
      label: "AI",
      provider: providerName(bindings.AI_PROVIDER, "DeepSeek"),
      configured: Boolean(bindings.DEEPSEEK_API_KEY),
      endpointConfigured: true,
    },
    {
      id: "ocr",
      label: "OCR",
      provider: providerName(bindings.OCR_PROVIDER, "未选择"),
      configured: Boolean(bindings.OCR_PROVIDER && bindings.OCR_ENDPOINT),
      endpointConfigured: Boolean(bindings.OCR_ENDPOINT),
    },
    {
      id: "stt",
      label: "Speech-to-Text",
      provider: providerName(bindings.STT_PROVIDER, "未选择"),
      configured: Boolean(bindings.STT_PROVIDER && bindings.STT_ENDPOINT),
      endpointConfigured: Boolean(bindings.STT_ENDPOINT),
    },
    {
      id: "pronunciation",
      label: "Pronunciation",
      provider: providerName(bindings.PRONUNCIATION_PROVIDER, "未选择"),
      configured: Boolean(bindings.PRONUNCIATION_PROVIDER && bindings.PRONUNCIATION_ENDPOINT),
      endpointConfigured: Boolean(bindings.PRONUNCIATION_ENDPOINT),
    },
    {
      id: "tts",
      label: "Text-to-Speech",
      provider: bindings.TTS_PROVIDER ? providerName(bindings.TTS_PROVIDER, "Provider") : "浏览器 SpeechSynthesis",
      configured: Boolean(bindings.TTS_PROVIDER && bindings.TTS_ENDPOINT),
      endpointConfigured: Boolean(bindings.TTS_ENDPOINT),
    },
  ];
}
