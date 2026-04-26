"use client";

import { useMemo, useState } from "react";
import { Database, Grid2X2, List, Search, Send, Users } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { CandidateList, CandidateProfile, InterestResult, MatchResult, OutreachResult, RankedCandidate, RolePipeline } from "@/lib/types";

interface CandidateDiscoveryProps {
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interests: InterestResult[];
  ranked: RankedCandidate[];
  outreachResults: OutreachResult[];
  roles: RolePipeline[];
  activeRole: RolePipeline;
  selectedCandidateIds: string[];
  shortlistIds: string[];
  customLists: CandidateList[];
  onToggleCandidate: (candidateId: string) => void;
  onSetSelection: (candidateIds: string[]) => void;
  onStartOutreach: (candidateIds: string[]) => void;
  onLoadDemo: () => void;
  onShortlist: (candidateIds: string[], action: "add" | "remove") => void;
  onCreateList: (name: string, candidateIds: string[]) => void;
  onAddToList: (listId: string, candidateIds: string[]) => void;
  onDeleteList: (listId: string) => void;
  onRenameList: (listId: string, name: string) => void;
  onRemoveFromList: (listId: string, candidateIds: string[]) => void;
  onSelectRole: (roleId: string) => void;
  onRunMatching: () => void;
}

type SortKey = "match" | "interest" | "final" | "experience" | "recent" | "name";
type ViewMode = "table" | "cards";
type SearchMode = "any" | "all";
type QuickFilter = "all" | "required" | "missing_one" | "experience" | "remote" | "genai" | "interest" | "shortlist_ready";

interface CandidateRow {
  candidate: CandidateProfile;
  match?: MatchResult;
  interest?: InterestResult;
  rank?: RankedCandidate;
  finalScore?: number;
  shortlisted: boolean;
}

