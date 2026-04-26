import { NextResponse } from "next/server";
import { runScoutFlowAgents } from "@/lib/agents/orchestrator";
import type { CandidateProfile, InterestResult, OutreachCampaign, RolePipeline, ScoutFlowRunOptions } from "@/lib/types";

export const runtime = "nodejs";

interface AgentRunRequest {
  roles: RolePipeline[];
  candidates: CandidateProfile[];
  interestResults: InterestResult[];
  outreachCampaigns: OutreachCampaign[];
  options: ScoutFlowRunOptions;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AgentRunRequest;
    const result = await runScoutFlowAgents({
      roles: body.roles ?? [],
      candidates: body.candidates ?? [],
      interestResults: body.interestResults ?? [],
      outreachCampaigns: body.outreachCampaigns ?? [],
      options: body.options,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
