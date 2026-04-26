import { scoreInterest } from "@/lib/simulation";
import type {
  CandidateProfile,
  Conversation,
  InterestResult,
  MatchResult,
  OutreachCampaign,
  OutreachMode,
  RolePipeline,
} from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface InterestOutput {
  interestResults: InterestResult[];
  conversations: Conversation[];
}

export function runInterestDetectionAgent(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  campaign: OutreachCampaign;
  existingInterest: InterestResult[];
  mode: OutreachMode;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<InterestOutput>> {
  return runInterestDetection(input);
}

async function runInterestDetection(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  campaign: OutreachCampaign;
  existingInterest: InterestResult[];
  mode: OutreachMode;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<InterestOutput>> {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const matchById = new Map(input.matches.map((match) => [match.candidateId, match]));
  const interestByCandidate = new Map<string, InterestResult>();
  const conversations = (input.campaign.conversations ?? []).map((conversation) => {
    const candidate = candidateById.get(conversation.candidateId);
    if (!candidate) return conversation;
    const match = matchById.get(candidate.id);
    const evidence = conversation.transcript ?? conversation.reply ?? (input.mode === "draft_only" ? "Draft only; estimate intent from persona and match." : "");
    const interest = {
      ...scoreInterest(candidate, input.role.parsedJD, evidence, match),
      roleId: input.role.id,
      campaignId: input.campaign.id,
    };
    interestByCandidate.set(candidate.id, interest);
    return {
      ...conversation,
      interestResult: interest,
      status: interest.interestScore >= 75 ? "interested" : interest.interestScore >= 60 ? "follow_up_needed" : conversation.status,
    } satisfies Conversation;
  });

  const generated = await enrichInterestSummaries({
    interests: Array.from(interestByCandidate.values()),
    candidates: input.candidates,
    role: input.role,
    provider: input.provider,
    model: input.model,
  });
  const enrichedInterestByCandidate = new Map(generated.map((interest) => [interest.candidateId, interest]));
  const conversationsWithInterest = conversations.map((conversation) => {
    const interest = enrichedInterestByCandidate.get(conversation.candidateId);
    if (!interest) return conversation;
    return {
      ...conversation,
      interestResult: interest,
      status: interest.interestScore >= 75 ? "interested" : interest.interestScore >= 60 ? "follow_up_needed" : conversation.status,
    } satisfies Conversation;
  });
  const merged = [
    ...generated,
    ...input.existingInterest.filter((interest) => !(interest.roleId === input.role.id && interestByCandidate.has(interest.candidateId))),
  ];
  const highIntent = generated.filter((interest) => interest.interestScore >= 75).length;
  const fallbackReasoning = `Scored replies and transcripts for explicit interest, enthusiasm, availability, motivation, work-mode fit, objections, and next-step readiness.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Interest Detection Agent for ScoutFlow AI. Explain intent scoring from simulated replies and transcripts.",
    userPrompt: `Summarize interest detection reasoning. Role: ${input.role.roleTitle}. Conversations analyzed: ${conversationsWithInterest.length}. Interest scores generated: ${generated.length}. High intent: ${highIntent}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("interest_detection", "completed", { interestResults: merged, conversations: conversationsWithInterest }, `Identified ${highIntent} high-interest candidates from ${generated.length} analyzed conversations.`, {
    roleId: input.role.id,
    inputSummary: `${conversationsWithInterest.length} conversations`,
    outputSummary: `${generated.length} interest scores, ${highIntent} high interest.`,
    reasoningSummary: reasoning.text,
    confidence: generated.length ? 0.83 : 0.6,
    providerUsed: reasoning.providerUsed,
    modelUsed: reasoning.modelUsed,
    logs: [
      ...generated.slice(0, 8).map((interest) => `${interest.candidateId}: ${interest.interestScore} (${interest.interestLevel})`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}

async function enrichInterestSummaries(input: {
  interests: InterestResult[];
  candidates: CandidateProfile[];
  role: RolePipeline;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<InterestResult[]> {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const enriched = await Promise.all(input.interests.slice(0, 12).map(async (interest) => {
    const candidate = candidateById.get(interest.candidateId);
    if (!candidate) return interest;
    const result = await generateAgentText({
      provider: input.provider,
      model: input.model,
      systemPrompt: "You write concise recruiter intent summaries. Preserve the supplied score and next action.",
      userPrompt: [
        `Role: ${input.role.roleTitle}`,
        `Candidate: ${candidate.name}, persona ${candidate.persona.type}, availability ${candidate.persona.availability}`,
        `Interest score: ${interest.interestScore} (${interest.interestLevel})`,
        `Signals: explicit ${interest.signals.explicitInterest}, enthusiasm ${interest.signals.enthusiasm}, availability ${interest.signals.availability}, objections ${interest.signals.objections}`,
        `Fallback summary: ${interest.summary}`,
        "Write one sentence explaining the candidate's intent. Do not change the score.",
      ].join("\n"),
      fallback: interest.summary,
    });
    return { ...interest, summary: result.text };
  }));
  const enrichedById = new Map(enriched.map((interest) => [interest.candidateId, interest]));
  return input.interests.map((interest) => enrichedById.get(interest.candidateId) ?? interest);
}
