import type { OutreachCampaign, RankedCandidate, RolePipeline } from "@/lib/types";
import { completeAgent, type AgentExecutionResult } from "./types";

export function runExportAgent(input: {
  role: RolePipeline;
  rankedShortlist: RankedCandidate[];
  campaign: OutreachCampaign;
}): AgentExecutionResult<string> {
  const output = `Prepared export package for ${input.role.roleTitle}: ${input.rankedShortlist.length} ranked rows, ${input.campaign.messages.length} messages, ${input.campaign.conversations?.length ?? 0} conversations.`;

  return completeAgent("export", "completed", output, output, {
    roleId: input.role.id,
    inputSummary: `${input.role.roleTitle} workspace package`,
    outputSummary: output,
    logs: ["CSV shortlist ready", "Workspace JSON ready", "Campaign report ready"],
  });
}
