/**
 * Real messaging providers for outreach delivery.
 *
 * - Email: Resend (https://resend.com)
 *   - Webhook events for delivery / opens / bounces.
 * - SMS / WhatsApp: Twilio (https://twilio.com)
 *   - Status callback for delivery state.
 *   - Inbound webhook for replies.
 *
 * Replies are written back to the message store via webhook routes
 * (app/api/outreach/webhook/...).
 */

import type { MessageDeliveryProvider, MessageDeliveryStatus } from "@/lib/types";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  provider: MessageDeliveryProvider;
  status: MessageDeliveryStatus;
  error?: string;
}

export interface SendEmailInput {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  replyTo?: string;
  campaignId?: string;
  messageId: string; // ScoutFlow message id, included as a tag for webhook correlation
}

export interface SendSmsInput {
  to: string;
  body: string;
  messageId: string;
  campaignId?: string;
}

export interface SendWhatsAppInput extends SendSmsInput {}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function isTwilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function isTwilioSmsConfigured(): boolean {
  return isTwilioConfigured() && Boolean(process.env.TWILIO_SMS_FROM);
}

export function isTwilioWhatsAppConfigured(): boolean {
  return isTwilioConfigured() && Boolean(process.env.TWILIO_WHATSAPP_FROM);
}

export async function sendEmailViaResend(input: SendEmailInput): Promise<SendResult> {
  if (!isResendConfigured()) {
    return { ok: false, provider: "resend", status: "failed", error: "RESEND_API_KEY missing" };
  }

  const from = process.env.RESEND_FROM || "ScoutFlow <onboarding@resend.dev>";
  const html = `<div style="font-family:sans-serif;line-height:1.6;color:#0f172a">${escapeHtml(input.body).replace(/\n/g, "<br/>")}</div>`;
  // Lowercase the address part so it matches Resend account email exactly
  // (their sandbox does a literal string compare).
  const normalizedTo = input.to.trim().toLowerCase();
  const recipient = input.toName ? `${input.toName} <${normalizedTo}>` : normalizedTo;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: input.subject,
        html,
        text: input.body,
        reply_to: input.replyTo,
        // Tags let the webhook correlate events back to our message id.
        tags: [
          { name: "scoutflow_message_id", value: input.messageId },
          ...(input.campaignId ? [{ name: "scoutflow_campaign_id", value: input.campaignId }] : []),
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "");
      return { ok: false, provider: "resend", status: "failed", error: `Resend ${response.status}: ${error.slice(0, 200)}` };
    }

    const data = (await response.json()) as { id?: string };
    return {
      ok: true,
      provider: "resend",
      status: "sent",
      providerMessageId: data.id,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "resend",
      status: "failed",
      error: error instanceof Error ? error.message : "Resend request failed",
    };
  }
}

export async function sendSmsViaTwilio(input: SendSmsInput): Promise<SendResult> {
  return sendTwilio({
    ...input,
    from: process.env.TWILIO_SMS_FROM,
    provider: "twilio_sms",
    channel: "sms",
  });
}

export async function sendWhatsAppViaTwilio(input: SendWhatsAppInput): Promise<SendResult> {
  return sendTwilio({
    ...input,
    from: process.env.TWILIO_WHATSAPP_FROM,
    provider: "twilio_whatsapp",
    channel: "whatsapp",
  });
}

async function sendTwilio(input: {
  to: string;
  body: string;
  messageId: string;
  from?: string;
  provider: "twilio_sms" | "twilio_whatsapp";
  channel: "sms" | "whatsapp";
}): Promise<SendResult> {
  if (!isTwilioConfigured()) {
    return { ok: false, provider: input.provider, status: "failed", error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing" };
  }
  if (!input.from) {
    return {
      ok: false,
      provider: input.provider,
      status: "failed",
      error: input.channel === "whatsapp" ? "TWILIO_WHATSAPP_FROM missing" : "TWILIO_SMS_FROM missing",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const to = input.channel === "whatsapp" ? `whatsapp:${normalizePhone(input.to)}` : normalizePhone(input.to);
  const from = input.channel === "whatsapp" && !input.from.startsWith("whatsapp:") ? `whatsapp:${input.from}` : input.from;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", from);
  params.set("Body", input.body);
  if (process.env.PUBLIC_BASE_URL) {
    params.set("StatusCallback", `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/outreach/webhook/twilio-status?messageId=${encodeURIComponent(input.messageId)}`);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "");
      return { ok: false, provider: input.provider, status: "failed", error: `Twilio ${response.status}: ${error.slice(0, 300)}` };
    }

    const data = (await response.json()) as { sid?: string; status?: string };
    return {
      ok: true,
      provider: input.provider,
      status: mapTwilioStatus(data.status) ?? "queued",
      providerMessageId: data.sid,
    };
  } catch (error) {
    return {
      ok: false,
      provider: input.provider,
      status: "failed",
      error: error instanceof Error ? error.message : "Twilio request failed",
    };
  }
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  return `+${trimmed.replace(/[^\d]/g, "")}`;
}

export function mapTwilioStatus(status: string | undefined): MessageDeliveryStatus | undefined {
  if (!status) return undefined;
  switch (status) {
    case "queued":
    case "accepted":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "received":
      return "replied";
    case "failed":
    case "undelivered":
      return "failed";
    default:
      return undefined;
  }
}

export function mapResendEvent(eventType: string): MessageDeliveryStatus | undefined {
  switch (eventType) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.clicked":
      return "clicked";
    case "email.bounced":
    case "email.complained":
      return "bounced";
    case "email.delivery_delayed":
      return "queued";
    default:
      return undefined;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
