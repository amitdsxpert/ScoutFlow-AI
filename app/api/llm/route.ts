import { NextResponse } from "next/server";
import { generateAgentText, getLlmStatus } from "@/lib/agents/llmClient";
import type { AgentLlmProvider } from "@/lib/agents/types";

export const runtime = "nodejs";

interface LlmRequestBody {
  prompt?: string;
  systemPrompt?: string;
  userPrompt?: string;
  fallback?: string;
  provider?: AgentLlmProvider;
  model?: string;
  jsonMode?: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as AgentLlmProvider | null;
  const model = searchParams.get("model") ?? undefined;
  return NextResponse.json(getLlmStatus(provider ?? undefined, model));
}

export async function POST(request: Request) {
  const body = (await request.json()) as LlmRequestBody;
  const fallback = body.fallback ?? "";
  const userPrompt = body.userPrompt ?? body.prompt ?? "";
  const result = await generateAgentText({
    provider: body.provider,
    model: body.model,
    systemPrompt: body.systemPrompt ?? "You write concise, practical recruiting content. Return only the requested content.",
    userPrompt,
    jsonMode: body.jsonMode,
    fallback,
  });
  const status = getLlmStatus(body.provider, body.model);
  const provider = result.usedFallback || result.providerUsed === "local_fallback" ? "none" : result.providerUsed;
  const responseStatus = result.usedFallback
    ? { ...status, provider: "none" as const, providerLabel: "Local Fallback", mode: "fallback" as const, model: undefined }
    : {
        ...status,
        provider,
        providerLabel:
          result.providerUsed === "openrouter"
            ? "OpenRouter"
            : result.providerUsed === "gemini"
              ? "Gemini"
              : result.providerUsed === "groq"
                ? "Groq"
                : "Hugging Face",
        mode: "ai" as const,
        model: result.modelUsed,
      };

  return NextResponse.json({
    ok: result.ok,
    text: result.text,
    json: result.json,
    providerUsed: result.providerUsed,
    modelUsed: result.modelUsed,
    usedFallback: result.usedFallback,
    error: result.error,
    ...responseStatus,
  });
}
