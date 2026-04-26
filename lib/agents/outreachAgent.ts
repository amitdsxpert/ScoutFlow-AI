import { buildOutreachPrompt, generateOutreachMessage } from "@/lib/outreach";
import { makeId } from "@/lib/roles";
import { simulateReply } from "@/lib/simulation";
import type {
  CandidateProfile,
  Channel,
  Conversation,
  MatchResult,
  OutreachCampaign,
  OutreachMode,
  OutreachResult,
  OutreachTone,
  RolePipeline,
} from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface OutreachOutput {
  campaign: OutreachCampaign;
  messages: OutreachResult[];
  conversations: Conversation[];
}

export function runOutreachAgent(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  recommendedCandidateIds: string[];
  channels: Channel[];
  mode: OutreachMode;
  tone?: OutreachTone;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<OutreachOutput>> {
  return runOutreach(input);
}

async function runOutreach(input: {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  recommendedCandidateIds: string[];
  channels: Channel[];
  mode: OutreachMode;
  tone?: OutreachTone;
  provider?: AgentLlmProvider;
  model?: string;
}): Promise<AgentExecutionResult<OutreachOutput>> {
  const campaignId = makeId("campaign");
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const matchById = new Map(input.matches.map((match) => [match.candidateId, match]));
  const messages: OutreachResult[] = [];
  const conversations: Conversation[] = [];
  const tone = input.tone ?? "professional";

  for (const candidateId of input.recommendedCandidateIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) continue;
    for (const channel of input.channels) {
      const match = matchById.get(candidate.id);
      const fallback = generateOutreachMessage(candidate, input.role.parsedJD, match, channel, tone);
      const generated = await generateAgentText({
        provider: input.provider,
        model: input.model,
        systemPrompt: "You are the Outreach Agent for ScoutFlow AI. Write concise recruiting outreach using only supplied role and candidate facts.",
        userPrompt: buildOutreachPrompt(candidate, input.role.parsedJD, match, channel, tone),
        fallback,
      });
      const message = generated.text;
      const reply = input.mode === "draft_only" ? undefined : simulateReply(candidate, input.role.parsedJD, match);
      const status = reply ? conversationStatusFromReply(reply) : "draft";
      const createdAt = new Date().toISOString();
      const outreachResult: OutreachResult = {
        id: makeId("message"),
        roleId: input.role.id,
        campaignId,
        candidateId: candidate.id,
        channel,
        tone,
        message,
        simulatedReply: reply,
        providerUsed: generated.providerUsed,
        modelUsed: generated.modelUsed,
        providerError: generated.error,
        createdAt,
      };
      messages.push(outreachResult);
      conversations.push({
        id: makeId("conversation"),
        campaignId,
        roleId: input.role.id,
        candidateId: candidate.id,
        channel,
        sentMessage: message,
        reply,
        status,
        providerUsed: generated.providerUsed,
        modelUsed: generated.modelUsed,
        createdAt,
      });
    }
  }

  const campaign: OutreachCampaign = {
    id: campaignId,
    roleId: input.role.id,
    name: `${input.role.roleTitle} outreach campaign`,
    audienceType: "top_recommended",
    candidateIds: input.recommendedCandidateIds,
    channels: input.channels,
    tone,
    createdAt: new Date().toISOString(),
    status: input.mode === "draft_only" ? "generated" : "replies_generated",
    messages,
    conversations,
    interestResults: [],
  };
  const fallbackReasoning = input.channels.length
    ? `Generated channel-specific outreach from deterministic templates using role title, matched skills, candidate background, and simulated reply personas.`
    : `No text outreach channels were selected; phone outreach can still run in the next agent.`;
  const reasoning = await generateAgentText({
    provider: input.provider,
    model: input.model,
    systemPrompt: "You are the Outreach Agent for ScoutFlow AI. Summarize outreach generation decisions without claiming real delivery.",
    userPrompt: `Summarize outreach generation reasoning. Role: ${input.role.roleTitle}. Candidates: ${input.recommendedCandidateIds.length}. Channels: ${input.channels.join(", ") || "none"}. Messages: ${messages.length}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("outreach", "completed", { campaign, messages, conversations }, `Generated ${messages.length} outreach drafts across ${input.channels.length} text channels.`, {
    roleId: input.role.id,
    inputSummary: `${input.recommendedCandidateIds.length} candidates, channels ${input.channels.join(", ") || "none"}`,
    outputSummary: `${messages.length} messages generated.`,
    reasoningSummary: reasoning.text,
    confidence: input.channels.length ? 0.84 : 0.72,
    providerUsed: reasoning.providerUsed,
    modelUsed: reasoning.modelUsed,
    logs: [
      ...messages.slice(0, 8).map((message) => `${message.channel}: ${message.candidateId}`),
      `Reasoning source: ${reasoning.usedFallback ? "deterministic fallback" : reasoning.providerUsed}`,
    ],
  });
}

function conversationStatusFromReply(reply: string): Conversation["status"] {
  const normalized = reply.toLowerCase();
  if (normalized.includes("not exploring") || normalized.includes("not interested") || normalized.includes("happy in my current")) return "not_interested";
  if (normalized.includes("this week") || normalized.includes("slots") || normalized.includes("open to a call")) return "interested";
  if (normalized.includes("compensation") || normalized.includes("share more")) return "follow_up_needed";
  return "replied";
}
