import { scoreCandidates } from "@/lib/scoring";
import type { CandidateProfile, MatchResult, RolePipeline } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export function runCandidateMatchingAgent(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<MatchResult[]>> {
  return runMatching(input);
}

async function runMatching(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<MatchResult[]>> {
  const deterministicMatches = scoreCandidates(input.candidates, input.role.parsedJD, input.role.id);
  const matches = await enrichMatchExplanations({
    matches: deterministicMatches,
    candidates: input.candidates,
    role: input.role,
    provider: input.provider,
    model: input.model,
  });
  const highMatches = matches.filter((match) => match.matchScore >= 75).length;
  const outputSummary = `${matches.length} scored candidates, ${highMatches} strong or excellent matches.`;
  const averageConfidence = matches.length ? matches.reduce((total, match) => total + match.confidence, 0) / matches.length / 100 : 0.5;
  const fallbackReasoning = `Scored each candidate against required skills, preferred skills, experience, domain relevance, location fit, and risk adjustment using the role weighting model.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Candidate Matching Agent for ScoutFlow AI. Explain the deterministic scoring model without changing scores.",
    userPrompt: `Summarize candidate matching reasoning in one sentence. Role: ${input.role.roleTitle}. Candidates scored: ${matches.length}. Strong matches: ${highMatches}. Required skills: ${input.role.parsedJD.requiredSkills.join(", ")}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent(
    "candidate_matching",
    "completed",
    matches,
    `Scored ${matches.length} candidates for ${input.role.roleTitle}; ${highMatches} are strong or excellent matches.`,
    {
      roleId: input.role.id,
      inputSummary: `${input.candidates.length} candidates against ${input.role.roleTitle}`,
      outputSummary,
      reasoningSummary: reasoning.text,
      confidence: Math.max(0.58, Math.min(0.95, averageConfidence || 0.72)),
      providerUsed: reasoning.providerUsed,
      modelUsed: reasoning.modelUsed,
      logs: [
        ...matches.slice(0, 6).map((match) => `${match.candidateId}: ${match.matchScore} (${match.scoreBand})`),
        `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
      ],
    },
  );
}

async function enrichMatchExplanations(input: {
  matches: MatchResult[];
  candidates: CandidateProfile[];
  role: RolePipeline;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<MatchResult[]> {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const explanationCandidates = input.matches
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
  const explanationByCandidate = new Map<string, string>();

  await Promise.all(explanationCandidates.map(async (match) => {
    const candidate = candidateById.get(match.candidateId);
    if (!candidate) return;
    const fallback = match.explanation;
    const result = await generateAgentText({
      provider: input.provider,
      model: input.model,
      systemPrompt: "You write candidate fit explanations for recruiters. Preserve the given score, gaps, and risk facts.",
      userPrompt: [
        `Role: ${input.role.roleTitle}`,
        `Candidate: ${candidate.name}, ${candidate.currentTitle}, ${candidate.yearsExperience} years, ${candidate.location}`,
        `Match score: ${match.matchScore} (${match.scoreBand})`,
        `Matched required skills: ${match.matchedRequiredSkills.join(", ") || "none"}`,
        `Matched preferred skills: ${match.matchedPreferredSkills.join(", ") || "none"}`,
        `Missing required skills: ${match.missingSkills.join(", ") || "none"}`,
        `Risks: ${match.risks.join(" | ") || "none"}`,
        "Write one concise recruiter-facing explanation. Do not change the score or invent skills.",
      ].join("\n"),
      fallback,
    });
    explanationByCandidate.set(match.candidateId, result.text);
  }));

  return input.matches.map((match) => ({
    ...match,
    explanation: explanationByCandidate.get(match.candidateId) ?? match.explanation,
  }));
}
