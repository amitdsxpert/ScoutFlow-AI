import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/messaging/store";

export const runtime = "nodejs";

interface LogReplyRequest {
  messageId: string;
  reply: string;
  source?: string;
}

/**
 * Manually attach a reply to a message. Useful when the recruiter receives
 * the candidate's response in their own inbox / LinkedIn / etc and wants to
 * pull it into ScoutFlow for tracking and interest scoring.
 */
export async function POST(request: Request) {
  let body: LogReplyRequest;
  try {
    body = (await request.json()) as LogReplyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.messageId || !body.reply?.trim()) {
    return NextResponse.json({ error: "messageId and reply are required" }, { status: 400 });
  }

  const updated = await recordEvent(
    { id: body.messageId },
    "replied",
    `manual: ${body.source ?? "recruiter inbox"}`,
    { reply: body.reply.trim() },
  );

  if (!updated) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: updated });
}
