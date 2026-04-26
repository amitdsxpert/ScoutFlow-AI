"use client";

import { ArrowRight, MapPin, ShieldAlert } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { CandidateProfile, MatchResult } from "@/lib/types";

interface CandidateCardProps {
  candidate: CandidateProfile;
  match?: MatchResult;
  selected?: boolean;
  onSelect: () => void;
  onStartOutreach: () => void;
}

export function CandidateCard({ candidate, match, selected = false, onSelect, onStartOutreach }: CandidateCardProps) {
  return (
    <GlassCard className={`p-5 transition hover:border-cyan-300/30 hover:shadow-glow ${selected ? "ring-2 ring-cyan-300/40" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <button onClick={onSelect} className="min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-white">{candidate.name}</h3>
            <span className="rounded-full border border-white/10 bg-white/7 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              {candidate.source.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-300">{candidate.currentTitle}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" />
            {candidate.location} · {candidate.yearsExperience} yrs
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Candidate ID: {candidate.globalCandidateId ?? candidate.id}</p>
        </button>
        {match ? <ScoreBadge score={match.matchScore} label="Match" size="sm" /> : null}
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-300">{candidate.summary}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {candidate.skills.slice(0, 8).map((skill) => (
          <span key={skill} className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-[11px] font-medium text-cyan-100">
            {skill}
          </span>
        ))}
      </div>

      {match ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm leading-6 text-slate-300">{match.explanation}</p>
          {match.risks.length > 0 ? (
            <div className="mt-3 flex items-start gap-2 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{match.risks[0]}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={onSelect} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
          View Match
        </button>
        <button onClick={onStartOutreach} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow">
          Start Outreach
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </GlassCard>
  );
}
