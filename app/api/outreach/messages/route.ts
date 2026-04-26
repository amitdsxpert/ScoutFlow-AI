import { NextResponse } from "next/server";
import { listMessages } from "@/lib/messaging/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roleId = searchParams.get("roleId") ?? undefined;
  const campaignId = searchParams.get("campaignId") ?? undefined;
  const candidateId = searchParams.get("candidateId") ?? undefined;
  const messages = await listMessages({ roleId, campaignId, candidateId });
  return NextResponse.json({ messages });
}
