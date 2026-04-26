import type { AgentProviderUsed } from "@/lib/types";
import type { AgentLlmProvider } from "./types";

export type LlmProvider = "none" | "openrouter" | "gemini" | "groq" | "huggingface";

export interface AgentTextRequest {
  task?: string;
  provider?: AgentLlmProvider;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  fallback?: string;
  fallbackText?: string;
  fallbackJson?: unknown;
  model?: string;
}

export interface AgentTextResult {
  ok: boolean;
  text: string;
  json?: unknown;
  providerUsed: AgentProviderUsed;
  modelUsed?: string;
  usedFallback: boolean;
  error?: string;
}

export interface LlmStatus {
  provider: LlmProvider;
  providerLabel: string;
  configured: boolean;
  mode: "ai" | "fallback";
  model?: string;
  error?: string;
}

const defaultModels: Record<Exclude<LlmProvider, "none">, string> = {
  openrouter: "openai/gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  groq: "llama-3.3-70b-versatile",
  huggingface: "mistralai/Mistral-7B-Instruct-v0.3",
};

const defaultEndpoints = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  huggingface: "https://api-inference.huggingface.co/models",
};

export async function generateAgentText({
  task,
  provider,
  systemPrompt,
  userPrompt,
  jsonMode = false,
  fallback,
  fallbackText,
  fallbackJson,
  model,
}: AgentTextRequest): Promise<AgentTextResult> {
  const providerChain = resolveProviderChain(provider);
  const localFallbackText = fallbackText ?? fallback ?? (fallbackJson === undefined ? "" : JSON.stringify(fallbackJson, null, 2));

  if (!providerChain.length) {
    return fallbackResult(localFallbackText, fallbackJson, undefined, jsonMode);
  }

  const errors: string[] = [];

  for (const selectedProvider of providerChain) {
    const config = getProviderConfig(selectedProvider, model);
    if (!config.apiKey) {
      errors.push(`${providerLabel(selectedProvider)} API key is missing`);
      continue;
    }

    try {
      const text = await callProvider({
        provider: selectedProvider,
        apiKey: config.apiKey,
        model: config.model,
        systemPrompt,
        userPrompt: task ? `Task: ${task}\n\n${userPrompt}` : userPrompt,
        jsonMode,
      });

      const normalized = text.trim();
      if (!normalized) {
        errors.push(`${providerLabel(selectedProvider)} returned an empty response`);
        continue;
      }

      if (jsonMode) {
        const parsed = safeParseJson(normalized);
        if (!parsed.ok) {
          errors.push(`${providerLabel(selectedProvider)} returned non-JSON output`);
          continue;
        }

        return {
          ok: true,
          text: normalized,
          json: parsed.value,
          providerUsed: selectedProvider,
          modelUsed: config.model,
          usedFallback: false,
        };
      }

      return {
        ok: true,
        text: normalized,
        providerUsed: selectedProvider,
        modelUsed: config.model,
        usedFallback: false,
      };
    } catch (error) {
      errors.push(`${providerLabel(selectedProvider)}: ${readableError(error)}`);
    }
  }

  return fallbackResult(localFallbackText, fallbackJson, errors.join(" | ") || "LLM provider failed", jsonMode);
}

export function getLlmStatus(providerOverride?: AgentLlmProvider, modelOverride?: string): LlmStatus {
  const chain = resolveProviderChain(providerOverride);
  const configuredProvider = chain.find((candidate) => Boolean(getProviderConfig(candidate, modelOverride).apiKey));
  const provider = configuredProvider ?? resolveProvider(providerOverride);
  const config = provider === "none" ? undefined : getProviderConfig(provider, modelOverride);
  const configured = Boolean(configuredProvider);

  return {
    provider,
    providerLabel: configured ? providerLabel(provider) : "Local Fallback",
    configured,
    mode: configured ? "ai" : "fallback",
    model: provider === "none" ? undefined : config?.model,
  };
}

export function providerLabel(provider: LlmProvider): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  return "Local Fallback";
}

function resolveProvider(providerOverride?: AgentLlmProvider): LlmProvider {
  const provider = (providerOverride && providerOverride !== "auto" ? providerOverride : process.env.LLM_PROVIDER || "none").toLowerCase();
  if (provider === "openrouter" || provider === "gemini" || provider === "groq" || provider === "huggingface") return provider;
  return "none";
}

function resolveProviderChain(providerOverride?: AgentLlmProvider): Array<Exclude<LlmProvider, "none">> {
  const selected = resolveProvider(providerOverride);
  if (selected === "none") return [];

  const priority: Array<Exclude<LlmProvider, "none">> =
    selected === "openrouter"
      ? ["openrouter", "gemini", "groq", "huggingface"]
      : selected === "gemini"
        ? ["gemini", "groq", "openrouter", "huggingface"]
        : selected === "groq"
          ? ["groq", "gemini", "openrouter", "huggingface"]
          : ["huggingface", "openrouter", "gemini", "groq"];

  return Array.from(new Set(priority));
}

