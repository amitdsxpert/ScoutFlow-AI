"use client";

import { useMemo, useState } from "react";
import { Phone, Radio, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import { generatePhoneOpening } from "@/lib/outreach";
import { makeId } from "@/lib/roles";
import { scoreInterest, simulatePhoneTranscript, transcriptToText } from "@/lib/simulation";
import type { AgentId, AgentStatus, CandidateProfile, InterestResult, MatchResult, OutreachResult, PhoneTurn, RolePipeline } from "@/lib/types";

interface PhoneSimulatorProps {
  roles: RolePipeline[];
  activeRole: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  selectedCandidateIds: string[];
  selectedCandidateId: string;
  onSelectRole: (roleId: string) => void;
  onSetSelection: (candidateIds: string[]) => void;
  onSelectCandidate: (candidateId: string) => void;
  onSaveOutreach: (result: OutreachResult) => void;
  onSaveInterest: (result: InterestResult) => void;
  onAgentActivity: (agentId: AgentId, status: AgentStatus, summary: string) => void;
}

type CallStatus = "Ready" | "Dialing simulation" | "In conversation" | "Completed";

export function PhoneSimulator({
  roles,
  activeRole,
  candidates,
  matches,
  selectedCandidateIds,
  selectedCandidateId,
  onSelectRole,
  onSetSelection,
  onSelectCandidate,
  onSaveOutreach,
  onSaveInterest,
  onAgentActivity,
}: PhoneSimulatorProps) {
  const [script, setScript] = useState("");
  const [transcript, setTranscript] = useState<PhoneTurn[]>([]);
  const [interest, setInterest] = useState<InterestResult | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("Ready");
  const [busy, setBusy] = useState(false);

  const selectedPool = useMemo(() => candidates.filter((candidate) => selectedCandidateIds.includes(candidate.id)), [candidates, selectedCandidateIds]);
  const candidate = candidates.find((item) => item.id === selectedCandidateId) ?? selectedPool[0] ?? candidates[0];
  const match = useMemo(() => matches.find((item) => item.candidateId === candidate?.id), [candidate?.id, matches]);
  const topCandidates = useMemo(() => matches.slice().sort((a, b) => b.matchScore - a.matchScore).slice(0, 12).map((matchItem) => candidates.find((candidateItem) => candidateItem.id === matchItem.candidateId)).filter((candidateItem): candidateItem is CandidateProfile => Boolean(candidateItem)), [candidates, matches]);

  const generateScript = () => {
    if (!candidate) return;
    const next = generatePhoneOpening(candidate, activeRole.parsedJD, match);
    setScript(next);
    setTranscript([]);
    setInterest(null);
    setCallStatus("Ready");
    onAgentActivity("phone_outreach", "completed", `Generated phone interest-check script for ${candidate.name}.`);
  };

  const simulateCall = async () => {
    if (!candidate) return;
    setBusy(true);
    const nextScript = script || generatePhoneOpening(candidate, activeRole.parsedJD, match);
    setScript(nextScript);
    setCallStatus("Dialing simulation");
    await delay(550);
    setCallStatus("In conversation");
    await delay(750);
    const turns = simulatePhoneTranscript(candidate, activeRole.parsedJD, match);
    const transcriptText = transcriptToText(turns);
    const nextInterest = { ...scoreInterest(candidate, activeRole.parsedJD, transcriptText, match), roleId: activeRole.id };
    setTranscript(turns);
    setInterest(nextInterest);
    setCallStatus("Completed");
    setBusy(false);
    onSaveOutreach({
      id: makeId("phone"),
      roleId: activeRole.id,
      candidateId: candidate.id,
      channel: "phone",
      tone: "professional",
      message: nextScript,
      phoneTranscript: transcriptText,
      createdAt: new Date().toISOString(),
    });
    onSaveInterest(nextInterest);
    onAgentActivity("phone_outreach", "completed", `Completed phone interest check with ${candidate.name}.`);
    onAgentActivity("interest_detection", "completed", `Detected ${nextInterest.interestLevel.replace("_", " ")} interest from phone transcript.`);
  };

  if (!candidate) {
    return <Empty title="No candidates indexed" text="Index candidates before running AI Phone Outreach." />;
  }

  return (
    <div className="grid gap-6 2xl:grid-cols-[340px_1fr_360px]">
      <GlassCard className="h-fit p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">AI Phone Outreach</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Phone Interest Check</h2>

        <label className="mt-5 grid gap-2 text-sm text-slate-300">
          Active role
          <select value={activeRole.id} onChange={(event) => onSelectRole(event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none">
            {roles.map((role) => <option key={role.id} value={role.id}>{role.roleTitle}</option>)}
          </select>
        </label>

        <label className="mt-4 grid gap-2 text-sm text-slate-300">
          Candidate
          <select
            value={candidate.id}
            onChange={(event) => {
              onSelectCandidate(event.target.value);
              onSetSelection([event.target.value]);
            }}
            className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
          >
            {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${callStatus === "Completed" ? "bg-emerald-300" : callStatus === "Ready" ? "bg-slate-500" : "animate-pulse bg-cyan-300"}`} />
            <span className="text-sm font-semibold text-white">{callStatus}</span>
          </div>
          <MockWaveform active={callStatus === "Dialing simulation" || callStatus === "In conversation"} />
        </div>

        <div className="mt-5 grid gap-3">
          <button onClick={() => onSetSelection(topCandidates.slice(0, 5).map((item) => item.id))} className="rounded-full border border-white/10 bg-white/7 px-5 py-3 text-sm font-semibold text-white">
            Use top 5 matched
          </button>
          <button onClick={generateScript} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow disabled:opacity-60">
            <Sparkles className="h-4 w-4" />
            Generate Phone Outreach
          </button>
          <button onClick={simulateCall} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-5 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-60">
            <Phone className="h-4 w-4" />
            Simulate Call
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Voice Outreach Simulator</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{candidate.name}</h2>
          </div>
          <Radio className="h-6 w-6 text-cyan-200" />
        </div>
        <pre className="scrollbar-slim min-h-[300px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/55 p-5 font-sans text-sm leading-6 text-slate-200">
          {script || "Generate a call opening script and interest-check questions."}
        </pre>

        <div className="mt-5 space-y-3">
          {transcript.length ? (
            transcript.map((turn, index) => (
              <div key={`${turn.speaker}-${index}`} className={`flex ${turn.speaker === "AI" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[86%] rounded-2xl border p-4 text-sm leading-6 ${turn.speaker === "AI" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-50" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"}`}>
                  <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{turn.speaker}</div>
                  {turn.text}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-400">Transcript bubbles appear after the phone interest check.</div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="h-fit p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-200/70">Intent Meter</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Call Analysis</h2>
        {interest ? (
          <div className="mt-5 space-y-4">
            <ScoreBadge score={interest.interestScore} label="Interest" size="lg" />
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/8 p-4 text-sm leading-6 text-emerald-50">{interest.summary}</div>
            <div className="grid gap-2">
              {Object.entries(interest.signals).map(([label, value]) => <Signal key={label} label={label} value={value} />)}
            </div>
            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 p-4 text-sm font-semibold text-cyan-100">{interest.recommendedNextAction}</div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-400">Intent score and next action appear after simulation.</div>
        )}
      </GlassCard>
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

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-slate-300">{label.replace(/([A-Z])/g, " $1")}</span>
        <span className="metric-number text-white">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-300" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function MockWaveform({ active }: { active: boolean }) {
  return (
    <div className="mt-4 flex h-14 items-center justify-center gap-1 rounded-2xl border border-white/10 bg-slate-950/45">
      {Array.from({ length: 18 }).map((_, index) => (
        <span
          key={index}
          className={`w-1 rounded-full bg-cyan-300/80 ${active ? "animate-slow-pulse" : ""}`}
          style={{ height: `${12 + ((index * 7) % 32)}px`, animationDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
