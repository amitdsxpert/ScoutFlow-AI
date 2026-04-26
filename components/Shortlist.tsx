"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Sparkles, Trophy } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { downloadTextFile, rankedToCsv } from "@/lib/export";
import type { CandidateProfile, InterestResult, MatchResult, OutreachResult, RankedCandidate, RolePipeline, ShortlistPreset, ShortlistSettings } from "@/lib/types";

interface ShortlistProps {
  activeRole: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interests: InterestResult[];
  ranked: RankedCandidate[];
  outreachResults: OutreachResult[];
  selectedCandidateIds: string[];
  shortlistSettings: ShortlistSettings[];
  onSetSelection: (candidateIds: string[]) => void;
  onShortlist: (candidateIds: string[], action: "add" | "remove") => void;
  onAutoSimulate: () => void;
  onSaveSettings: (settings: ShortlistSettings) => void;
  onViewed?: () => void;
}

interface ShortlistRow {
  rank: number;
  candidate: CandidateProfile;
  match: MatchResult;
  interest?: InterestResult;
  finalScore: number;
  recommendation: string;
  shortlisted: boolean;
}

export function Shortlist({
  activeRole,
  candidates,
  matches,
  interests,
  ranked,
  outreachResults,
  selectedCandidateIds,
  shortlistSettings,
  onSetSelection,
  onShortlist,
  onAutoSimulate,
  onSaveSettings,
  onViewed,
}: ShortlistProps) {
  const viewedRoleRef = useRef("");
  const savedSettings = shortlistSettings.find((settings) => settings.roleId === activeRole.id);
  const [activeTab, setActiveTab] = useState<"recommended" | "manual" | "contacted" | "interested">("recommended");
  const [preset, setPreset] = useState<ShortlistPreset>(savedSettings?.preset ?? "balanced");
  const [weights, setWeights] = useState<ShortlistSettings["weights"]>(savedSettings?.weights ?? weightsForPreset("balanced"));

  useEffect(() => {
    if (viewedRoleRef.current === activeRole.id) return;
    viewedRoleRef.current = activeRole.id;
    onViewed?.();
  }, [activeRole.id, onViewed]);

  const matchById = new Map(matches.map((match) => [match.candidateId, match]));
  const interestById = new Map(interests.map((interest) => [interest.candidateId, interest]));
  const outreachByCandidate = new Map(outreachResults.map((result) => [result.candidateId, result]));
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const currentSettings: ShortlistSettings = useMemo(() => ({ roleId: activeRole.id, preset, weights }), [activeRole.id, preset, weights]);

  const allRows = buildShortlistRows({
    candidateIds: uniqueIds(ranked.length ? ranked.map((row) => row.candidate.id) : matches.slice().sort((a, b) => b.matchScore - a.matchScore).map((match) => match.candidateId)),
    activeRole,
    candidateById,
    matchById,
    interestById,
    ranked,
    settings: currentSettings,
  });
  const baseRows = filterRowsForTab(allRows, activeTab, activeRole.shortlist, outreachByCandidate);

  const comparison = baseRows.filter((row) => selectedCandidateIds.includes(row.candidate.id)).slice(0, 3);

  if (candidates.length === 0) {
    return <Empty title="No candidates indexed" text="Index candidates before building shortlist intelligence." />;
  }

  if (baseRows.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <Sparkles className="mx-auto h-12 w-12 text-cyan-200" />
        <h2 className="mt-4 text-2xl font-semibold text-white">No role shortlist yet</h2>
        <p className="mt-2 text-sm text-slate-400">Run ScoutFlow Agents or refresh matching to generate the role shortlist.</p>
        <button onClick={onAutoSimulate} className="mt-6 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow">
          Run ScoutFlow Agents
        </button>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-300/15 p-3 text-amber-100">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">Role Shortlist</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">{activeRole.roleTitle}</h2>
              <p className="mt-1 text-sm text-slate-400">{baseRows.length} candidates in {activeTab.replace("_", " ")} view</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onAutoSimulate} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
              <Sparkles className="h-4 w-4" />
              Refresh Interest Signals
            </button>
            <button
              onClick={() => downloadTextFile("scoutflow-role-shortlist.csv", rankedToCsv(baseRows.map(toRankedCandidate), activeRole.roleTitle), "text/csv")}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow"
            >
              <Download className="h-4 w-4" />
              Export Role CSV
            </button>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {[
              ["recommended", "Recommended Shortlist"],
              ["manual", "Manual Shortlist"],
              ["contacted", "Contacted"],
              ["interested", "Interested"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id as typeof activeTab)} className={`rounded-full px-4 py-2 text-sm font-semibold ${activeTab === id ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/7 text-slate-300 hover:bg-white/12"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={preset}
              onChange={(event) => {
                const nextPreset = event.target.value as ShortlistPreset;
                const nextWeights = weightsForPreset(nextPreset);
                setPreset(nextPreset);
                setWeights(nextWeights);
                onSaveSettings({ roleId: activeRole.id, preset: nextPreset, weights: nextWeights });
              }}
              className="rounded-full border border-white/10 bg-slate-950/70 px-4 py-2 text-sm capitalize text-white outline-none"
            >
              <option value="balanced">Balanced</option>
              <option value="skills_first">Skills-first</option>
              <option value="interest_first">Interest-first</option>
              <option value="availability_first">Availability-first</option>
              <option value="location_first">Location-first</option>
              <option value="custom">Custom</option>
            </select>
            <button onClick={() => onSaveSettings(currentSettings)} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
              Save weights
            </button>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-400">Default final score is Match Score * 0.65 + Interest Score * 0.35. Presets can add location and availability bias when needed.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Object.entries(weights).map(([key, value]) => (
            <label key={key} className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {key}
              <input
                type={key === "match" || key === "interest" ? "range" : "number"}
                min={0}
                max={100}
                value={value}
                onChange={(event) => {
                  setPreset("custom");
                  setWeights((current) => ({ ...current, [key]: Number(event.target.value) || 0 }));
                }}
                className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm normal-case text-white outline-none"
              />
            </label>
          ))}
        </div>
      </GlassCard>

      {comparison.length >= 2 ? (
        <GlassCard className="p-5">
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Candidate Comparison</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Side-by-side shortlist review</h3>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {comparison.map((row) => (
              <div key={row.candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{row.candidate.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{row.candidate.currentTitle}</p>
                  </div>
                  <span className="metric-number text-xl font-semibold text-cyan-100">{row.finalScore}</span>
                </div>
                <CompareLine label="Skills" value={row.match.matchedSkills.slice(0, 6).join(", ") || "Limited explicit overlap"} />
                <CompareLine label="Experience" value={`${row.candidate.yearsExperience} years`} />
                <CompareLine label="Risks" value={row.match.risks.slice(0, 2).join("; ") || "No major risk"} />
                <CompareLine label="Next step" value={row.interest?.recommendedNextAction ?? row.recommendation} />
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}

      <div className="space-y-4">
        {baseRows.map((row) => {
          const outreach = outreachByCandidate.get(row.candidate.id);
          return (
            <GlassCard key={row.candidate.id} className="p-5">
              <div className="grid gap-4 xl:grid-cols-[70px_1fr_320px]">
                <button
                  onClick={() => onSetSelection(selectedCandidateIds.includes(row.candidate.id) ? selectedCandidateIds.filter((id) => id !== row.candidate.id) : [...selectedCandidateIds, row.candidate.id])}
                  className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold ${selectedCandidateIds.includes(row.candidate.id) ? "bg-cyan-300 text-slate-950" : "bg-gradient-to-br from-amber-300 to-cyan-300 text-slate-950"}`}
                  title="Toggle comparison selection"
                >
                  #{row.rank}
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-white">{row.candidate.name}</h3>
                    <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-xs font-semibold capitalize text-slate-300">{row.candidate.source.replace("_", " ")}</span>
                    {row.shortlisted ? <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">shortlisted</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{row.candidate.currentTitle} · {row.candidate.location} · {row.candidate.yearsExperience} yrs</p>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{row.recommendation} · {row.interest?.recommendedNextAction ?? "Generate interest signal"}</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniScore label="Match" value={row.match.matchScore} />
                  <MiniScore label="Interest" value={row.interest?.interestScore} />
                  <MiniScore label="Final" value={row.finalScore} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={() => onShortlist([row.candidate.id], row.shortlisted ? "remove" : "add")} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
                  {row.shortlisted ? "Remove from shortlist" : "Add to shortlist"}
                </button>
              </div>

              <details className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-white">
                  Hiring manager brief
                  <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <Detail title="3-line Summary" content={briefSummary(row)} />
                  <Detail title="Why They Match" content={row.match.explanation} />
                  <Detail title="Risks / Gaps" content={row.match.risks.join("\n") || "No major risk detected."} />
                  <Detail title="Suggested Next Step" content={row.interest?.recommendedNextAction ?? row.recommendation} />
                  <Detail title="Generated Outreach" content={outreach?.message || "No outreach saved yet."} />
                  <Detail title="Reply or Transcript" content={outreach?.simulatedReply || outreach?.phoneTranscript || "No reply saved yet."} />
                </div>
              </details>
            </GlassCard>
          );
        })}
      </div>
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

