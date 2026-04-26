import { activityToAgentState, initialAgentStates } from "@/lib/agents";
import { ensureCandidateIdentifier, ensureRoleIdentifiers } from "@/lib/identity";
import { defaultRolePipeline, updateRoleMatches } from "@/lib/roles";
import type {
  AgentActivity,
  AgentModuleState,
  CandidateProfile,
  Conversation,
  InterestResult,
  OutreachCampaign,
  RankedCandidate,
  ScoutFlowRunResult,
  RolePipeline,
} from "@/lib/types";
import { runExportAgent } from "./exportAgent";
import { runInterestDetectionAgent } from "./interestAgent";
import { runJDIntelligenceAgent } from "./jdAgent";
import { runCandidateMatchingAgent } from "./matchingAgent";
import { runOutreachAgent } from "./outreachAgent";
import { runPhoneOutreachAgent } from "./phoneAgent";
import { runRankingAgent } from "./rankingAgent";
import { runRecommendationAgent } from "./recommendationAgent";
import { runResumeParsingAgent } from "./resumeAgent";
import { runSourceDiscoveryAgent } from "./sourceAgent";
import type { ScoutFlowAgentRunCommand } from "./types";

interface WorkspaceOrchestratorInput {
  roles: RolePipeline[];
  candidates: CandidateProfile[];
  interestResults: InterestResult[];
  outreachCampaigns: OutreachCampaign[];
  options: ScoutFlowAgentRunCommand;
  onStep?: (activity: AgentActivity) => void | Promise<void>;
}

type OrchestratorInput = WorkspaceOrchestratorInput | ScoutFlowAgentRunCommand;

export async function runScoutFlowAgents(input: OrchestratorInput): Promise<ScoutFlowRunResult> {
  const workspaceInput = normalizeOrchestratorInput(input);
  const activities: AgentActivity[] = [];
  const role = workspaceInput.roles.find((item) => item.id === workspaceInput.options.roleId) ?? workspaceInput.roles[0];

  if (!role) {
    throw new Error("No role available for ScoutFlow agent run.");
  }

  const selectedSources = workspaceInput.options.selectedSources ?? workspaceInput.options.sourceIds ?? ["demo"];
  const selectedChannels = workspaceInput.options.selectedChannels ?? workspaceInput.options.channels ?? ["email"];
  const optimizationFocus = workspaceInput.options.optimizationFocus ?? "balanced";
  const outreachMode = workspaceInput.options.outreachMode ?? "simulate_send_and_replies";
  const provider = workspaceInput.options.provider ?? "auto";
  const model = workspaceInput.options.model;
  const candidateLimit = Math.max(1, workspaceInput.options.candidateLimit || 10);
  const notify = async (activity: AgentActivity) => {
    if (!workspaceInput.onStep) return;
    await workspaceInput.onStep(activity);
    await pause(140);
  };

  const jdStep = await runJDIntelligenceAgent(role, provider, model);
  activities.push(jdStep.activity);
  await notify(jdStep.activity);
  const roleForRun = jdStep.output.role;

  const sourceStep = await runSourceDiscoveryAgent({
    existingCandidates: workspaceInput.candidates,
    selectedSources,
    roleId: role.id,
    provider,
    model,
  });
  activities.push(sourceStep.activity);
  await notify(sourceStep.activity);

  const resumeStep = await runResumeParsingAgent({
    candidates: sourceStep.output.candidates,
    selectedSources,
    roleId: role.id,
    provider,
    model,
  });
  activities.push(resumeStep.activity);
  await notify(resumeStep.activity);

  const matchingStep = await runCandidateMatchingAgent({
    role: roleForRun,
    candidates: resumeStep.output.candidates,
    provider,
    model,
  });
  activities.push(matchingStep.activity);
  await notify(matchingStep.activity);

  const recommendationStep = await runRecommendationAgent({
    matches: matchingStep.output,
    candidates: resumeStep.output.candidates,
    existingInterest: workspaceInput.interestResults.filter((interest) => interest.roleId === role.id),
    limit: candidateLimit,
    focus: optimizationFocus,
    roleId: role.id,
    provider,
    model,
  });
  activities.push(recommendationStep.activity);
  await notify(recommendationStep.activity);

  const textChannels = selectedChannels.filter((channel) => channel !== "phone");
  const outreachStep = await runOutreachAgent({
    role: roleForRun,
    candidates: resumeStep.output.candidates,
    matches: matchingStep.output,
    recommendedCandidateIds: recommendationStep.output.recommendedCandidateIds,
    channels: textChannels,
    mode: outreachMode,
    tone: "professional",
    provider,
    model,
  });
  activities.push(outreachStep.activity);
  await notify(outreachStep.activity);

  const phoneStep = await runPhoneOutreachAgent({
    role: roleForRun,
    candidates: resumeStep.output.candidates,
    matches: matchingStep.output,
    recommendedCandidateIds: recommendationStep.output.recommendedCandidateIds,
    enabled: selectedChannels.includes("phone"),
    campaign: outreachStep.output.campaign,
    mode: outreachMode,
    provider,
    model,
  });
  activities.push(phoneStep.activity);
  await notify(phoneStep.activity);

  const combinedCampaign: OutreachCampaign = {
    ...outreachStep.output.campaign,
    channels: selectedChannels,
    messages: [...outreachStep.output.messages, ...phoneStep.output.messages],
    conversations: [...outreachStep.output.conversations, ...phoneStep.output.conversations],
  };

  const interestStep = await runInterestDetectionAgent({
    role: roleForRun,
    candidates: resumeStep.output.candidates,
    matches: matchingStep.output,
    campaign: combinedCampaign,
    existingInterest: workspaceInput.interestResults,
    mode: outreachMode,
    provider,
    model,
  });
  activities.push(interestStep.activity);
  await notify(interestStep.activity);

  combinedCampaign.interestResults = interestStep.output.interestResults.filter((interest) => combinedCampaign.candidateIds.includes(interest.candidateId));
  combinedCampaign.conversations = interestStep.output.conversations;
  combinedCampaign.status = getCampaignStatus(combinedCampaign);

  const rankingStep = await runRankingAgent({
    role: roleForRun,
    candidates: resumeStep.output.candidates,
    matches: matchingStep.output,
    interestResults: interestStep.output.interestResults,
    recommendedCandidateIds: recommendationStep.output.recommendedCandidateIds,
    provider,
    model,
  });
  activities.push(rankingStep.activity);
  await notify(rankingStep.activity);

  const exportStep = runExportAgent({
    role: roleForRun,
    rankedShortlist: rankingStep.output.rankedShortlist,
    campaign: combinedCampaign,
  });
  activities.push(exportStep.activity);
  await notify(exportStep.activity);

  const agentRunLogs = [
    jdStep.runLog,
    sourceStep.runLog,
    resumeStep.runLog,
    matchingStep.runLog,
    recommendationStep.runLog,
    outreachStep.runLog,
    phoneStep.runLog,
    interestStep.runLog,
    rankingStep.runLog,
    exportStep.runLog,
  ];

  const updatedRoles = workspaceInput.roles.map((item) => {
    if (item.id !== role.id) return item;
    return {
      ...updateRoleMatches({ ...roleForRun, agentLogs: agentRunLogs }, matchingStep.output),
      shortlist: rankingStep.output.shortlistIds,
      outreachCampaigns: Array.from(new Set([combinedCampaign.id, ...item.outreachCampaigns])),
      updatedAt: new Date().toISOString(),
    };
  });

  const allInterest = [
    ...interestStep.output.interestResults,
    ...workspaceInput.interestResults.filter((interest) => !(interest.roleId === role.id && interestStep.output.interestResults.some((item) => item.candidateId === interest.candidateId))),
  ];

  return {
    roles: updatedRoles.map(ensureRoleIdentifiers),
    candidates: updateCandidateStatuses(resumeStep.output.candidates, recommendationStep.output.recommendedCandidateIds, rankingStep.output.shortlistIds, interestStep.output.interestResults).map(ensureCandidateIdentifier),
    matchResults: matchingStep.output,
    recommendedCandidateIds: recommendationStep.output.recommendedCandidateIds,
    campaign: combinedCampaign.messages.length || combinedCampaign.conversations?.length ? combinedCampaign : undefined,
    outreachResults: combinedCampaign.messages,
    interestResults: allInterest,
    rankedShortlist: rankingStep.output.rankedShortlist,
    agentActivity: activities,
    agentStates: mergeAgentStates(initialAgentStates(), activities),
    agentRunLogs,
    exportSummary: exportStep.output,
  };
}

