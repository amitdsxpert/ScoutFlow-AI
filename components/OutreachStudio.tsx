"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Mail, MessageCircle, Phone, RefreshCw, Send, Smartphone, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { scoreInterest } from "@/lib/simulation";
import type {
  AudienceType,
  CandidateList,
  CandidateProfile,
  Channel,
  InterestResult,
  MatchResult,
  MessageDeliveryStatus,
  OutreachCampaign,
  OutreachResult,
  OutreachTone,
  RankedCandidate,
  RolePipeline,
} from "@/lib/types";

interface OutreachStudioProps {
  roles: RolePipeline[];
  activeRole: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interests: InterestResult[];
  ranked: RankedCandidate[];
  selectedCandidateIds: string[];
  candidateLists: CandidateList[];
  campaigns: OutreachCampaign[];
  onSelectRole: (roleId: string) => void;
  onSetSelection: (candidateIds: string[]) => void;
  onSaveCampaign: (campaign: OutreachCampaign) => void;
  onRunCampaign: (input: {
    candidateIds: string[];
    channels: Channel[];
    tone: OutreachTone;
    mode: "draft_only" | "simulate_send_and_replies" | "simulate_phone_transcript";
    audienceType?: AudienceType;
    segmentId?: string;
  }) => Promise<OutreachCampaign>;
  onSaveInterest?: (result: InterestResult) => void;
}

const channels: Array<{ id: Channel; label: string; icon: React.ReactNode }> = [
  { id: "email", label: "Email", icon: <Mail className="h-4 w-4" /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Send className="h-4 w-4" /> },
  { id: "sms", label: "SMS", icon: <Smartphone className="h-4 w-4" /> },
  { id: "phone", label: "Phone", icon: <Phone className="h-4 w-4" /> },
];

const tones: OutreachTone[] = ["professional", "friendly", "technical", "startup", "executive", "warm_referral"];

