import { generateAgentText, getLlmStatus, type LlmProvider } from "@/lib/agents/llmClient";
import type { AgentLlmProvider } from "@/lib/agents/types";

export type Provider = LlmProvider;

interface GenerateOptions {
  fallback?: string;
  provider?: AgentLlmProvider;
  model?: string;
  systemPrompt?: string;
  jsonMode?: boolean;
}

export { getLlmStatus };

export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
  const result = await generateAgentText({
    provider: options.provider,
    model: options.model,
    systemPrompt: options.systemPrompt ?? "You write concise, practical recruiting content. Return only the requested content.",
    userPrompt: prompt,
    jsonMode: options.jsonMode,
    fallback: options.fallback ?? "",
  });

  return result.text;
}
