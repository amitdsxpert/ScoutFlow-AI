/**
 * Server-side outreach message store.
 *
 * Persists OutreachResult records to data/outreach-messages.json so that
 * webhook callbacks (delivery status, replies) can update them across
 * Next.js dev/server reloads.
 *
 * Lookups by:
 *  - id (ScoutFlow internal)
 *  - providerMessageId (Resend / Twilio sid)
 */

import { promises as fs } from "fs";
import path from "path";
import type {
  MessageDeliveryEvent,
  MessageDeliveryStatus,
  OutreachResult,
} from "@/lib/types";

const STORE_PATH = path.join(process.cwd(), "data", "outreach-messages.json");

interface StoreShape {
  version: 1;
  messages: OutreachResult[];
}

let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.messages)) {
      return { version: 1, messages: [] };
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, messages: [] };
    }
    return { version: 1, messages: [] };
  }
}

async function writeStore(state: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listMessages(filter?: { roleId?: string; campaignId?: string; candidateId?: string }): Promise<OutreachResult[]> {
  const state = await readStore();
  if (!filter) return state.messages;
  return state.messages.filter((message) => {
    if (filter.roleId && message.roleId !== filter.roleId) return false;
    if (filter.campaignId && message.campaignId !== filter.campaignId) return false;
    if (filter.candidateId && message.candidateId !== filter.candidateId) return false;
    return true;
  });
}

export async function getMessageById(id: string): Promise<OutreachResult | undefined> {
  const state = await readStore();
  return state.messages.find((message) => message.id === id);
}

export async function getMessageByProviderId(providerMessageId: string): Promise<OutreachResult | undefined> {
  const state = await readStore();
  return state.messages.find((message) => message.providerMessageId === providerMessageId);
}

export async function upsertMessage(message: OutreachResult): Promise<OutreachResult> {
  return enqueue(async () => {
    const state = await readStore();
    const index = state.messages.findIndex((existing) => existing.id === message.id);
    if (index >= 0) {
      state.messages[index] = { ...state.messages[index], ...message };
    } else {
      state.messages.unshift(message);
    }
    state.messages = state.messages.slice(0, 2000);
    await writeStore(state);
    return state.messages[index >= 0 ? index : 0];
  });
}

export async function recordEvent(
  matcher: { id?: string; providerMessageId?: string },
  status: MessageDeliveryStatus,
  detail?: string,
  patch?: Partial<OutreachResult>,
): Promise<OutreachResult | undefined> {
  return enqueue(async () => {
    const state = await readStore();
    const index = state.messages.findIndex((message) => {
      if (matcher.id && message.id === matcher.id) return true;
      if (matcher.providerMessageId && message.providerMessageId === matcher.providerMessageId) return true;
      return false;
    });
    if (index < 0) return undefined;

    const event: MessageDeliveryEvent = {
      status,
      timestamp: new Date().toISOString(),
      detail,
    };
    const existing = state.messages[index];
    const updated: OutreachResult = {
      ...existing,
      ...patch,
      deliveryStatus: dominantStatus(existing.deliveryStatus, status),
      events: [...(existing.events ?? []), event].slice(-30),
    };

    if (status === "sent" && !updated.sentAt) updated.sentAt = event.timestamp;
    if (status === "delivered" && !updated.deliveredAt) updated.deliveredAt = event.timestamp;
    if (status === "replied" && !updated.repliedAt) updated.repliedAt = event.timestamp;

    state.messages[index] = updated;
    await writeStore(state);
    return updated;
  });
}

/**
 * Pick the "highest-progress" status so a delivered message that later receives
 * an opened event doesn't downgrade to opened, but a replied event upgrades.
 */
function dominantStatus(prev: MessageDeliveryStatus | undefined, next: MessageDeliveryStatus): MessageDeliveryStatus {
  const order: MessageDeliveryStatus[] = [
    "draft",
    "queued",
    "sending",
    "sent",
    "delivered",
    "opened",
    "clicked",
    "replied",
    "bounced",
    "failed",
  ];
  if (!prev) return next;
  // failed/bounced should override unless we already replied.
  if ((next === "failed" || next === "bounced") && prev !== "replied") return next;
  return order.indexOf(next) > order.indexOf(prev) ? next : prev;
}
