import { generatePhoneOpening } from "@/lib/outreach";
import { makeId } from "@/lib/roles";
import { simulatePhoneTranscript, transcriptToText } from "@/lib/simulation";
import type {
  CandidateProfile,
  Conversation,
  MatchResult,
  OutreachCampaign,
  OutreachMode,
  OutreachResult,
  RolePipeline,
} from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";
import type { OutreachOutput } from "./outreachAgent";

export function runPhoneOutreachAgent(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  recommendedCandidateIds: string[];
  enabled: boolean;
  campaign: OutreachCampaign;
  mode: OutreachMode;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<OutreachOutput>> {
  return runPhone(input);
}

async function runPhone(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  recommendedCandidateIds: string[];
  enabled: boolean;
  campaign: OutreachCampaign;
  mode: OutreachMode;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<OutreachOutput>> {
  if (!input.enabled) {
    return completeAgent("phone_outreach", "idle", { campaign: input.campaign, messages: [], conversations: [] }, "Phone channel was not selected.", {
      roleId: input.role.id,
      inputSummary: "Phone not selected",
      outputSummary: "No phone scripts generated for this run.",
      reasoningSummary: "Skipped because the run configuration did not include Phone.",
      confidence: 1,
    });
  }

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const matchById = new Map(input.matches.map((match) => [match.candidateId, match]));
  const messages: OutreachResult[] = [];
  const conversations: Conversation[] = [];

  for (const candidateId of input.recommendedCandidateIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) continue;
    const match = matchById.get(candidate.id);
    const message = generatePhoneOpening(candidate, input.role.parsedJD, match);
    const turns = input.mode === "draft_only" ? [] : simulatePhoneTranscript(candidate, input.role.parsedJD, match);
    const fallbackTranscript = turns.length ? transcriptToText(turns) : undefined;
    const generatedTranscript = fallbackTranscript
      ? await generateAgentText({
          provider: input.provider,
          model: input.model,
          systemPrompt: "You are the Phone Outreach Agent for ScoutFlow AI. Generate realistic simulated recruiter call transcripts using only supplied facts.",
          userPrompt: [
            `Role: ${input.role.roleTitle}`,
            `Candidate: ${candidate.name}, ${candidate.currentTitle}, ${candidate.location}`,
            `Match score: ${match?.matchScore ?? "not scored"}`,
            `Candidate persona: ${candidate.persona.type}, availability ${candidate.persona.availability}`,
            `Opening script: ${message}`,
            "Return a short transcript with AI and Candidate speaker labels. Do not imply a real call occurred.",
          ].join("\n"),
          fallback: fallbackTranscript,
        })
      : undefined;
    const transcript = generatedTranscript?.text ?? fallbackTranscript;
    const providerUsed = generatedTranscript?.providerUsed ?? "local_fallback";
    const modelUsed = generatedTranscript?.modelUsed;
    const createdAt = new Date().toISOString();
    messages.push({
      id: makeId("phone"),
      roleId: input.role.id,
      campaignId: input.campaign.id,
      candidateId: candidate.id,
      channel: "phone",
      tone: "professional",
      message,
      phoneTranscript: transcript,
      providerUsed,
      modelUsed,
      providerError: generatedTranscript?.error,
      createdAt,
    });
    conversations.push({
      id: makeId("conversation"),
      campaignId: input.campaign.id,
      roleId: input.role.id,
      candidateId: candidate.id,
      channel: "phone",
      sentMessage: message,
      transcript,
      status: transcript ? "replied" : "draft",
      providerUsed,
      modelUsed,
      createdAt,
    });
  }
  const fallbackReasoning = `Prepared phone openings and simulated transcripts from the same role fit and candidate persona signals used for text outreach.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Phone Outreach Agent for ScoutFlow AI. Summarize phone script and transcript generation decisions.",
    userPrompt: `Summarize phone outreach reasoning. Role: ${input.role.roleTitle}. Candidates: ${input.recommendedCandidateIds.length}. Phone scripts: ${messages.length}. Mode: ${input.mode}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent(
    "phone_outreach",
    "completed",
    { campaign: input.campaign, messages, conversations },
    `Generated ${messages.length} phone outreach scripts${input.mode === "draft_only" ? "." : " and simulated transcripts."}`,
    {
      roleId: input.role.id,
      inputSummary: `${input.recommendedCandidateIds.length} candidates, phone selected`,
      outputSummary: `${messages.length} phone conversations prepared.`,
      reasoningSummary: reasoning.text,
      confidence: 0.82,
      providerUsed: reasoning.providerUsed,
      modelUsed: reasoning.modelUsed,
      logs: [
        ...conversations.slice(0, 8).map((conversation) => `Phone interest check: ${conversation.candidateId}`),
        `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
      ],
    },
  );
}
