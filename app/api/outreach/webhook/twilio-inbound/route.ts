import { NextResponse } from "next/server";
import { listMessages, recordEvent, upsertMessage } from "@/lib/messaging/store";

export const runtime = "nodejs";

/**
 * Twilio inbound message webhook.
 *
 * For SMS configure the Messaging Service / phone number with this URL.
 * For WhatsApp configure the sandbox / sender with this URL.
 *
 * We correlate replies to the most recent outbound message we sent to the
 * same phone number on the same channel.
 */
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    const body = await request.text();
    form = new URLSearchParams(body);
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const fromRaw = form.get("From") ?? "";
  const body = form.get("Body") ?? "";
  if (!fromRaw || !body) return new NextResponse("missing fields", { status: 400 });

  const channel = fromRaw.startsWith("whatsapp:") ? "whatsapp" : "sms";
  const phone = fromRaw.replace(/^whatsapp:/, "").trim();

  // Find the most recent outbound message to this candidate for this channel.
  const all = await listMessages();
  const candidates = all
    .filter((message) => message.channel === channel)
    .filter((message) => Boolean(message.providerMessageId || message.sentAt))
    .filter((message) => {
      // Loose match - the candidate phone may be normalized differently.
      const target = (message as { _candidatePhone?: string })._candidatePhone;
      return target ? matchesPhone(target, phone) : true;
    })
    .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt));

  const target = candidates[0];
  if (!target?.id) {
    // No matching outbound message; still record an inbound-only entry so it
    // shows up in the recruiter's queue.
    const id = `inbound-${Date.now().toString(36)}`;
    await upsertMessage({
      id,
      candidateId: "unknown",
      channel,
      tone: "professional",
      message: "",
      reply: body,
      repliedAt: new Date().toISOString(),
      deliveryStatus: "replied",
      deliveryProvider: channel === "whatsapp" ? "twilio_whatsapp" : "twilio_sms",
      providerMessageId: form.get("MessageSid") ?? undefined,
      createdAt: new Date().toISOString(),
      events: [{ status: "replied", timestamp: new Date().toISOString(), detail: `inbound from ${phone}` }],
    });
    return new NextResponse("ok", { headers: { "Content-Type": "text/plain" } });
  }

  await recordEvent(
    { id: target.id },
    "replied",
    `inbound from ${phone}`,
    { reply: body },
  );

  return new NextResponse("ok", { headers: { "Content-Type": "text/plain" } });
}

function matchesPhone(a: string, b: string): boolean {
  const norm = (value: string) => value.replace(/[^\d]/g, "").slice(-10);
  return norm(a) === norm(b);
}
