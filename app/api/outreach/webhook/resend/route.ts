import { NextResponse } from "next/server";
import { mapResendEvent } from "@/lib/messaging/providers";
import { recordEvent } from "@/lib/messaging/store";

export const runtime = "nodejs";

interface ResendWebhookPayload {
  type?: string;
  data?: {
    email_id?: string;
    tags?: Array<{ name: string; value: string }>;
  };
}

export async function POST(request: Request) {
  let payload: ResendWebhookPayload;
  try {
    payload = (await request.json()) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.type ?? "";
  const status = mapResendEvent(eventType);
  if (!status) return NextResponse.json({ ok: true, ignored: eventType });

  const messageIdTag = payload.data?.tags?.find((tag) => tag.name === "scoutflow_message_id")?.value;
  const providerMessageId = payload.data?.email_id;

  await recordEvent(
    { id: messageIdTag, providerMessageId },
    status,
    eventType,
  );

  return NextResponse.json({ ok: true });
}