function MiniScore({ label, value }: { label: string; value?: number }) {
  const color = value === undefined ? "text-slate-500" : value >= 85 ? "text-emerald-100" : value >= 70 ? "text-cyan-100" : value >= 55 ? "text-amber-100" : "text-rose-100";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
      <div className={`metric-number text-xl font-semibold ${color}`}>{value ?? "-"}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Detail({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-300">{content}</pre>
    </div>
  );
}

function CompareLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm leading-6 text-slate-300">{value}</div>
    </div>
  );
}

function recommendationFor(finalScore: number): string {
  if (finalScore >= 85) return "Schedule recruiter call";
  if (finalScore >= 75) return "Strong backup / follow up";
  if (finalScore >= 60) return "Nurture or verify gaps";
  return "Low priority";
}

function buildShortlistRows(input: {
  candidateIds: string[];
  activeRole: RolePipeline;
  candidateById: Map<string, CandidateProfile>;
  matchById: Map<string, MatchResult>;
  interestById: Map<string, InterestResult>;
  ranked: RankedCandidate[];
  settings: ShortlistSettings;
}): ShortlistRow[] {
  const rows: ShortlistRow[] = [];

  input.candidateIds.forEach((candidateId, index) => {
    const candidate = input.candidateById.get(candidateId);
    const match = input.matchById.get(candidateId);
    if (!candidate || !match) return;

    const interest = input.interestById.get(candidateId);
    const rankedRow = input.ranked.find((row) => row.candidate.id === candidateId);
    const finalScore = weightedFinalScore(candidate, match, interest, input.settings) ?? rankedRow?.finalScore ?? match.matchScore;
    rows.push({
      rank: rankedRow?.rank ?? index + 1,
      candidate,
      match,
      interest,
      finalScore,
      recommendation: recommendationFor(finalScore),
      shortlisted: input.activeRole.shortlist.includes(candidateId),
    });
  });

  return rows
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function filterRowsForTab(rows: ShortlistRow[], tab: "recommended" | "manual" | "contacted" | "interested", shortlistIds: string[], outreachByCandidate: Map<string, OutreachResult>): ShortlistRow[] {
  if (tab === "manual") return rows.filter((row) => shortlistIds.includes(row.candidate.id));
  if (tab === "contacted") return rows.filter((row) => outreachByCandidate.has(row.candidate.id));
  if (tab === "interested") return rows.filter((row) => (row.interest?.interestScore ?? 0) >= 75);
  return rows;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function weightsForPreset(preset: ShortlistPreset): ShortlistSettings["weights"] {
  if (preset === "skills_first") return { match: 80, interest: 20, experience: 0, location: 0, availability: 0, risk: 0 };
  if (preset === "interest_first") return { match: 45, interest: 55, experience: 0, location: 0, availability: 0, risk: 0 };
  if (preset === "availability_first") return { match: 50, interest: 25, experience: 0, location: 0, availability: 25, risk: 0 };
  if (preset === "location_first") return { match: 50, interest: 25, experience: 0, location: 25, availability: 0, risk: 0 };
  return { match: 65, interest: 35, experience: 0, location: 0, availability: 0, risk: 0 };
}

function weightedFinalScore(candidate: CandidateProfile, match: MatchResult, interest: InterestResult | undefined, settings: ShortlistSettings): number {
  const availability = availabilityScore(candidate.persona.availability);
  const interestScore = interest?.interestScore ?? Math.round(candidate.persona.openness * 100);
  const experience = match.breakdown.experience;
  const location = match.breakdown.location;
  const risk = match.breakdown.riskAdjustment;
  const weights = settings.weights;
  const numerator =
    match.matchScore * weights.match +
    interestScore * weights.interest +
    experience * weights.experience +
    location * weights.location +
    availability * weights.availability +
    risk * weights.risk;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Math.round(numerator / total);
}

function availabilityScore(availability: string): number {
  const normalized = availability.toLowerCase();
  if (normalized.includes("immediate")) return 98;
  if (normalized.includes("15")) return 92;
  if (normalized.includes("30")) return 84;
  if (normalized.includes("45")) return 72;
  if (normalized.includes("60")) return 58;
  if (normalized.includes("90")) return 38;
  return 60;
}

function briefSummary(row: ShortlistRow): string {
  return [
    `${row.candidate.name} is a ${row.match.scoreBand.toLowerCase()} with ${row.candidate.yearsExperience} years of experience.`,
    `Core evidence: ${row.match.matchedRequiredSkills.slice(0, 5).join(", ") || "skill overlap needs verification"}.`,
    `Next action: ${row.interest?.recommendedNextAction ?? row.recommendation}.`,
  ].join("\n");
}

function toRankedCandidate(row: ShortlistRow): RankedCandidate {
  return {
    roleId: row.match.roleId,
    rank: row.rank,
    candidate: row.candidate,
    match: row.match,
    interest: row.interest ?? {
      roleId: row.match.roleId,
      candidateId: row.candidate.id,
      interestScore: 0,
      interestLevel: "none",
      signals: {
        explicitInterest: 0,
        enthusiasm: 0,
        availability: 0,
        roleMotivation: 0,
        workModeFit: 0,
        objections: 0,
        nextStepReadiness: 0,
      },
      summary: "No interest signal generated yet.",
      recommendedNextAction: "Generate outreach or phone interest check",
    },
    finalScore: row.finalScore,
    recommendation: row.recommendation,
  };
}
