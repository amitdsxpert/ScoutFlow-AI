import { ensureCandidateIdentifier } from "@/lib/identity";
import type { CandidateProfile, CandidateSource } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface ResumeParsingOutput {
  candidates: CandidateProfile[];
  parsedResumeCount: number;
  averageConfidence: number;
}

export function runResumeParsingAgent(input: {
  candidates: CandidateProfile[];
  selectedSources: CandidateSource[];
  roleId?: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<ResumeParsingOutput>> {
  return runResumeParsing(input);
}

async function runResumeParsing(input: {
  candidates: CandidateProfile[];
  selectedSources: CandidateSource[];
  roleId?: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<ResumeParsingOutput>> {
  const resumeCandidates = input.candidates.filter((candidate) => candidate.source === "resume_upload");
  const candidates = input.candidates.map((candidate) => {
    if (candidate.source !== "resume_upload") return ensureCandidateIdentifier(candidate);
    return ensureCandidateIdentifier({
      ...candidate,
      parsingConfidence: candidate.parsingConfidence ?? estimateResumeConfidence(candidate),
      segments: Array.from(new Set([...(candidate.segments ?? []), "resume_upload"])),
    });
  });
  const parsedResumeCount = resumeCandidates.length;
  const averageConfidence = parsedResumeCount
    ? Math.round(candidates
        .filter((candidate) => candidate.source === "resume_upload")
        .reduce((total, candidate) => total + (candidate.parsingConfidence ?? 72), 0) / parsedResumeCount)
    : 0;
  const resumeSourceSelected = input.selectedSources.includes("resume_upload");
  const status = parsedResumeCount ? "completed" : resumeSourceSelected ? "warning" : "idle";
  const fallbackReasoning = parsedResumeCount
    ? `Validated ${parsedResumeCount} resume-upload profiles with deterministic extraction, skill normalization, and confidence scoring.`
    : resumeSourceSelected
      ? "Resume upload was selected, but no parsed TXT/MD resume profiles are currently indexed."
      : "Resume parsing stood by because no resume upload source was selected for this run.";
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Resume Parsing Agent for ScoutFlow AI. Summarize resume extraction readiness without inventing candidates.",
    userPrompt: `Summarize resume parsing status in one sentence. Resume source selected: ${resumeSourceSelected}. Resume candidates: ${parsedResumeCount}. Average confidence: ${averageConfidence || "n/a"}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("resume_parsing", status, { candidates, parsedResumeCount, averageConfidence }, resumeSummary(parsedResumeCount, averageConfidence, resumeSourceSelected), {
    roleId: input.roleId,
    inputSummary: `${parsedResumeCount} resume-derived profiles in workspace`,
    outputSummary: parsedResumeCount ? `${parsedResumeCount} resume profiles validated at ${averageConfidence}% average confidence.` : "No resume profiles required parsing.",
    reasoningSummary: reasoning.text,
    confidence: parsedResumeCount ? Math.max(0.5, Math.min(0.96, averageConfidence / 100)) : resumeSourceSelected ? 0.55 : 0.95,
    logs: [
      ...resumeCandidates.slice(0, 8).map((candidate) => `${candidate.name}: ${candidate.parsingConfidence ?? estimateResumeConfidence(candidate)}% parsing confidence`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}

function estimateResumeConfidence(candidate: CandidateProfile): number {
  let score = 52;
  if (candidate.name && !candidate.name.toLowerCase().includes("unknown")) score += 10;
  if (candidate.email) score += 8;
  if (candidate.phone) score += 6;
  if (candidate.skills.length >= 4) score += 12;
  if (candidate.yearsExperience > 0) score += 8;
  if (candidate.summary.length > 80) score += 6;
  return Math.min(94, score);
}

function resumeSummary(count: number, confidence: number, selected: boolean): string {
  if (count) return `Validated ${count} resume-upload profiles with ${confidence}% average parsing confidence.`;
  if (selected) return "Resume upload source selected, but no parsed resume profiles are currently indexed.";
  return "Resume Parsing Agent stood by; no resume upload source selected.";
}