function normalizeOrchestratorInput(input: OrchestratorInput): WorkspaceOrchestratorInput {
  if ("options" in input) {
    return {
      ...input,
      roles: input.roles.map(ensureRoleIdentifiers),
      candidates: input.candidates.map(ensureCandidateIdentifier),
    };
  }

  const role = ensureRoleIdentifiers({ ...defaultRolePipeline(), id: input.roleId });
  return {
    roles: [role],
    candidates: [],
    interestResults: [],
    outreachCampaigns: [],
    options: input,
  };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCampaignStatus(campaign: OutreachCampaign): OutreachCampaign["status"] {
  const conversations = campaign.conversations ?? [];
  if (!conversations.length) return "generated";
  if (conversations.some((conversation) => conversation.status === "interested")) return "interested";
  if (conversations.some((conversation) => conversation.status === "follow_up_needed")) return "follow_up_needed";
  if (conversations.some((conversation) => conversation.status === "not_interested")) return "not_interested";
  if (conversations.some((conversation) => conversation.reply || conversation.transcript)) return "replied";
  return "simulated_sent";
}

function mergeAgentStates(base: AgentModuleState[], activities: AgentActivity[]): AgentModuleState[] {
  const byId = new Map(base.map((state) => [state.id, state]));
  activities.forEach((activity) => byId.set(activity.agentId, activityToAgentState(activity)));
  return Array.from(byId.values());
}

function updateCandidateStatuses(candidates: CandidateProfile[], recommendedIds: string[], shortlistIds: string[], interests: InterestResult[]): CandidateProfile[] {
  const recommended = new Set(recommendedIds);
  const shortlisted = new Set(shortlistIds);
  const interestById = new Map(interests.map((interest) => [interest.candidateId, interest]));

  return candidates.map((candidate) => {
    const interest = interestById.get(candidate.id);
    const status = shortlisted.has(candidate.id)
      ? "shortlisted"
      : interest && interest.interestScore >= 75
        ? "interested"
        : interest
          ? "replied"
          : recommended.has(candidate.id)
            ? "recommended"
            : candidate.status ?? "new";

    return ensureCandidateIdentifier({
      ...candidate,
      status,
      segments: Array.from(new Set([
        ...(candidate.segments ?? []),
        ...(recommended.has(candidate.id) ? ["recommended"] : []),
        ...(shortlisted.has(candidate.id) ? ["shortlisted"] : []),
      ])),
    });
  });
}

export type { AgentRunLog, AgentStatus, ScoutFlowAgentRunCommand } from "./types";
export type { Conversation, RankedCandidate };