export function OutreachStudio({
  roles,
  activeRole,
  candidates,
  matches,
  interests,
  ranked,
  selectedCandidateIds,
  candidateLists,
  campaigns,
  onSelectRole,
  onSetSelection,
  onSaveCampaign,
  onRunCampaign,
  onSaveInterest,
}: OutreachStudioProps) {
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>(["email"]);
  const [tone, setTone] = useState<OutreachTone>("professional");
  const [audienceType, setAudienceType] = useState<AudienceType>("top_recommended");
  const [countPreset, setCountPreset] = useState("10");
  const [topN, setTopN] = useState(10);
  const [segmentId, setSegmentId] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Select an audience and channels to build a campaign.");
  // Live delivery state keyed by message id, populated from /api/outreach/messages
  const [liveMessages, setLiveMessages] = useState<Record<string, OutreachResult>>({});
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);

  // Poll the server-side message store for delivery / reply updates whenever the
  // user is viewing this role.
  useEffect(() => {
    if (!activeRole?.id) return;
    let cancelled = false;
    const fetchMessages = async () => {
      try {
        const response = await fetch(`/api/outreach/messages?roleId=${encodeURIComponent(activeRole.id)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { messages: OutreachResult[] };
        if (cancelled) return;
        const next: Record<string, OutreachResult> = {};
        for (const message of data.messages) {
          if (message.id) next[message.id] = message;
        }
        setLiveMessages(next);
      } catch {
        // network blips are fine; we'll retry on the next interval
      }
    };
    void fetchMessages();
    const handle = window.setInterval(fetchMessages, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [activeRole?.id]);

  // Auto-run the interest detection agent on every new real reply.
  // We track which message ids we've already scored so we don't re-emit on
  // every poll cycle. The score is sent up via onSaveInterest and rendered
  // by the carousel/role-table because liveMessages already contains the reply.
  const scoredReplyIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!onSaveInterest || !activeRole?.parsedJD) return;
    const matchById = new Map(matches.map((match) => [match.candidateId, match]));
    for (const message of Object.values(liveMessages)) {
      if (!message.id || !message.reply) continue;
      if (scoredReplyIds.current.has(message.id)) continue;
      const candidate = candidates.find((item) => item.id === message.candidateId);
      if (!candidate) continue;
      try {
        const interest = scoreInterest(candidate, activeRole.parsedJD, message.reply, matchById.get(candidate.id));
        onSaveInterest({ ...interest, roleId: activeRole.id, campaignId: message.campaignId });
        scoredReplyIds.current.add(message.id);
      } catch {
        // Scoring failed; skip but don't crash polling.
      }
    }
  }, [activeRole.id, activeRole.parsedJD, candidates, liveMessages, matches, onSaveInterest]);

  const interestById = useMemo(() => new Map(interests.map((interest) => [interest.candidateId, interest])), [interests]);
  const topCandidates = useMemo(() => {
    // Start with ranked / matched candidates so the order reflects role-fit.
    const rankedIds = ranked.length ? ranked.map((row) => row.candidate.id) : matches.slice().sort((a, b) => b.matchScore - a.matchScore).map((match) => match.candidateId);
    const seen = new Set<string>();
    const ordered: CandidateProfile[] = [];
    for (const id of rankedIds) {
      if (seen.has(id)) continue;
      const candidate = candidates.find((item) => item.id === id);
      if (!candidate) continue;
      ordered.push(candidate);
      seen.add(id);
    }
    // Append any newly indexed candidates (e.g. just-uploaded resumes) that
    // haven't been matched yet, sorted by addedAt so the freshest appear first.
    const unranked = candidates
      .filter((candidate) => !seen.has(candidate.id))
      .sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
    return [...ordered, ...unranked];
  }, [candidates, matches, ranked]);
  const candidateCount = countPreset === "custom" ? topN : Number(countPreset);
  const selectedCandidates = useMemo(() => resolveAudience({
    audienceType,
    topN: candidateCount,
    segmentId,
    selectedCandidateIds,
    topCandidates,
    candidates,
    candidateLists,
    activeRole,
    interestById,
  }), [activeRole, audienceType, candidateCount, candidateLists, candidates, interestById, segmentId, selectedCandidateIds, topCandidates]);
  const selectedConversation = useMemo(() => campaign?.conversations?.find((conversation) => conversation.id === selectedConversationId), [campaign, selectedConversationId]);

  const toggleChannel = (channel: Channel) => {
    setSelectedChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  };

  const generateCampaign = async () => {
    if (!selectedCandidates.length || selectedChannels.length === 0) {
      setStatus("Select at least one candidate and one channel.");
      return;
    }
    setLoading(true);
    try {
      const nextCampaign = await onRunCampaign({
        candidateIds: selectedCandidates.map((candidate) => candidate.id),
        channels: selectedChannels,
        tone,
        mode: "draft_only",
        audienceType,
        segmentId,
      });
      setCampaign(nextCampaign);
      setStatus(`Generated ${nextCampaign.messages.length} personalized drafts.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Outreach Agent failed.");
    } finally {
      setLoading(false);
    }
  };

  const simulateSend = () => {
    if (!campaign) return;
    const next = { ...campaign, status: "simulated_sent" as const };
    setCampaign(next);
    onSaveCampaign(next);
    setStatus("Campaign drafts marked ready for provider handoff.");
  };

  const simulateReplies = async () => {
    if (!campaign) return;
    setLoading(true);
    try {
      const next = await onRunCampaign({
        candidateIds: campaign.candidateIds,
        channels: campaign.channels,
        tone: campaign.tone,
        mode: campaign.channels.includes("phone") ? "simulate_phone_transcript" : "simulate_send_and_replies",
        audienceType: campaign.audienceType,
        segmentId: campaign.segmentId,
      });
      setCampaign(next);
      setStatus(`Captured ${next.conversations?.length ?? 0} engagement records and ${next.interestResults.length} intent signals.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Engagement analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (message: OutreachResult) => {
    if (!message.id) {
      setStatus("Cannot send: message has no id.");
      return;
    }
    const candidate = candidates.find((item) => item.id === message.candidateId);
    if (!candidate) {
      setStatus("Cannot send: candidate not found.");
      return;
    }
    setSendingMessageId(message.id);
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          candidate: { name: candidate.name, email: candidate.email, phone: candidate.phone },
          subject: message.subject ?? `Opportunity: ${activeRole.roleTitle}`,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: OutreachResult; error?: string };
      if (data.message?.id) {
        setLiveMessages((current) => ({ ...current, [data.message!.id!]: data.message! }));
      }
      if (data.ok) {
        setStatus(`Message sent to ${candidate.name} (${message.channel}).`);
      } else {
        setStatus(data.error ?? "Send failed. Check provider configuration.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setSendingMessageId(null);
    }
  };

  const refreshMessages = async () => {
    if (!activeRole?.id) return;
    try {
      const response = await fetch(`/api/outreach/messages?roleId=${encodeURIComponent(activeRole.id)}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { messages: OutreachResult[] };
      const next: Record<string, OutreachResult> = {};
      for (const message of data.messages) {
        if (message.id) next[message.id] = message;
      }
      setLiveMessages(next);
      setStatus(`Refreshed ${data.messages.length} delivery records.`);
    } catch {
      setStatus("Failed to refresh delivery status.");
    }
  };

  if (candidates.length === 0) {
    return <Empty title="No candidates indexed" text="Index candidates before creating outreach campaigns." />;
  }

  return (
    <div className="space-y-5">
      <Stepper hasCampaign={Boolean(campaign)} status={campaign?.status} />

      <div className="grid gap-5 xl:grid-cols-2">
      <GlassCard className="h-fit min-w-0 p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Step 1 · Audience</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Role and audience</h2>
        <label className="mt-5 grid min-w-0 gap-2 text-sm text-slate-300">
          Active role
          <select value={activeRole.id} onChange={(event) => onSelectRole(event.target.value)} className="w-full min-w-0 truncate rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none">
            {roles.map((role) => <option key={role.id} value={role.id}>{role.roleTitle}</option>)}
          </select>
        </label>

        <label className="mt-5 grid gap-2 text-sm text-slate-300">
          Audience
          <select value={audienceType} onChange={(event) => setAudienceType(event.target.value as AudienceType)} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none">
            <option value="top_recommended">Top recommended candidates</option>
            <option value="selected_candidates">Selected candidates</option>
            <option value="segment">Segment</option>
            <option value="shortlist">Shortlisted candidates</option>
            <option value="interested">Interested candidates</option>
            <option value="all_matched">All matched candidates</option>
          </select>
        </label>

        {audienceType === "segment" ? (
          <label className="mt-4 grid gap-2 text-sm text-slate-300">
            Segment
            <select
              value={segmentId}
              onChange={(event) => setSegmentId(event.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
            >
              <option value="">Select a segment</option>
              {candidateLists.map((list) => (
                <option key={list.id} value={list.id}>{list.name} ({list.candidateIds.length})</option>
              ))}
            </select>
            {!candidateLists.length ? (
              <span className="text-xs text-slate-500">No segments yet — create one from the Candidates page.</span>
            ) : null}
          </label>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Candidate count
            <select value={countPreset} onChange={(event) => setCountPreset(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm normal-case text-white outline-none">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Custom count
            <input value={topN} onChange={(event) => setTopN(Number(event.target.value) || 1)} disabled={countPreset !== "custom"} type="number" min={1} max={100} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm normal-case text-white outline-none disabled:opacity-40" />
          </label>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">{selectedCandidates.length} selected</span>
            <button onClick={() => onSetSelection(topCandidates.slice(0, candidateCount).map((candidate) => candidate.id))} className="text-xs font-semibold text-cyan-100">Use top {candidateCount}</button>
          </div>
          <div className="scrollbar-slim mt-3 max-h-72 space-y-2 overflow-auto">
            {topCandidates.slice(0, Math.max(50, candidateCount)).map((candidate) => (
              <label key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={selectedCandidates.some((item) => item.id === candidate.id)}
                  onChange={() => {
                    const current = selectedCandidates.map((item) => item.id);
                    setAudienceType("selected_candidates");
                    onSetSelection(current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id]);
                  }}
                />
                <span>
                  <span className="block text-sm font-semibold text-white">{candidate.name}</span>
                  <span className="block text-xs text-slate-400">{candidate.currentTitle}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">{campaigns.length} campaign records in workspace.</p>
      </GlassCard>

      <GlassCard className="h-fit min-w-0 p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-200/70">Step 2 · Channels & Tone</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Channels and tone</h2>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {channels.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleChannel(item.id)}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-semibold ${
                selectedChannels.includes(item.id) ? "bg-cyan-300 text-slate-950 shadow-glow" : "border border-white/10 bg-white/7 text-slate-200"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <label className="mt-5 grid gap-2 text-sm text-slate-300">
          Tone
          <select value={tone} onChange={(event) => setTone(event.target.value as OutreachTone)} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 capitalize text-white outline-none">
            {tones.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
          </select>
        </label>

        <div className="mt-5 grid gap-3">
          <button onClick={generateCampaign} disabled={loading || !selectedCandidates.length || !selectedChannels.length} className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow disabled:opacity-60">
            <Sparkles className="h-4 w-4" />
            {loading ? "Generating drafts..." : "Generate Drafts"}
          </button>
          <p className="text-xs leading-5 text-slate-400">
            Drafts appear in <span className="font-semibold text-white">Step 3</span>. Use the per-draft <span className="font-semibold text-white">Send</span> button to deliver via Resend (email) or Twilio (SMS / WhatsApp). Replies stream into the live tracker below.
          </p>
          <details className="rounded-2xl border border-white/10 bg-white/[0.025]">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 hover:text-white">
              Optional · simulate replies for demo
            </summary>
            <div className="space-y-2 px-4 pb-4">
              <p className="text-xs text-slate-500">
                Generate plausible candidate replies and intent scores without sending real messages. Useful for demos before connecting providers.
              </p>
              <button onClick={simulateReplies} disabled={!campaign || loading} className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-50">
                <Send className="h-3 w-3" />
                Generate sample replies
              </button>
              <button onClick={simulateSend} disabled={!campaign || loading} className="ml-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                Mark drafts ready
              </button>
            </div>
          </details>
        </div>
        <p className="mt-5 rounded-2xl border border-emerald-300/15 bg-emerald-300/8 p-3 text-sm text-emerald-100">{status}</p>
      </GlassCard>
      </div>

      <GlassCard className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Step 3 · Drafts & Delivery</p>
            <h2 className="mt-2 text-xl font-semibold text-white">{campaign ? `${campaign.messages.length} messages` : "No campaign draft yet"}</h2>
          </div>
          <div className="flex items-center gap-2">
            {campaign ? <CampaignSummary campaign={campaign} /> : null}
            <button
              type="button"
              onClick={refreshMessages}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
              title="Refresh delivery status"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>

        {campaign && campaign.messages.length > 0 ? (
          <DraftCarousel
            messages={campaign.messages}
            candidates={candidates}
            campaign={campaign}
            liveMessages={liveMessages}
            sendingMessageId={sendingMessageId}
            index={Math.min(carouselIndex, campaign.messages.length - 1)}
            onIndexChange={setCarouselIndex}
            onSend={sendMessage}
            onOpenConversation={(message) => {
              const conv = campaign.conversations?.find((conversation) => conversation.candidateId === message.candidateId && conversation.channel === message.channel);
              if (conv) setSelectedConversationId(conv.id);
            }}
            onLogReply={async (message, replyText) => {
              if (!message.id) return;
              try {
                const response = await fetch("/api/outreach/log-reply", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messageId: message.id, reply: replyText }),
                });
                const data = (await response.json()) as { ok?: boolean; message?: OutreachResult; error?: string };
                if (data.message?.id) {
                  setLiveMessages((current) => ({ ...current, [data.message!.id!]: data.message! }));
                  // Force the auto-scoring effect to score this reply by removing it from the cache.
                  scoredReplyIds.current.delete(data.message.id);
                }
                setStatus(data.ok ? "Reply logged. Interest score updated." : (data.error ?? "Failed to log reply."));
              } catch (error) {
                setStatus(error instanceof Error ? error.message : "Failed to log reply.");
              }
            }}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">
            Generate drafts to preview every selected candidate and channel before sending.
          </div>
        )}
      </GlassCard>

      {/* Role-wise delivery & reply tracker */}
      <RoleOutreachStatus
        roleId={activeRole.id}
        roleTitle={activeRole.roleTitle}
        liveMessages={liveMessages}
        candidates={candidates}
        interestById={interestById}
      />

      {selectedConversation ? (
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Conversation Record</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{candidates.find((candidate) => candidate.id === selectedConversation.candidateId)?.name ?? "Candidate"}</h3>
              <p className="mt-1 text-sm capitalize text-slate-400">{selectedConversation.channel} · {selectedConversation.status.replace("_", " ")}</p>
              <p className="mt-1 text-xs text-slate-500">Provider: {providerDisplay(selectedConversation.providerUsed)}{selectedConversation.modelUsed ? ` · ${selectedConversation.modelUsed}` : ""}</p>
            </div>
            <button onClick={() => setSelectedConversationId("")} className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Close</button>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <ConversationBlock title="Sent message" text={selectedConversation.sentMessage} />
            <ConversationBlock title="Reply / transcript" text={selectedConversation.reply ?? selectedConversation.transcript ?? "No response yet."} />
            <ConversationBlock title="Interest analysis" text={selectedConversation.interestResult ? `${selectedConversation.interestResult.interestScore} · ${selectedConversation.interestResult.summary}\n${selectedConversation.interestResult.recommendedNextAction}` : "No interest score yet."} />
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <GlassCard className="p-8 text-center">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
    </GlassCard>
  );
}

function Stepper({ hasCampaign, status }: { hasCampaign: boolean; status?: OutreachCampaign["status"] }) {
  const stepsCompleted = hasCampaign
    ? status && ["replies_generated", "replied", "interested", "not_interested", "follow_up_needed", "completed"].includes(status)
      ? 3
      : 2
    : 1;
  const items = [
    { id: 1, label: "Audience" },
    { id: 2, label: "Channels & Tone" },
    { id: 3, label: "Drafts & Engagement" },
  ];
  return (
    <div className="glass-card flex flex-wrap items-center gap-3 rounded-2xl p-3">
      {items.map((item, index) => {
        const active = item.id === stepsCompleted;
        const done = item.id < stepsCompleted;
        return (
          <div key={item.id} className="flex items-center gap-3">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${
              done ? "bg-emerald-300 text-slate-950" : active ? "bg-cyan-300 text-slate-950 shadow-glow" : "border border-white/10 bg-white/[0.04] text-slate-400"
            }`}>{done ? "✓" : item.id}</div>
            <span className={`text-sm font-semibold ${active ? "text-white" : done ? "text-emerald-100" : "text-slate-400"}`}>{item.label}</span>
            {index < items.length - 1 ? <span className="hidden h-px w-10 bg-white/15 sm:inline-block" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function CampaignSummary({ campaign }: { campaign: OutreachCampaign }) {
  const highInterest = campaign.interestResults.filter((interest) => interest.interestScore >= 75).length;
  const replies = campaign.messages.filter((message) => message.simulatedReply || message.phoneTranscript).length;
  return (
    <div className="flex flex-wrap justify-end gap-2 text-center">
      <Mini label="Candidates" value={campaign.candidateIds.length} />
      <Mini label="Channels" value={campaign.channels.length} />
      <Mini label="Replies" value={replies} />
      <Mini label="High intent" value={highInterest} />
      <span className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-300">{campaignStatusLabel(campaign.status)}</span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="metric-number text-sm font-semibold text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function campaignStatusLabel(status: OutreachCampaign["status"]): string {
  if (status === "simulated_sent") return "drafts ready";
  if (status === "replies_generated") return "replies captured";
  return status.replace("_", " ");
}

function ConversationBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-300">{text}</pre>
    </div>
  );
}

interface DraftCarouselProps {
  messages: OutreachResult[];
  candidates: CandidateProfile[];
  campaign: OutreachCampaign;
  liveMessages: Record<string, OutreachResult>;
  sendingMessageId: string | null;
  index: number;
  onIndexChange: (next: number) => void;
  onSend: (message: OutreachResult) => void;
  onOpenConversation: (message: OutreachResult) => void;
  onLogReply: (message: OutreachResult, replyText: string) => Promise<void>;
}

function DraftCarousel({
  messages,
  candidates,
  campaign,
  liveMessages,
  sendingMessageId,
  index,
  onIndexChange,
  onSend,
  onOpenConversation,
  onLogReply,
}: DraftCarouselProps) {
  const [logReplyDraft, setLogReplyDraft] = useState("");
  const [logReplyOpen, setLogReplyOpen] = useState(false);
  const [logReplyBusy, setLogReplyBusy] = useState(false);
  const message = messages[index];
  if (!message) return null;
  const live = message.id ? liveMessages[message.id] : undefined;
  const merged: OutreachResult = live ? { ...message, ...live } : message;
  const candidate = candidates.find((item) => item.id === merged.candidateId);
  const interest = campaign.interestResults.find((item) => item.candidateId === merged.candidateId);
  const conversation = campaign.conversations?.find((c) => c.candidateId === merged.candidateId && c.channel === merged.channel);
  const sendable = merged.channel === "email" || merged.channel === "sms" || merged.channel === "whatsapp";
  const targetField = merged.channel === "email" ? candidate?.email : candidate?.phone;

  const goPrev = () => onIndexChange((index - 1 + messages.length) % messages.length);
  const goNext = () => onIndexChange((index + 1) % messages.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={messages.length < 2}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40"
        >
          <ChevronLeft className="h-3 w-3" />
          Prev
        </button>
        <span className="text-xs text-slate-400">
          Draft <span className="metric-number text-white">{index + 1}</span> of {messages.length}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={messages.length < 2}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{candidate?.name ?? "Candidate"}</p>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {merged.channel} · {merged.tone.replace("_", " ")}
              {targetField ? ` · ${targetField}` : ""}
            </p>
            {merged.subject ? <p className="mt-1 text-sm text-slate-300">Subject: <span className="text-white">{merged.subject}</span></p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DeliveryBadge status={merged.deliveryStatus} />
            {interest ? (
              <span className="metric-number rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-sm text-emerald-100">
                Intent {interest.interestScore}
              </span>
            ) : null}
          </div>
        </div>

        <pre className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 p-4 font-sans text-sm leading-6 text-slate-200">{merged.message}</pre>

        {merged.reply ? (
          <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/8 p-4 text-sm leading-6 text-emerald-50">
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-emerald-200/80">Live reply</p>
            <pre className="whitespace-pre-wrap font-sans">{merged.reply}</pre>
          </div>
        ) : merged.simulatedReply ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Simulated reply</p>
            <pre className="whitespace-pre-wrap font-sans">{merged.simulatedReply}</pre>
          </div>
        ) : null}

        {merged.phoneTranscript ? (
          <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-cyan-300/20 bg-cyan-300/8 p-4 font-sans text-sm leading-6 text-cyan-50">
            {merged.phoneTranscript}
          </pre>
        ) : null}

        {merged.providerError ? (
          <div className="mt-3 rounded-2xl border border-rose-300/25 bg-rose-300/10 p-3 text-xs text-rose-100">
            <p className="font-semibold">Provider error</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{merged.providerError}</p>
            <ProviderErrorHint error={merged.providerError} />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sendable ? (
            <button
              type="button"
              onClick={() => onSend(merged)}
              disabled={sendingMessageId === merged.id || merged.deliveryStatus === "sending" || !targetField}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              title={!targetField ? `No ${merged.channel === "email" ? "email" : "phone"} on candidate` : undefined}
            >
              <Send className="h-3 w-3" />
              {sendingMessageId === merged.id
                ? "Sending..."
                : merged.deliveryStatus && ["sent", "delivered", "opened", "replied"].includes(merged.deliveryStatus)
                  ? `Resend ${merged.channel}`
                  : `Send ${merged.channel}`}
            </button>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300">
              {merged.channel === "phone" ? "Phone — outbound dialer not configured" : "Channel handled outside ScoutFlow"}
            </span>
          )}
          {conversation ? (
            <button
              type="button"
              onClick={() => onOpenConversation(merged)}
              className="rounded-full border border-white/10 bg-white/7 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/12"
            >
              View conversation
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setLogReplyDraft(merged.reply ?? "");
              setLogReplyOpen((current) => !current);
            }}
            className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20"
            title="Paste a reply you received in your inbox or LinkedIn so ScoutFlow can score interest."
          >
            {logReplyOpen ? "Cancel" : merged.reply ? "Edit reply" : "Log reply"}
          </button>
          {merged.sentAt ? (
            <span className="text-[11px] text-slate-500">
              Sent {new Date(merged.sentAt).toLocaleTimeString()}
            </span>
          ) : null}
          {merged.repliedAt ? (
            <span className="text-[11px] text-emerald-200/80">
              Reply received {new Date(merged.repliedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        {logReplyOpen ? (
          <div className="mt-3 space-y-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-3">
            <textarea
              value={logReplyDraft}
              onChange={(event) => setLogReplyDraft(event.target.value)}
              rows={4}
              placeholder="Paste the candidate's reply here (from your inbox, LinkedIn, etc.)"
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-emerald-300/20 transition focus:ring-2"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!merged.id || !logReplyDraft.trim() || logReplyBusy}
                onClick={async () => {
                  if (!merged.id) return;
                  setLogReplyBusy(true);
                  try {
                    await onLogReply(merged, logReplyDraft);
                    setLogReplyOpen(false);
                  } finally {
                    setLogReplyBusy(false);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
              >
                {logReplyBusy ? "Saving..." : "Save reply & score interest"}
              </button>
              <p className="text-[11px] text-emerald-200/70">
                Interest detection runs automatically on saved replies.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {messages.map((item, dotIndex) => {
          const dotLive = item.id ? liveMessages[item.id] : undefined;
          const tone = (dotLive?.deliveryStatus ?? item.deliveryStatus) ?? "draft";
          const active = dotIndex === index;
          return (
            <button
              key={item.id ?? dotIndex}
              type="button"
              onClick={() => onIndexChange(dotIndex)}
              aria-label={`Draft ${dotIndex + 1}`}
              className={`h-2.5 w-2.5 rounded-full transition ${active ? "ring-2 ring-cyan-200/60 ring-offset-1 ring-offset-slate-950" : ""} ${dotColor(tone)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProviderErrorHint({ error }: { error: string }) {
  const lower = error.toLowerCase();
  let hint: { title: string; body: React.ReactNode } | null = null;

  if (lower.includes("you can only send testing emails to your own")) {
    hint = {
      title: "Resend free-tier restriction",
      body: (
        <>
          The Resend sandbox only delivers to your own verified email. To send to other candidates, verify a domain at{" "}
          <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="underline">resend.com/domains</a>{" "}
          and update <code className="rounded bg-white/10 px-1">RESEND_FROM</code> in <code className="rounded bg-white/10 px-1">.env</code> to use that domain.
        </>
      ),
    };
  } else if (lower.includes("resend_api_key missing") || lower.includes("resend is not configured")) {
    hint = {
      title: "Resend not configured",
      body: <>Add <code className="rounded bg-white/10 px-1">RESEND_API_KEY</code> to <code className="rounded bg-white/10 px-1">.env</code> and restart the dev server.</>,
    };
  } else if (lower.includes("twilio_account_sid") || lower.includes("twilio is not configured")) {
    hint = {
      title: "Twilio not configured",
      body: <>Set <code className="rounded bg-white/10 px-1">TWILIO_ACCOUNT_SID</code>, <code className="rounded bg-white/10 px-1">TWILIO_AUTH_TOKEN</code>, and the channel <code className="rounded bg-white/10 px-1">FROM</code> number.</>,
    };
  } else if (lower.includes("twilio sms is not configured")) {
    hint = {
      title: "Twilio SMS sender missing",
      body: <>Set <code className="rounded bg-white/10 px-1">TWILIO_SMS_FROM</code> in <code className="rounded bg-white/10 px-1">.env</code>.</>,
    };
  } else if (lower.includes("twilio whatsapp is not configured")) {
    hint = {
      title: "Twilio WhatsApp sender missing",
      body: <>Set <code className="rounded bg-white/10 px-1">TWILIO_WHATSAPP_FROM</code> in <code className="rounded bg-white/10 px-1">.env</code>.</>,
    };
  } else if (lower.includes("candidate has no email")) {
    hint = {
      title: "Missing candidate email",
      body: <>Add an email to the candidate profile (or upload a resume that includes one) before sending.</>,
    };
  } else if (lower.includes("candidate has no phone")) {
    hint = {
      title: "Missing candidate phone",
      body: <>Add a phone number to the candidate profile before sending SMS or WhatsApp.</>,
    };
  } else if (lower.includes("rate limit") || lower.includes("429")) {
    hint = {
      title: "Provider rate limit",
      body: <>The provider is throttling requests. Wait a few minutes or switch to another configured provider in Settings.</>,
    };
  }

  if (!hint) return null;
  return (
    <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-300/10 p-2 text-[11px] text-amber-100">
      <span className="font-semibold">{hint.title}: </span>
      {hint.body}
    </div>
  );
}

function dotColor(status: MessageDeliveryStatus): string {
  switch (status) {
    case "replied":
      return "bg-emerald-400";
    case "delivered":
    case "opened":
    case "clicked":
      return "bg-emerald-300/80";
    case "sent":
      return "bg-cyan-300";
    case "queued":
    case "sending":
      return "bg-amber-300";
    case "failed":
    case "bounced":
      return "bg-rose-400";
    default:
      return "bg-white/30";
  }
}

function DeliveryBadge({ status }: { status?: MessageDeliveryStatus }) {
  const label = status ?? "draft";
  const tone =
    label === "replied"
      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
      : label === "delivered" || label === "opened" || label === "clicked"
        ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
        : label === "sent"
          ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
          : label === "queued" || label === "sending"
            ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
            : label === "failed" || label === "bounced"
              ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
              : "border-white/10 bg-white/5 text-slate-300";
  return (
    <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label.replace("_", " ")}
    </span>
  );
}

interface RoleOutreachStatusProps {
  roleId: string;
  roleTitle: string;
  liveMessages: Record<string, OutreachResult>;
  candidates: CandidateProfile[];
  interestById: Map<string, InterestResult>;
}

function RoleOutreachStatus({ roleId, roleTitle, liveMessages, candidates, interestById }: RoleOutreachStatusProps) {
  const rows = useMemo(() => {
    return Object.values(liveMessages)
      .filter((message) => message.roleId === roleId)
      .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
      .slice(0, 50);
  }, [liveMessages, roleId]);

  const counts = useMemo(() => {
    const totals = { sent: 0, delivered: 0, replied: 0, failed: 0 };
    for (const message of rows) {
      const status = message.deliveryStatus ?? "draft";
      if (status === "sent" || status === "delivered" || status === "opened" || status === "clicked" || status === "replied") totals.sent += 1;
      if (status === "delivered" || status === "opened" || status === "clicked" || status === "replied") totals.delivered += 1;
      if (status === "replied") totals.replied += 1;
      if (status === "failed" || status === "bounced") totals.failed += 1;
    }
    return totals;
  }, [rows]);

  if (!rows.length) {
    return (
      <GlassCard className="p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Live Delivery & Replies</p>
        <h3 className="mt-2 text-xl font-semibold text-white">No real messages yet for {roleTitle}</h3>
        <p className="mt-2 text-sm text-slate-400">
          When you press Send on a draft, the message appears here and updates automatically as the provider reports delivery and replies.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Live Delivery & Replies</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{roleTitle}</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-center">
          <Mini label="Sent" value={counts.sent} />
          <Mini label="Delivered" value={counts.delivered} />
          <Mini label="Replied" value={counts.replied} />
          <Mini label="Failed" value={counts.failed} />
        </div>
      </div>

      <div className="scrollbar-slim mt-4 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="p-3">Candidate</th>
              <th className="p-3">Channel</th>
              <th className="p-3">Status</th>
              <th className="p-3">Intent</th>
              <th className="p-3">Sent</th>
              <th className="p-3">Reply</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((message) => {
              const candidate = candidates.find((item) => item.id === message.candidateId);
              const intent = interestById.get(message.candidateId);
              return (
                <tr key={message.id ?? `${message.candidateId}-${message.createdAt}`} className="border-t border-white/10">
                  <td className="p-3">
                    <div className="font-semibold text-white">{candidate?.name ?? "Unknown"}</div>
                    <div className="text-xs text-slate-500">{candidate?.email ?? candidate?.phone ?? "—"}</div>
                  </td>
                  <td className="p-3 capitalize text-slate-300">{message.channel}</td>
                  <td className="p-3">
                    <DeliveryBadge status={message.deliveryStatus} />
                    {message.providerError ? (
                      <div className="mt-1 max-w-xs truncate text-[11px] text-rose-200/80" title={message.providerError}>
                        {message.providerError}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    {intent ? (
                      <span
                        className={`metric-number rounded-full border px-2 py-0.5 text-xs ${
                          intent.interestScore >= 75
                            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                            : intent.interestScore >= 50
                              ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                              : "border-white/10 bg-white/5 text-slate-300"
                        }`}
                        title={intent.summary}
                      >
                        {intent.interestScore}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-slate-400">
                    {message.sentAt ? new Date(message.sentAt).toLocaleString() : "—"}
                  </td>
                  <td className="max-w-md p-3 text-xs text-slate-300">
                    {message.reply ? (
                      <div className="line-clamp-2" title={message.reply}>{message.reply}</div>
                    ) : (
                      <span className="text-slate-500">No reply yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function resolveAudience(input: {
  audienceType: AudienceType;
  topN: number;
  segmentId: string;
  selectedCandidateIds: string[];
  topCandidates: CandidateProfile[];
  candidates: CandidateProfile[];
  candidateLists: CandidateList[];
  activeRole: RolePipeline;
  interestById: Map<string, InterestResult>;
}): CandidateProfile[] {
  if (input.audienceType === "selected_candidates") {
    return input.candidates.filter((candidate) => input.selectedCandidateIds.includes(candidate.id));
  }
  if (input.audienceType === "segment") {
    const list = input.candidateLists.find((item) => item.id === input.segmentId);
    return input.candidates.filter((candidate) => list?.candidateIds.includes(candidate.id));
  }
  if (input.audienceType === "shortlist") {
    return input.candidates.filter((candidate) => input.activeRole.shortlist.includes(candidate.id));
  }
  if (input.audienceType === "interested") {
    return input.candidates.filter((candidate) => (input.interestById.get(candidate.id)?.interestScore ?? 0) >= 75);
  }
  if (input.audienceType === "all_matched") {
    return input.topCandidates;
  }
  return input.topCandidates.slice(0, input.topN);
}

function providerDisplay(provider?: string): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  return "Local Fallback";
}
