import { NextResponse } from "next/server";
import { runInterestDetectionAgent } from "@/lib/agents/interestAgent";
import { runOutreachAgent } from "@/lib/agents/outreachAgent";
import { runPhoneOutreachAgent } from "@/lib/agents/phoneAgent";
import type { AgentLlmProvider } from "@/lib/agents/types";
import type {
  AudienceType,
  CandidateProfile,
  Channel,
  InterestResult,
  MatchResult,
  OutreachCampaign,
  OutreachMode,
  OutreachTone,
  RolePipeline,
} from "@/lib/types";

export const runtime = "nodejs";

interface OutreachRunRequest {
  role: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  existingInterest: InterestResult[];
  candidateIds: string[];
  channels: Channel[];
  tone?: OutreachTone;
  mode?: OutreachMode;
  audienceType?: AudienceType;
  segmentId?: string;
  provider?: AgentLlmProvider;
  model?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OutreachRunRequest;
    if (!body.role?.id) {
      return NextResponse.json({ error: "role is required" }, { status: 400 });
    }
    if (!body.candidateIds?.length) {
      return NextResponse.json({ error: "candidateIds are required" }, { status: 400 });
    }
    if (!body.channels?.length) {
      return NextResponse.json({ error: "channels are required" }, { status: 400 });
    }

    const mode = body.mode ?? "draft_only";
    const tone = body.tone ?? "professional";
    const textChannels = body.channels.filter((channel) => channel !== "phone");

    const outreachStep = await runOutreachAgent({
      role: body.role,
      candidates: body.candidates ?? [],
      matches: body.matches ?? [],
      recommendedCandidateIds: body.candidateIds,
      channels: textChannels,
      mode,
      tone,
      provider: body.provider ?? "auto",
      model: body.model,
    });

    const phoneStep = await runPhoneOutreachAgent({
      role: body.role,
      candidates: body.candidates ?? [],
      matches: body.matches ?? [],
      recommendedCandidateIds: body.candidateIds,
      enabled: body.channels.includes("phone"),
      campaign: outreachStep.output.campaign,
      mode,
      provider: body.provider ?? "auto",
      model: body.model,
    });

    const combinedCampaign: OutreachCampaign = {
      ...outreachStep.output.campaign,
      name: `${body.role.roleTitle} engagement campaign`,
      audienceType: body.audienceType ?? "selected_candidates",
      segmentId: body.segmentId || undefined,
      candidateIds: body.candidateIds,
      channels: body.channels,
      tone,
      messages: [...outreachStep.output.messages, ...phoneStep.output.messages],
      conversations: [...outreachStep.output.conversations, ...phoneStep.output.conversations],
      status: mode === "draft_only" ? "generated" : "replies_generated",
      agentActivity: [outreachStep.activity, phoneStep.activity],
      providerUsed: outreachStep.activity.providerUsed ?? phoneStep.activity.providerUsed,
      modelUsed: outreachStep.activity.modelUsed ?? phoneStep.activity.modelUsed,
    };

    let interestResults: InterestResult[] = [];
    let conversations = combinedCampaign.conversations ?? [];
    const agentActivity = [outreachStep.activity, phoneStep.activity];

    if (mode !== "draft_only") {
      const interestStep = await runInterestDetectionAgent({
        role: body.role,
        candidates: body.candidates ?? [],
        matches: body.matches ?? [],
        campaign: combinedCampaign,
        existingInterest: body.existingInterest ?? [],
        mode,
        provider: body.provider ?? "auto",
        model: body.model,
      });
      agentActivity.push(interestStep.activity);
      interestResults = interestStep.output.interestResults.filter((interest) => body.candidateIds.includes(interest.candidateId));
      conversations = interestStep.output.conversations;
    }

    const campaign: OutreachCampaign = {
      ...combinedCampaign,
      conversations,
      interestResults,
      agentActivity,
      status: getCampaignStatus(combinedCampaign, interestResults),
    };

    return NextResponse.json({
      campaign,
      outreachResults: campaign.messages,
      interestResults,
      conversations,
      agentActivity,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach Agent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getCampaignStatus(campaign: OutreachCampaign, interestResults: InterestResult[]): OutreachCampaign["status"] {
  if (!campaign.conversations?.length) return "generated";
  if (!campaign.conversations.some((conversation) => conversation.reply || conversation.transcript)) return "generated";
  if (interestResults.some((interest) => interest.interestScore >= 75)) return "interested";
  if (campaign.conversations.some((conversation) => conversation.status === "follow_up_needed")) return "follow_up_needed";
  if (campaign.conversations.some((conversation) => conversation.status === "not_interested")) return "not_interested";
  return "replied";
}
