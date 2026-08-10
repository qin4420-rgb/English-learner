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
  ];
}
