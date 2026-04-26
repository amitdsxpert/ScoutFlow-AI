import { NextResponse } from "next/server";
import { mapTwilioStatus } from "@/lib/messaging/providers";
import { recordEvent } from "@/lib/messaging/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId") ?? undefined;

  // Twilio sends application/x-www-form-urlencoded
  let form: URLSearchParams;
  try {
    const body = await request.text();
    form = new URLSearchParams(body);
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const providerMessageId = form.get("MessageSid") ?? form.get("SmsSid") ?? undefined;
  const status = mapTwilioStatus(form.get("MessageStatus") ?? form.get("SmsStatus") ?? undefined);
  if (!status) return NextResponse.json({ ok: true, ignored: form.get("MessageStatus") });

  await recordEvent(
    { id: messageId, providerMessageId: providerMessageId ?? undefined },
    status,
    `twilio:${form.get("MessageStatus") ?? form.get("SmsStatus") ?? ""}`,
    {
      providerError: form.get("ErrorMessage") ?? undefined,
    },
  );

  return new NextResponse("ok", { headers: { "Content-Type": "text/plain" } });
}
