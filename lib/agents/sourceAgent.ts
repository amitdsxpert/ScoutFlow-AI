import { demoCandidates } from "@/lib/demoData";
import { ensureCandidateIdentifier } from "@/lib/identity";
import type { CandidateProfile, CandidateSource } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface SourceDiscoveryOutput {
  candidates: CandidateProfile[];
  sourceSummary: string;
}

export function runSourceDiscoveryAgent(input: {
  existingCandidates: CandidateProfile[];
  selectedSources: CandidateSource[];
  roleId?: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<SourceDiscoveryOutput>> {
  return runSourceDiscovery(input);
}

async function runSourceDiscovery(input: {
  existingCandidates: CandidateProfile[];
  selectedSources: CandidateSource[];
  roleId?: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<SourceDiscoveryOutput>> {
  const byId = new Map(input.existingCandidates.map((candidate) => [candidate.id, candidate]));
  const selectedSources = input.selectedSources.length ? input.selectedSources : ["demo" as CandidateSource];

  if (selectedSources.includes("demo")) {
    demoCandidates.forEach((candidate) => {
      byId.set(candidate.id, {
        ...ensureCandidateIdentifier(candidate),
        addedAt: candidate.addedAt ?? new Date().toISOString(),
        status: candidate.status ?? "new",
      });
    });
  }

  if (selectedSources.includes("database_mock")) {
    demoCandidates.slice(0, 14).forEach((candidate) => {
      byId.set(`database_mock-${candidate.id}`, {
        ...ensureCandidateIdentifier(candidate),
        id: `database_mock-${candidate.id}`,
        globalCandidateId: ensureCandidateIdentifier(candidate).globalCandidateId,
        source: "database_mock",
        addedAt: new Date().toISOString(),
        status: "new",
      });
    });
  }

  if (selectedSources.includes("metabase_mock")) {
    demoCandidates
      .filter((candidate) => {
        const text = `${candidate.skills.join(" ")} ${candidate.projects.join(" ")} ${candidate.summary}`.toLowerCase();
        return text.includes("llm") || text.includes("rag") || candidate.persona.type === "remote_only";
      })
      .forEach((candidate) => {
        byId.set(`metabase_mock-${candidate.id}`, {
          ...ensureCandidateIdentifier(candidate),
          id: `metabase_mock-${candidate.id}`,
          globalCandidateId: ensureCandidateIdentifier(candidate).globalCandidateId,
          source: "metabase_mock",
          addedAt: new Date().toISOString(),
          status: "new",
        });
      });
  }

  const candidates = Array.from(byId.values()).map(ensureCandidateIdentifier);
  const sourceSummary = selectedSources.map((source) => source.replace("_", " ")).join(", ");
  const status = candidates.length ? "completed" : "warning";
  const outputSummary = `${candidates.length} candidates available for matching.`;
  const fallbackReasoning = `Merged approved local and simulated connector records by candidate id, preserving existing candidates and adding selected source coverage.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Source Discovery Agent for ScoutFlow AI. Summarize source coverage without inventing candidates.",
    userPrompt: `Summarize source coverage for a recruiting run. Sources: ${sourceSummary}. Existing records: ${input.existingCandidates.length}. Total after merge: ${candidates.length}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("source_discovery", status, { candidates, sourceSummary }, `Loaded ${candidates.length} candidates from ${sourceSummary}.`, {
    roleId: input.roleId,
    inputSummary: `Sources: ${sourceSummary}`,
    outputSummary,
    reasoningSummary: reasoning.text,
    confidence: candidates.length ? 0.9 : 0.56,
    logs: [
      ...selectedSources.map((source) => `Source selected: ${source}`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}
