import type { CandidateProfile, InterestResult, MatchResult, OptimizationFocus } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { availabilityScore, completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface RecommendationOutput {
  recommendedCandidateIds: string[];
  rankedMatches: MatchResult[];
}

export function runRecommendationAgent(input: {
  matches: MatchResult[];
  candidates: CandidateProfile[];
  existingInterest: InterestResult[];
  limit: number;
  focus: OptimizationFocus;
  roleId: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<RecommendationOutput>> {
  return runRecommendation(input);
}

async function runRecommendation(input: {
  matches: MatchResult[];
  candidates: CandidateProfile[];
  existingInterest: InterestResult[];
  limit: number;
  focus: OptimizationFocus;
  roleId: string;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<RecommendationOutput>> {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const interestById = new Map(input.existingInterest.map((interest) => [interest.candidateId, interest]));
  const rankedMatches = input.matches
    .slice()
    .sort((a, b) => recommendationScore(b, candidateById.get(b.candidateId), interestById.get(b.candidateId), input.focus) - recommendationScore(a, candidateById.get(a.candidateId), interestById.get(a.candidateId), input.focus));
  const recommendedCandidateIds = rankedMatches.slice(0, Math.max(1, input.limit)).map((match) => match.candidateId);
  const focusLabel = input.focus.replace("_", "-");
  const fallbackReasoning = `Prioritized candidates by ${focusLabel} weighting while retaining match score, availability, persona openness, location fit, and risk signals.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Recommendation Agent for ScoutFlow AI. Explain the recommendation strategy using only supplied counts and focus.",
    userPrompt: `Explain the recommendation strategy in one concise sentence. Focus: ${focusLabel}. Matches: ${input.matches.length}. Limit: ${input.limit}. Selected: ${recommendedCandidateIds.length}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("recommendation", "completed", { recommendedCandidateIds, rankedMatches }, `Selected top ${recommendedCandidateIds.length} candidates optimized for ${focusLabel}.`, {
    roleId: input.roleId,
    inputSummary: `${input.matches.length} matches, focus ${focusLabel}`,
    outputSummary: `${recommendedCandidateIds.length} recommended candidates.`,
    reasoningSummary: reasoning.text,
    confidence: rankedMatches.length ? 0.86 : 0.5,
    providerUsed: reasoning.providerUsed,
    modelUsed: reasoning.modelUsed,
    logs: [
      ...recommendedCandidateIds.slice(0, 8).map((id, index) => `${index + 1}. ${candidateById.get(id)?.name ?? id}`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}

function recommendationScore(match: MatchResult, candidate: CandidateProfile | undefined, interest: InterestResult | undefined, focus: OptimizationFocus): number {
  const availability = candidate ? availabilityScore(candidate.persona.availability) : 50;
  const interestScore = interest?.interestScore ?? Math.round((candidate?.persona.openness ?? 0.5) * 100);
  const riskScore = match.breakdown.riskAdjustment;
  const location = match.breakdown.location;
  const skills = match.breakdown.requiredSkills * 0.7 + match.breakdown.preferredSkills * 0.3;
  const compensationPenalty = candidate?.persona.compensationSensitivity === "high" ? 12 : candidate?.persona.compensationSensitivity === "medium" ? 5 : 0;

  if (focus === "skills_first") return skills * 0.62 + match.breakdown.experience * 0.24 + riskScore * 0.14;
  if (focus === "interest_first") return interestScore * 0.58 + match.matchScore * 0.32 + availability * 0.1;
  if (focus === "location_first") return location * 0.55 + match.matchScore * 0.35 + riskScore * 0.1;
  if (focus === "availability_first") return availability * 0.58 + interestScore * 0.22 + match.matchScore * 0.2;
  if (focus === "compensation_sensitive") return match.matchScore * 0.55 + interestScore * 0.25 + riskScore * 0.2 - compensationPenalty;
  if (focus === "low_risk") return riskScore * 0.52 + match.matchScore * 0.34 + availability * 0.14;
  return match.matchScore * 0.65 + interestScore * 0.2 + availability * 0.1 + riskScore * 0.05;
}