function getProviderConfig(provider: Exclude<LlmProvider, "none">, modelOverride?: string) {
  if (provider === "openrouter") {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: cleanModel(modelOverride) || process.env.OPENROUTER_MODEL || defaultModels.openrouter,
    };
  }

  if (provider === "gemini") {
    return {
      apiKey: process.env.GEMINI_API_KEY,
      model: cleanModel(modelOverride) || process.env.GEMINI_MODEL || defaultModels.gemini,
    };
  }

  if (provider === "groq") {
    return {
      apiKey: process.env.GROQ_API_KEY,
      model: cleanModel(modelOverride) || process.env.GROQ_MODEL || defaultModels.groq,
    };
  }

  return {
    apiKey: process.env.HUGGINGFACE_API_KEY,
    model: cleanModel(modelOverride) || process.env.HUGGINGFACE_MODEL || defaultModels.huggingface,
  };
}

async function callProvider(input: {
  provider: Exclude<LlmProvider, "none">;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
}): Promise<string> {
  if (input.provider === "openrouter") return generateWithOpenRouter(input);
  if (input.provider === "gemini") return generateWithGemini(input);
  if (input.provider === "groq") return generateWithGroq(input);
  return generateWithHuggingFace(input);
}

async function generateWithOpenRouter(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
}): Promise<string> {
  const endpoint = cleanEndpoint(process.env.OPENROUTER_API_BASE, defaultEndpoints.openrouter);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": "https://scoutflow-ai.local",
      "X-Title": "ScoutFlow AI",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      response_format: input.jsonMode ? { type: "json_object" } : undefined,
      temperature: 0.25,
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${await safeResponseText(response)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

async function generateWithGemini(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
}): Promise<string> {
  const base = cleanEndpoint(process.env.GEMINI_API_BASE, defaultEndpoints.gemini);
  const model = input.model.replace(/^models\//, "");
  const response = await fetch(`${base}/models/${model}:generateContent?key=${input.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: input.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 900,
        responseMimeType: input.jsonMode ? "application/json" : "text/plain",
      },
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw new Error(`Gemini error ${response.status}: ${await safeResponseText(response)}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

async function generateWithGroq(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
}): Promise<string> {
  // Groq is OpenAI-compatible.
  const endpoint = cleanEndpoint(process.env.GROQ_API_BASE, defaultEndpoints.groq);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      response_format: input.jsonMode ? { type: "json_object" } : undefined,
      temperature: 0.25,
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw new Error(`Groq error ${response.status}: ${await safeResponseText(response)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

async function generateWithHuggingFace(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode: boolean;
}): Promise<string> {
  const base = cleanEndpoint(process.env.HUGGINGFACE_API_BASE, defaultEndpoints.huggingface);
  const prompt = [
    "System:",
    input.systemPrompt,
    "",
    "User:",
    input.userPrompt,
    input.jsonMode ? "\nReturn valid JSON only." : "",
  ].join("\n");

  const response = await fetch(`${base}/${input.model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: 900,
        temperature: 0.25,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face error ${response.status}: ${await safeResponseText(response)}`);
  }

  return normalizeHuggingFaceText(await response.json());
}

function normalizeHuggingFaceText(json: unknown): string {
  if (typeof json === "string") return json;
  if (Array.isArray(json)) {
    return json.map((item) => normalizeHuggingFaceText(item)).filter(Boolean).join("\n").trim();
  }
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    if (typeof record.generated_text === "string") return record.generated_text;
    if (typeof record.summary_text === "string") return record.summary_text;
    if (typeof record.translation_text === "string") return record.translation_text;
    if (typeof record.error === "string") throw new Error(record.error);
    if (Array.isArray(record.choices)) {
      return record.choices.map((choice) => normalizeHuggingFaceText(choice)).filter(Boolean).join("\n").trim();
    }
    if (record.message && typeof record.message === "object") {
      return normalizeHuggingFaceText(record.message);
    }
    if (typeof record.content === "string") return record.content;
  }
  return "";
}

function fallbackResult(fallback: string, fallbackJson?: unknown, error?: string, jsonMode = false): AgentTextResult {
  return {
    ok: false,
    text: fallback,
    json: jsonMode ? fallbackJson : undefined,
    providerUsed: "local_fallback",
    usedFallback: true,
    error,
  };
}

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(stripJsonFence(text)) };
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return { ok: true, value: JSON.parse(text.slice(first, last + 1)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function cleanModel(model?: string): string {
  return model?.trim() ?? "";
}

function cleanEndpoint(endpoint: string | undefined, fallback: string): string {
  return (endpoint?.trim() || fallback).replace(/\/+$/, "");
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "No response body";
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "LLM provider failed";
}
