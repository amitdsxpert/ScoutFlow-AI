import { NextResponse } from "next/server";
import { runJDIntelligenceFromInput } from "@/lib/agents/jdAgent";
import type { RolePipeline, RoleStatus } from "@/lib/types";
import type { AgentLlmProvider } from "@/lib/agents/types";

export const runtime = "nodejs";

interface JDRequest {
  rawInput?: string;
  mode?: "parse" | "generate";
  status?: RoleStatus;
  existingRole?: RolePipeline;
  provider?: AgentLlmProvider;
  model?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as JDRequest;
    if (!body.rawInput?.trim()) {
      return NextResponse.json({ error: "rawInput is required" }, { status: 400 });
    }

    const result = await runJDIntelligenceFromInput({
      rawInput: body.rawInput,
      mode: body.mode ?? "parse",
      status: body.status,
      existingRole: body.existingRole,
      provider: body.provider ?? "auto",
      model: body.model,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JD Intelligence Agent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
