import { NextResponse } from "next/server";
import {
  isResendConfigured,
  isTwilioSmsConfigured,
  isTwilioWhatsAppConfigured,
  sendEmailViaResend,
  sendSmsViaTwilio,
  sendWhatsAppViaTwilio,
} from "@/lib/messaging/providers";
import { upsertMessage } from "@/lib/messaging/store";
import type { OutreachResult } from "@/lib/types";

export const runtime = "nodejs";

interface SendRequest {
  message: OutreachResult;
  candidate: {
    name?: string;
    email?: string;
    phone?: string;
  };
  subject?: string;
}

export async function POST(request: Request) {
  let body: SendRequest;
  try {
    body = (await request.json()) as SendRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, candidate } = body;
  if (!message?.id || !message.channel) {
    return NextResponse.json({ error: "message.id and channel are required" }, { status: 400 });
  }

  // Persist a "sending" snapshot first so the UI can reflect the intent
  // even if the provider call fails immediately.
  await upsertMessage({
    ...message,
    deliveryStatus: "sending",
    events: [...(message.events ?? []), { status: "sending", timestamp: new Date().toISOString() }],
  });

  let providerResult;
  let humanError: string | undefined;

  if (message.channel === "email") {
    if (!candidate.email) humanError = "Candidate has no email address.";
    else if (!isResendConfigured()) humanError = "Resend is not configured. Set RESEND_API_KEY in .env.";
    else {
      providerResult = await sendEmailViaResend({
        to: candidate.email,
        toName: candidate.name,
        subject: body.subject ?? message.subject ?? `Opportunity for ${candidate.name ?? "you"}`,
        body: message.message,
        replyTo: process.env.RESEND_REPLY_TO,
        messageId: message.id,
        campaignId: message.campaignId,
      });
    }
  } else if (message.channel === "sms") {
    if (!candidate.phone) humanError = "Candidate has no phone number.";
    else if (!isTwilioSmsConfigured()) humanError = "Twilio SMS is not configured.";
    else {
      providerResult = await sendSmsViaTwilio({
        to: candidate.phone,
        body: message.message,
        messageId: message.id,
        campaignId: message.campaignId,
      });
    }
  } else if (message.channel === "whatsapp") {
    if (!candidate.phone) humanError = "Candidate has no phone number.";
    else if (!isTwilioWhatsAppConfigured()) humanError = "Twilio WhatsApp is not configured.";
    else {
      providerResult = await sendWhatsAppViaTwilio({
        to: candidate.phone,
        body: message.message,
        messageId: message.id,
        campaignId: message.campaignId,
      });
    }
  } else {
    humanError = `Channel "${message.channel}" cannot be sent automatically. Use email, sms, or whatsapp.`;
  }

  if (!providerResult) {
    const failed = await upsertMessage({
      ...message,
      deliveryStatus: "failed",
      providerError: humanError,
      events: [
        ...(message.events ?? []),
        { status: "failed", timestamp: new Date().toISOString(), detail: humanError },
      ],
    });
    return NextResponse.json({ ok: false, error: humanError, message: failed }, { status: 400 });
  }

  const updated = await upsertMessage({
    ...message,
    deliveryStatus: providerResult.status,
    deliveryProvider: providerResult.provider,
    providerMessageId: providerResult.providerMessageId,
    providerError: providerResult.error,
    sentAt: providerResult.ok ? new Date().toISOString() : undefined,
    events: [
      ...(message.events ?? []),
      {
        status: providerResult.status,
        timestamp: new Date().toISOString(),
        detail: providerResult.providerMessageId ? `provider id ${providerResult.providerMessageId}` : providerResult.error,
      },
    ],
  });

  return NextResponse.json({ ok: providerResult.ok, message: updated, provider: providerResult });
}
