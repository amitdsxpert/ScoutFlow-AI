import { rankCandidates, recommendationFor } from "@/lib/ranking";
import type { CandidateProfile, InterestResult, MatchResult, RankedCandidate, RolePipeline } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { availabilityScore, completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface RankingOutput {
  rankedShortlist: RankedCandidate[];
  shortlistIds: string[];
}

export function runRankingAgent(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interestResults: InterestResult[];
  recommendedCandidateIds: string[];
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<RankingOutput>> {
  return runRanking(input);
}

async function runRanking(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interestResults: InterestResult[];
  recommendedCandidateIds: string[];
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<RankingOutput>> {
  const scopedInterest = input.interestResults.filter((interest) => interest.roleId === input.role.id);
  const ranked = rankCandidates(input.candidates, input.matches, scopedInterest, input.role.id);
  const rankedShortlist = ranked.length ? ranked : fallbackRanked(input.candidates, input.matches, input.role.id);
  const shortlistIds = rankedShortlist
    .slice(0, Math.max(10, Math.min(25, input.recommendedCandidateIds.length || 10)))
    .map((row) => row.candidate.id);
  const fallbackReasoning = `Combined match quality, detected interest, experience, location fit, availability, and risk signals into a recruiter-ready final order.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Ranking Agent for ScoutFlow AI. Summarize final ranking logic without changing candidate order.",
    userPrompt: `Summarize final ranking reasoning. Role: ${input.role.roleTitle}. Ranked candidates: ${rankedShortlist.length}. Shortlist size: ${shortlistIds.length}. Interest scores: ${scopedInterest.length}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("ranking", "completed", { rankedShortlist, shortlistIds }, `Produced a role-specific ranked shortlist of ${shortlistIds.length} candidates.`, {
    roleId: input.role.id,
    inputSummary: `${input.matches.length} matches and ${scopedInterest.length} interest scores`,
    outputSummary: `${shortlistIds.length} shortlist candidates.`,
    reasoningSummary: reasoning.text,
    confidence: rankedShortlist.length ? 0.88 : 0.52,
    providerUsed: reasoning.providerUsed,
    modelUsed: reasoning.modelUsed,
    logs: [
      ...rankedShortlist.slice(0, 8).map((row) => `${row.rank}. ${row.candidate.name}: ${row.finalScore}`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}

function fallbackRanked(candidates: CandidateProfile[], matches: MatchResult[], roleId: string): RankedCandidate[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return matches
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore)
    .map<RankedCandidate | null>((match, index) => {
      const candidate = candidateById.get(match.candidateId);
      if (!candidate) return null;
      const interestScore = Math.round(candidate.persona.openness * 100);
      const finalScore = Math.round(match.matchScore * 0.65 + interestScore * 0.35);
      return {
        roleId,
        rank: index + 1,
        candidate,
        match,
        interest: {
          roleId,
          candidateId: candidate.id,
          interestScore,
          interestLevel: "medium",
          signals: {
            explicitInterest: interestScore,
            enthusiasm: Math.round(candidate.persona.enthusiasm * 100),
            availability: availabilityScore(candidate.persona.availability),
            roleMotivation: match.matchScore,
            workModeFit: match.breakdown.location,
            objections: match.breakdown.riskAdjustment,
            nextStepReadiness: Math.round(candidate.persona.openness * 90),
          },
          summary: "Pre-engagement intent estimate based on persona and role fit.",
          recommendedNextAction: recommendationFor(finalScore),
        },
        finalScore,
        recommendation: recommendationFor(finalScore),
      } satisfies RankedCandidate;
    })
    .filter((row): row is RankedCandidate => row !== null);
}