export function CandidateDiscovery({
  candidates,
  matches,
  interests,
  ranked,
  outreachResults,
  roles,
  activeRole,
  selectedCandidateIds,
  shortlistIds,
  customLists,
  onToggleCandidate,
  onSetSelection,
  onStartOutreach,
  onLoadDemo,
  onShortlist,
  onCreateList,
  onAddToList,
  onDeleteList,
  onRenameList,
  onRemoveFromList,
  onSelectRole,
  onRunMatching,
}: CandidateDiscoveryProps) {
  const [query, setQuery] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode>("all");
  const [source, setSource] = useState("all");
  const [skill, setSkill] = useState("all");
  const [location, setLocation] = useState("all");
  const [persona, setPersona] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [status, setStatus] = useState("all");
  const [segment, setSegment] = useState("all");
  const [minYears, setMinYears] = useState(0);
  const [matchMin, setMatchMin] = useState(0);
  const [interestMin, setInterestMin] = useState(0);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("final");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [listName, setListName] = useState("");
  const [targetListId, setTargetListId] = useState("");
  const [renameSegmentName, setRenameSegmentName] = useState("");
  const [drawerCandidateId, setDrawerCandidateId] = useState("");

  const matchById = useMemo(() => new Map(matches.map((match) => [match.candidateId, match])), [matches]);
  const interestById = useMemo(() => new Map(interests.map((interest) => [interest.candidateId, interest])), [interests]);
  const rankById = useMemo(() => new Map(ranked.map((row) => [row.candidate.id, row])), [ranked]);

  const rows = useMemo<CandidateRow[]>(() => candidates.map((candidate) => {
    const match = matchById.get(candidate.id);
    const interest = interestById.get(candidate.id);
    const rank = rankById.get(candidate.id);
    const finalScore = rank?.finalScore ?? (match && interest ? Math.round(match.matchScore * 0.65 + interest.interestScore * 0.35) : undefined);
    return {
      candidate,
      match,
      interest,
      rank,
      finalScore,
      shortlisted: shortlistIds.includes(candidate.id),
    };
  }), [candidates, interestById, matchById, rankById, shortlistIds]);

  const skills = useMemo(() => Array.from(new Set(candidates.flatMap((candidate) => candidate.skills))).sort(), [candidates]);
  const locations = useMemo(() => Array.from(new Set(candidates.map((candidate) => candidate.location))).sort(), [candidates]);
  const sources = useMemo(() => Array.from(new Set(candidates.map((candidate) => candidate.source))).sort(), [candidates]);
  const personas = useMemo(() => Array.from(new Set(candidates.map((candidate) => candidate.persona.type))).sort(), [candidates]);
  const statuses = useMemo(() => Array.from(new Set(rows.map((row) => candidateStatus(row)))).sort(), [rows]);
  const roleLabels = useMemo(() => new Map(roles.map((role) => [role.id, role.roleTitle])), [roles]);
  const roleKeywordSuggestions = useMemo(() => Array.from(new Set([
    ...activeRole.parsedJD.requiredSkills,
    ...activeRole.parsedJD.preferredSkills,
  ])).slice(0, 12), [activeRole.parsedJD.preferredSkills, activeRole.parsedJD.requiredSkills]);
  const segmentOptions = useMemo(() => [
    { id: "all", name: "All Candidates" },
    { id: "recommended", name: "Recommended for Role" },
    { id: "outreach_ready", name: "Outreach Ready" },
    { id: "contacted", name: "Contacted" },
    { id: "interested", name: "Interested" },
    { id: "shortlisted", name: "Shortlisted" },
    { id: "low_priority", name: "Low Priority" },
    ...customLists.map((list) => ({ id: list.id, name: list.name })),
  ], [customLists]);

  const filtered = useMemo(() => {
    const activeKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const filteredRows = rows.filter((row) => {
      const candidate = row.candidate;
      const searchable = [
        candidate.name,
        candidate.currentTitle,
        candidate.currentCompany,
        candidate.location,
        candidate.skills.join(" "),
        candidate.projects.join(" "),
        candidate.summary,
        candidate.source,
        candidateStatus(row),
        (candidate.segments ?? []).join(" "),
        customLists.filter((list) => list.candidateIds.includes(candidate.id)).map((list) => list.name).join(" "),
        candidate.globalCandidateId,
      ].filter(Boolean).join(" ").toLowerCase();

      if (activeKeywords.length) {
        const matchesKeyword = searchMode === "all"
          ? activeKeywords.every((keyword) => searchable.includes(keyword))
          : activeKeywords.some((keyword) => searchable.includes(keyword));
        if (!matchesKeyword) return false;
      }
      if (source !== "all" && candidate.source !== source) return false;
      if (skill !== "all" && !candidate.skills.some((item) => item.toLowerCase() === skill.toLowerCase())) return false;
      if (location !== "all" && candidate.location !== location) return false;
      if (persona !== "all" && candidate.persona.type !== persona) return false;
      if (availability !== "all" && !candidate.persona.availability.toLowerCase().includes(availability.toLowerCase())) return false;
      if (status !== "all" && candidateStatus(row) !== status) return false;
      if (!passesSegmentFilter(row, segment, customLists)) return false;
      if (candidate.yearsExperience < minYears) return false;
      if ((row.match?.matchScore ?? 0) < matchMin) return false;
      if ((row.interest?.interestScore ?? 0) < interestMin) return false;
      if (shortlistedOnly && !row.shortlisted) return false;
      if (!passesQuickFilter(row, quickFilter, activeRole)) return false;
      return true;
    });

    return filteredRows.sort((a, b) => {
      if (sortBy === "match") return (b.match?.matchScore ?? 0) - (a.match?.matchScore ?? 0);
      if (sortBy === "interest") return (b.interest?.interestScore ?? 0) - (a.interest?.interestScore ?? 0);
      if (sortBy === "final") return (b.finalScore ?? b.match?.matchScore ?? 0) - (a.finalScore ?? a.match?.matchScore ?? 0);
      if (sortBy === "experience") return b.candidate.yearsExperience - a.candidate.yearsExperience;
      if (sortBy === "recent") return new Date(b.candidate.addedAt ?? 0).getTime() - new Date(a.candidate.addedAt ?? 0).getTime();
      return a.candidate.name.localeCompare(b.candidate.name);
    });
  }, [activeRole, availability, customLists, interestMin, keywords, location, matchMin, minYears, persona, quickFilter, rows, searchMode, segment, shortlistedOnly, skill, sortBy, source, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedVisible = visible.filter((row) => selectedCandidateIds.includes(row.candidate.id)).length;
  const selectedRows = rows.filter((row) => selectedCandidateIds.includes(row.candidate.id));
  const selectedCount = selectedRows.length;
  const drawerCandidate = candidates.find((candidate) => candidate.id === drawerCandidateId);
  const drawerMatch = drawerCandidate ? matchById.get(drawerCandidate.id) : undefined;
  const drawerInterest = drawerCandidate ? interestById.get(drawerCandidate.id) : undefined;
  const drawerOutreach = drawerCandidate ? outreachResults.filter((result) => result.candidateId === drawerCandidate.id) : [];

  const selectVisible = () => onSetSelection(visible.map((row) => row.candidate.id));
  const clearSelection = () => onSetSelection([]);

  if (candidates.length === 0) {
    return (
      <GlassCard className="p-8 text-center">
        <Database className="mx-auto h-12 w-12 text-cyan-200" />
        <h2 className="mt-4 text-2xl font-semibold text-white">No candidates indexed</h2>
        <p className="mt-2 text-sm text-slate-400">Index an internal pool or upload candidates to start role-based recommendations.</p>
        <button onClick={onLoadDemo} className="mt-6 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow">
          Index internal pool
        </button>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <GlassCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Candidate Intelligence</p>
            <h2 className="mt-1 max-w-4xl truncate text-2xl font-semibold text-white">{filtered.length} candidates for {activeRole.roleTitle}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onRunMatching} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
              Run Matching
            </button>
            <button
              onClick={() => onStartOutreach(selectedCandidateIds)}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Bulk Outreach
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_150px_190px_160px]">
          <Select value={activeRole.id} onChange={(value) => { onSelectRole(value); setPage(1); }} options={roles.map((role) => role.id)} optionLabels={roleLabels} label="Active role for matching" />
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Keyword search
            <span className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const trimmed = query.trim();
                    if (!trimmed) return;
                    setKeywords((current) => current.some((item) => item.toLowerCase() === trimmed.toLowerCase()) ? current : [...current, trimmed]);
                    setQuery("");
                    setPage(1);
                  } else if (event.key === "Backspace" && !query && keywords.length) {
                    setKeywords((current) => current.slice(0, -1));
                    setPage(1);
                  }
                }}
                placeholder="Type a keyword and press Enter to add a chip..."
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 py-3 pl-11 pr-4 text-sm normal-case text-white outline-none ring-cyan-300/20 transition focus:ring-4"
              />
            </span>
          </label>
          <Select value={searchMode} onChange={(value) => setSearchMode(value as SearchMode)} options={["all", "any"]} label="Search mode" />
          <Select value={source} onChange={setSource} options={["all", ...sources]} label="Source" />
          <Select value={sortBy} onChange={(value) => setSortBy(value as SortKey)} options={["final", "match", "interest", "experience", "recent", "name"]} label="Sort" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400/70">Role keywords</span>
          {roleKeywordSuggestions.map((keyword) => (
            <button
              key={keyword}
              type="button"
              onClick={() => {
                setKeywords((current) => current.some((item) => item.toLowerCase() === keyword.toLowerCase()) ? current : [...current, keyword]);
                setPage(1);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
            >
              + {keyword}
            </button>
          ))}
        </div>

        {keywords.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400/70">Keywords</span>
            {keywords.map((keyword) => (
              <span key={keyword} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                {keyword}
                <button
                  type="button"
                  onClick={() => {
                    setKeywords((current) => current.filter((item) => item !== keyword));
                    setPage(1);
                  }}
                  className="text-cyan-100 hover:text-white"
                  aria-label={`Remove ${keyword}`}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                setKeywords([]);
                setPage(1);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
            >
              Clear all
            </button>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Select value={segment} onChange={setSegment} options={segmentOptions.map((item) => item.id)} optionLabels={new Map(segmentOptions.map((item) => [item.id, item.name]))} label="Segment" />
          <Select value={skill} onChange={setSkill} options={["all", ...skills]} label="Skill" />
          <Select value={status} onChange={setStatus} options={["all", ...statuses]} label="Status" />
        </div>

        <details className="group mt-3 rounded-2xl border border-white/10 bg-white/[0.025] open:bg-white/[0.04]">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300 hover:text-white">
            <span className="inline-flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90">›</span>
              Advanced filters (location, persona, availability, thresholds)
            </span>
          </summary>
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Select value={location} onChange={setLocation} options={["all", ...locations]} label="Location" />
            <Select value={persona} onChange={setPersona} options={["all", ...personas]} label="Persona" />
            <Select value={availability} onChange={setAvailability} options={["all", "Immediate", "15", "30", "45", "60", "90"]} label="Availability" />
            <NumberInput label="Min years" value={minYears} onChange={setMinYears} />
            <NumberInput label="Match min" value={matchMin} onChange={setMatchMin} />
            <NumberInput label="Interest min" value={interestMin} onChange={setInterestMin} />
          </div>
        </details>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[
            ["all", "All role-fit candidates"],
            ["required", "Has required skills"],
            ["missing_one", "Missing only 1 required skill"],
            ["experience", `${activeRole.parsedJD.minYearsExperience}+ years experience`],
            ["remote", "Remote compatible"],
            ["genai", "Strong GenAI fit"],
            ["interest", "High interest"],
            ["shortlist_ready", "Shortlist ready"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setQuickFilter(id as QuickFilter);
                setPage(1);
              }}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${quickFilter === id ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/7 text-slate-300 hover:bg-white/12"}`}
            >
              {label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-slate-300">
            <input type="checkbox" checked={shortlistedOnly} onChange={(event) => setShortlistedOnly(event.target.checked)} />
            Shortlisted only
          </label>
          <button onClick={() => setViewMode("table")} className={`rounded-full p-2 ${viewMode === "table" ? "bg-cyan-300 text-slate-950" : "border border-white/10 text-slate-300"}`} aria-label="Table view">
            <List className="h-4 w-4" />
          </button>
          <button onClick={() => setViewMode("cards")} className={`rounded-full p-2 ${viewMode === "cards" ? "bg-cyan-300 text-slate-950" : "border border-white/10 text-slate-300"}`} aria-label="Card view">
            <Grid2X2 className="h-4 w-4" />
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <Users className="h-4 w-4 text-cyan-200" />
            {selectedCount} selected · {selectedVisible} visible selected
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={selectVisible} className="rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white hover:bg-white/12">Select visible</button>
            <button onClick={clearSelection} className="rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white hover:bg-white/12">Clear</button>
            <button onClick={() => onShortlist(selectedCandidateIds, "add")} disabled={!selectedCount} className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-50">Add to shortlist</button>
            <button onClick={() => onShortlist(selectedCandidateIds, "remove")} disabled={!selectedCount} className="rounded-full border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50">Remove from shortlist</button>
            <input value={listName} onChange={(event) => setListName(event.target.value)} placeholder="New segment name" className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none" />
            <button onClick={() => { onCreateList(listName, selectedCandidateIds); setListName(""); }} disabled={!selectedCount || !listName.trim()} className="rounded-full bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Create segment</button>
            <select value={targetListId} onChange={(event) => setTargetListId(event.target.value)} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none">
              <option value="">Add to existing segment</option>
              {customLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <button onClick={() => onAddToList(targetListId, selectedCandidateIds)} disabled={!selectedCount || !targetListId} className="rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Add</button>
            <input value={renameSegmentName} onChange={(event) => setRenameSegmentName(event.target.value)} placeholder="Rename segment" className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none" />
            <button onClick={() => { onRenameList(targetListId, renameSegmentName); setRenameSegmentName(""); }} disabled={!targetListId || !renameSegmentName.trim()} className="rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Rename</button>
            <button onClick={() => onRemoveFromList(targetListId, selectedCandidateIds)} disabled={!selectedCount || !targetListId} className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-50">Remove from segment</button>
            <button onClick={() => { if (window.confirm("Delete this segment? Candidates will remain indexed.")) onDeleteList(targetListId); }} disabled={!targetListId} className="rounded-full border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50">Delete segment</button>
          </div>
        </div>
      </GlassCard>

      <div>
        {viewMode === "table" ? (
          <CandidateTable
            rows={visible}
            selectedCandidateIds={selectedCandidateIds}
            onToggleCandidate={onToggleCandidate}
            onStartOutreach={onStartOutreach}
            onOpenCandidate={setDrawerCandidateId}
          />
        ) : (
          <CandidateCards
            rows={visible}
            selectedCandidateIds={selectedCandidateIds}
            onToggleCandidate={onToggleCandidate}
            onStartOutreach={onStartOutreach}
            onOpenCandidate={setDrawerCandidateId}
          />
        )}
      </div>

      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-400">Page {page} of {totalPages} · {filtered.length} filtered candidates</div>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white outline-none">
              <option value={20}>20 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
            <button onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={page === 1}>Previous</button>
            <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={page === totalPages}>Next</button>
          </div>
        </div>
      </GlassCard>

      {drawerCandidate && drawerMatch ? (
        <CandidateDrawer
          candidate={drawerCandidate}
          match={drawerMatch}
          interest={drawerInterest}
          outreachResults={drawerOutreach}
          onClose={() => setDrawerCandidateId("")}
          onStartOutreach={() => onStartOutreach([drawerCandidate.id])}
        />
      ) : null}
    </div>
  );
}

function CandidateTable({
  rows,
  selectedCandidateIds,
  onToggleCandidate,
  onStartOutreach,
  onOpenCandidate,
}: {
  rows: CandidateRow[];
  selectedCandidateIds: string[];
  onToggleCandidate: (candidateId: string) => void;
  onStartOutreach: (candidateIds: string[]) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  return (
    <GlassCard className="overflow-hidden">
      <div className="scrollbar-slim overflow-auto">
        <table className="min-w-[1280px] w-full text-left text-sm">
          <thead className="bg-white/7 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="p-3">Select</th>
              <th className="p-3">Name</th>
              <th className="p-3">Candidate ID</th>
              <th className="p-3">Title</th>
              <th className="p-3">Location</th>
              <th className="p-3">Years</th>
              <th className="p-3">Source</th>
              <th className="p-3">Top Skills</th>
              <th className="p-3">Match Score</th>
              <th className="p-3">Interest Score</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.candidate.id} onClick={() => onToggleCandidate(row.candidate.id)} className={`cursor-pointer border-t border-white/10 hover:bg-white/[0.05] ${selectedCandidateIds.includes(row.candidate.id) ? "bg-cyan-300/[0.06]" : ""}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selectedCandidateIds.includes(row.candidate.id)} onClick={(event) => event.stopPropagation()} onChange={() => onToggleCandidate(row.candidate.id)} />
                </td>
                <td className="p-3">
                  <p className="font-semibold text-white">{row.candidate.name}</p>
                  {row.candidate.currentCompany ? <p className="mt-1 text-xs text-slate-500">{row.candidate.currentCompany}</p> : null}
                </td>
                <td className="p-3 text-xs text-slate-400">{row.candidate.globalCandidateId ?? row.candidate.id}</td>
                <td className="p-3 text-slate-300">{row.candidate.currentTitle}</td>
                <td className="p-3 text-slate-300">{row.candidate.location}</td>
                <td className="p-3 metric-number text-slate-200">{row.candidate.yearsExperience}</td>
                <td className="p-3"><Badge>{row.candidate.source.replace("_", " ")}</Badge></td>
                <td className="p-3">
                  <div className="flex max-w-xs flex-wrap gap-1.5">
                    {row.candidate.skills.slice(0, 4).map((item) => <Chip key={item}>{item}</Chip>)}
                  </div>
                </td>
                <td className="p-3 metric-number text-cyan-100">{row.match?.matchScore ?? "-"}</td>
                <td className="p-3 metric-number text-emerald-100">{row.interest?.interestScore ?? "-"}</td>
                <td className="p-3"><Badge tone={candidateStatus(row) === "shortlisted" || candidateStatus(row) === "interested" ? "emerald" : "default"}>{candidateStatus(row).replace("_", " ")}</Badge></td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={(event) => { event.stopPropagation(); onOpenCandidate(row.candidate.id); }} className="rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white">Open</button>
                    <button onClick={(event) => { event.stopPropagation(); onStartOutreach([row.candidate.id]); }} className="rounded-full bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950">Outreach</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function CandidateCards({
  rows,
  selectedCandidateIds,
  onToggleCandidate,
  onStartOutreach,
  onOpenCandidate,
}: {
  rows: CandidateRow[];
  selectedCandidateIds: string[];
  onToggleCandidate: (candidateId: string) => void;
  onStartOutreach: (candidateIds: string[]) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  return (
    <div className="grid gap-4 2xl:grid-cols-3">
      {rows.map((row) => (
        <GlassCard key={row.candidate.id} className={`cursor-pointer p-5 ${selectedCandidateIds.includes(row.candidate.id) ? "ring-1 ring-cyan-300/35" : ""}`} onClick={() => onToggleCandidate(row.candidate.id)}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <input className="mt-2" type="checkbox" checked={selectedCandidateIds.includes(row.candidate.id)} onClick={(event) => event.stopPropagation()} onChange={() => onToggleCandidate(row.candidate.id)} />
              <button onClick={(event) => { event.stopPropagation(); onOpenCandidate(row.candidate.id); }} className="text-left">
                <h3 className="text-lg font-semibold text-white">{row.candidate.name}</h3>
                <p className="mt-1 text-sm text-slate-300">{row.candidate.currentTitle}</p>
                <p className="mt-1 text-xs text-slate-500">{row.candidate.location} · {row.candidate.yearsExperience} yrs · {row.candidate.source.replace("_", " ")}</p>
                <p className="mt-1 text-[11px] text-slate-500">Candidate ID: {row.candidate.globalCandidateId ?? row.candidate.id}</p>
              </button>
            </div>
            {row.match ? <ScoreBadge score={row.match.matchScore} label="Match" size="sm" /> : null}
          </div>
          <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">{row.match?.explanation ?? row.candidate.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {row.candidate.skills.slice(0, 8).map((item) => <Chip key={item}>{item}</Chip>)}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <MiniScore label="Interest" value={row.interest?.interestScore} />
              <MiniScore label="Final" value={row.finalScore ?? row.match?.matchScore} />
            </div>
            <button onClick={(event) => { event.stopPropagation(); onStartOutreach([row.candidate.id]); }} className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">Outreach</button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function CandidateDrawer({
  candidate,
  match,
  interest,
  outreachResults,
  onClose,
  onStartOutreach,
}: {
  candidate: CandidateProfile;
  match: MatchResult;
  interest?: InterestResult;
  outreachResults: OutreachResult[];
  onClose: () => void;
  onStartOutreach: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="scrollbar-slim ml-auto h-full w-full max-w-2xl overflow-auto border-l border-white/10 bg-slate-950/95 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Candidate Profile</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{candidate.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{candidate.currentTitle} · {candidate.location}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onStartOutreach} className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950">Outreach</button>
            <button onClick={onClose} className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Close</button>
          </div>
        </div>
        <CandidateDetail candidate={candidate} match={match} interest={interest} outreachResults={outreachResults} />
      </aside>
    </div>
  );
}

function CandidateDetail({ candidate, match, interest, outreachResults }: { candidate: CandidateProfile; match: MatchResult; interest?: InterestResult; outreachResults: OutreachResult[] }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Profile Summary</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{candidate.summary}</p>
          <p className="mt-2 text-xs text-slate-500">{candidate.currentCompany ?? "Company not listed"} · {candidate.yearsExperience} years · {candidate.source.replace("_", " ")}</p>
          <p className="mt-1 text-xs text-slate-500">Candidate ID: {candidate.globalCandidateId ?? candidate.id}</p>
        </div>
        <ScoreBadge score={match.matchScore} label="Match" />
      </div>

      <DetailBlock title="Skills" items={candidate.skills} chips tone="cyan" />
      <DetailBlock title="Projects" items={candidate.projects.length ? candidate.projects : ["No projects listed."]} />

      <div className="mt-6 grid grid-cols-2 gap-3">
        {Object.entries(match.breakdown).map(([label, score]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="metric-number text-lg font-semibold text-white">{score}%</div>
            <div className="text-[11px] capitalize text-slate-500">{label.replace(/([A-Z])/g, " $1")}</div>
          </div>
        ))}
      </div>
      <DetailBlock title="Recommendation" items={[match.explanation]} />
      <DetailBlock title="Matched Required Skills" items={match.matchedRequiredSkills.length ? match.matchedRequiredSkills : ["No required skills matched explicitly."]} chips tone="cyan" />
      <DetailBlock title="Matched Preferred Skills" items={match.matchedPreferredSkills.length ? match.matchedPreferredSkills : ["No preferred skills matched explicitly."]} chips tone="emerald" />
      <DetailBlock title="Missing Required Skills" items={match.missingSkills.length ? match.missingSkills : ["No required skill gaps detected."]} chips tone="amber" />
      <DetailBlock title="Fit Signals" items={[match.experienceFit, match.locationFit, match.domainRelevance, `Confidence: ${match.confidence}%`]} />
      <DetailBlock title="Risk Flags" items={match.risks.length ? match.risks : ["No major risk detected."]} />
      <DetailBlock title="Recruiter Verification Questions" items={match.recruiterQuestions} />
      <DetailBlock title="Outreach History" items={outreachResults.length ? outreachResults.map((result) => `${result.channel.toUpperCase()}: ${result.simulatedReply ?? result.phoneTranscript ?? result.message}`) : ["No outreach generated yet."]} />
      {interest ? <DetailBlock title="Interest Summary" items={[`${interest.interestScore} · ${interest.summary}`, interest.recommendedNextAction]} /> : <DetailBlock title="Interest Summary" items={["No interest score generated yet. Run outreach or include Phone in the campaign."]} />}
    </div>
  );
}

function Select({ value, onChange, options, label, optionLabels }: { value: string; onChange: (value: string) => void; options: string[]; label: string; optionLabels?: Map<string, string> }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm normal-case text-white outline-none ring-cyan-300/20 transition focus:ring-4"
        aria-label={label}
      >
        {options.map((option) => <option key={option} value={option}>{optionLabels?.get(option) ?? option.replace("_", " ")}</option>)}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs text-slate-400">
      {label}
      <input value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} type="number" min={0} max={100} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none" />
    </label>
  );
}

function DetailBlock({ title, items, chips = false, tone = "default" }: { title: string; items: string[]; chips?: boolean; tone?: "cyan" | "emerald" | "amber" | "default" }) {
  const color = tone === "cyan" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : tone === "emerald" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : tone === "amber" ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300";
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      {chips ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => <span key={item} className={`rounded-full border px-3 py-1 text-xs ${color}`}>{item}</span>)}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => <div key={item} className={`rounded-2xl border p-3 text-sm leading-6 ${color}`}>{item}</div>)}
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "emerald" }) {
  const color = tone === "emerald" ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/7 text-slate-300";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${color}`}>{children}</span>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-[11px] font-medium text-cyan-100">{children}</span>;
}

function MiniScore({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-center">
      <div className="metric-number text-sm font-semibold text-white">{value ?? "-"}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function passesQuickFilter(row: CandidateRow, quickFilter: QuickFilter, role: RolePipeline): boolean {
  if (quickFilter === "all") return (row.finalScore ?? row.match?.matchScore ?? 0) >= 0;
  if (quickFilter === "required") return (row.match?.missingSkills.length ?? 99) === 0;
  if (quickFilter === "missing_one") return (row.match?.missingSkills.length ?? 99) <= 1;
  if (quickFilter === "experience") return row.candidate.yearsExperience >= role.parsedJD.minYearsExperience;
  if (quickFilter === "remote") return role.parsedJD.workMode === "remote" ? row.candidate.location.toLowerCase().includes("india") || row.candidate.persona.type === "remote_only" : true;
  if (quickFilter === "genai") {
    const text = `${row.candidate.skills.join(" ")} ${row.candidate.projects.join(" ")} ${row.candidate.summary}`.toLowerCase();
    return text.includes("llm") || text.includes("rag") || text.includes("genai") || text.includes("vector");
  }
  if (quickFilter === "interest") return (row.interest?.interestScore ?? 0) >= 75;
  if (quickFilter === "shortlist_ready") return (row.finalScore ?? row.match?.matchScore ?? 0) >= 80;
  return true;
}

function candidateStatus(row: CandidateRow): string {
  if (row.shortlisted) return "shortlisted";
  if ((row.interest?.interestScore ?? 0) >= 75) return "interested";
  if (row.interest) return "replied";
  if ((row.finalScore ?? row.match?.matchScore ?? 0) >= 75) return "recommended";
  if ((row.finalScore ?? row.match?.matchScore ?? 0) < 45) return row.candidate.status ?? "low_priority";
  return row.candidate.status ?? "new";
}

function passesSegmentFilter(row: CandidateRow, segment: string, customLists: CandidateList[]): boolean {
  if (segment === "all") return true;
  if (segment === "recommended") return (row.finalScore ?? row.match?.matchScore ?? 0) >= 75;
  if (segment === "outreach_ready") return ["recommended", "outreach_ready", "shortlisted"].includes(candidateStatus(row));
  if (segment === "contacted") return ["contacted", "replied", "interested"].includes(candidateStatus(row));
  if (segment === "interested") return candidateStatus(row) === "interested";
  if (segment === "shortlisted") return row.shortlisted;
  if (segment === "low_priority") return candidateStatus(row) === "low_priority";
  const custom = customLists.find((list) => list.id === segment);
  return custom ? custom.candidateIds.includes(row.candidate.id) : true;
}
