"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { ClipboardList, FileUp, Plus, Sparkles, X } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { DEFAULT_SAMPLE_JD } from "@/lib/demoData";
import { createRolePipeline } from "@/lib/roles";
import { scoreCandidates } from "@/lib/scoring";
import type { CandidateProfile, MatchResult, ParsedJD, RolePipeline, RoleStatus } from "@/lib/types";

interface RoleBuilderProps {
  roles: RolePipeline[];
  activeRole: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  onSaveRole: (role: RolePipeline, activate?: boolean) => void;
  onSelectRole: (roleId: string) => void;
  onRunJDIntelligence: (input: { rawInput: string; mode: "parse" | "generate"; status: RoleStatus; existingRole?: RolePipeline }) => Promise<RolePipeline>;
  onDeleteRole: (roleId: string) => void;
  onDuplicateRole: (role: RolePipeline) => void;
}

type Mode = "paste" | "generate" | "upload";

export function RoleBuilder({
  roles,
  activeRole,
  candidates,
  matches,
  onSaveRole,
  onSelectRole,
  onRunJDIntelligence,
  onDeleteRole,
  onDuplicateRole,
}: RoleBuilderProps) {
  const [mode, setMode] = useState<Mode>("paste");
  const [jdText, setJdText] = useState(activeRole.rawJD || DEFAULT_SAMPLE_JD);
  const [rolePrompt, setRolePrompt] = useState("Senior backend engineer for a GenAI platform, remote India, Python FastAPI PostgreSQL Docker LLM APIs RAG vector databases.");
  const [status, setStatus] = useState("Role intelligence ready.");
  const [loading, setLoading] = useState(false);
  const [newRoleStatus, setNewRoleStatus] = useState<RoleStatus>("active");
  const [drawerRoleId, setDrawerRoleId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  const activeMatches = matches.length ? matches : scoreCandidates(candidates, activeRole.parsedJD, activeRole.id);
  const roleCards = useMemo(() => roles.map((role) => {
    const roleMatches = role.id === activeRole.id ? activeMatches : scoreCandidates(candidates, role.parsedJD, role.id);
    const topMatch = roleMatches.slice().sort((a, b) => b.matchScore - a.matchScore)[0];
    const topCandidate = candidates.find((candidate) => candidate.id === topMatch?.candidateId);
    return { role, topMatch, topCandidate, count: roleMatches.length };
  }), [activeMatches, activeRole.id, candidates, roles]);
  const drawerRole = roles.find((role) => role.id === drawerRoleId);

  const parseCurrentJD = async () => {
    setLoading(true);
    const role = await onRunJDIntelligence({ rawInput: jdText, mode: "parse", status: newRoleStatus });
    setDrawerRoleId(role.id);
    setJdText(role.enrichedJDText ?? role.rawJD);
    setStatus(`JD Intelligence Agent created: ${role.roleTitle}`);
    setLoading(false);
  };

  const updateActiveRole = async () => {
    setLoading(true);
    const role = await onRunJDIntelligence({ rawInput: jdText, mode: "parse", status: activeRole.status, existingRole: activeRole });
    setDrawerRoleId(activeRole.id);
    setJdText(role.enrichedJDText ?? role.rawJD);
    setStatus(`JD Intelligence Agent updated: ${role.roleTitle}`);
    setLoading(false);
  };

  const createBlankRole = () => {
    const role = createRolePipeline(DEFAULT_SAMPLE_JD, "draft");
    onSaveRole({ ...role, roleTitle: "Draft Role Pipeline", status: "draft" }, true);
    setDrawerRoleId(role.id);
    setJdText(DEFAULT_SAMPLE_JD);
    setStatus("Draft role pipeline created.");
  };

  const generateJD = async () => {
    setLoading(true);
    const role = await onRunJDIntelligence({ rawInput: rolePrompt, mode: "generate", status: newRoleStatus });
    setJdText(role.enrichedJDText ?? role.rawJD);
    setDrawerRoleId(role.id);
    setStatus(`JD Intelligence Agent generated: ${role.roleTitle}`);
    setLoading(false);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["txt", "md", "json", "csv"].includes(extension)) {
      setStatus("Unsupported JD file. Use .txt, .md, .json, or basic .csv.");
      return;
    }

    const text = await file.text();
    let content = text;
    if (extension === "json") {
      try {
        const parsed = JSON.parse(text) as { jd?: string; description?: string; text?: string };
        content = parsed.jd || parsed.description || parsed.text || text;
      } catch {
        content = text;
      }
    }
    if (extension === "csv") {
      content = text.split(/\r?\n/).slice(1).join("\n") || text;
    }
    setLoading(true);
    const role = await onRunJDIntelligence({ rawInput: content, mode: "parse", status: newRoleStatus });
    setJdText(role.enrichedJDText ?? role.rawJD);
    setDrawerRoleId(role.id);
    setStatus(`JD Intelligence Agent parsed ${file.name}`);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {editorOpen ? (
      <GlassCard className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Role Editor</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Create or update a job description</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setEditorOpen(false)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
              Close
            </button>
            <button onClick={createBlankRole} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
              <Plus className="h-4 w-4" />
              Draft JD
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Status
              <select value={newRoleStatus} onChange={(event) => setNewRoleStatus(event.target.value as RoleStatus)} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-white outline-none">
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="completed">completed</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <TabButton active={mode === "paste"} onClick={() => setMode("paste")} icon={<ClipboardList className="h-4 w-4" />} label="Paste JD" />
          <TabButton active={mode === "generate"} onClick={() => setMode("generate")} icon={<Sparkles className="h-4 w-4" />} label="Generate JD" />
          <TabButton active={mode === "upload"} onClick={() => setMode("upload")} icon={<FileUp className="h-4 w-4" />} label="Upload JD" />
        </div>

        {mode === "paste" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <textarea
              value={jdText}
              onChange={(event) => setJdText(event.target.value)}
              className="min-h-80 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm leading-6 text-slate-100 outline-none ring-cyan-300/20 transition focus:ring-4"
            />
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold text-white">JD actions</h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">Create a new tracked JD or update the active job record without changing candidate data.</p>
              <button onClick={parseCurrentJD} disabled={loading} className="mt-5 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow disabled:opacity-60">
                {loading ? "Running JD Agent..." : "Create New Role Pipeline"}
              </button>
              <button onClick={updateActiveRole} disabled={loading} className="mt-3 rounded-full border border-white/10 bg-white/7 px-5 py-3 text-sm font-semibold text-white hover:bg-white/12 disabled:opacity-60">
                Update Active Role
              </button>
            </div>
          </div>
        ) : null}

        {mode === "generate" ? (
          <div className="space-y-4">
            <textarea
              value={rolePrompt}
              onChange={(event) => setRolePrompt(event.target.value)}
              placeholder="Describe the kind of role you need"
              className="min-h-48 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm leading-6 text-slate-100 outline-none ring-cyan-300/20 transition focus:ring-4"
            />
            <button
              onClick={generateJD}
              disabled={loading || rolePrompt.trim().length < 8}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? "Generating..." : "Generate Role Pipeline"}
            </button>
          </div>
        ) : null}

        {mode === "upload" ? (
          <label className="flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-300/25 bg-cyan-300/5 p-8 text-center hover:bg-cyan-300/10">
            <FileUp className="mb-4 h-10 w-10 text-cyan-200" />
            <span className="text-lg font-semibold text-white">Upload role description</span>
            <span className="mt-2 text-sm text-slate-400">TXT, MD, JSON, and basic CSV are supported</span>
            <input type="file" accept=".txt,.md,.json,.csv" className="hidden" onChange={handleUpload} />
          </label>
        ) : null}

        <p className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/8 p-3 text-sm text-emerald-100">{status}</p>
      </GlassCard>
      ) : (
        <GlassCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Role Pipelines</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">Manage job descriptions and JD intelligence</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Open the editor when you need to create a new role, generate a structured JD, upload a JD, or rerun JD Intelligence on an existing role.</p>
            </div>
            <button onClick={() => { setEditorOpen(true); setMode("generate"); }} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow">
              <Plus className="h-4 w-4" />
              Create Role
            </button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">JD Library</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">{roles.length} tracked job descriptions</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-slate-300">Select a JD to open details</span>
        </div>
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {roleCards.map(({ role, topMatch, topCandidate, count }) => (
            <div
              key={role.id}
              className={`flex flex-col rounded-2xl border p-4 text-left transition ${
                role.id === activeRole.id ? "border-cyan-300/35 bg-cyan-300/10 shadow-glow" : "border-white/10 bg-white/5 hover:bg-white/8"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectRole(role.id);
                  setJdText(role.rawJD);
                  setDrawerRoleId(role.id);
                  requestAnimationFrame(() => {
                    document.getElementById("role-detail-drawer")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  });
                }}
                className="text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 break-words font-semibold text-white">{role.roleTitle}</p>
                    <p className="mt-1 text-xs text-slate-500">{role.parsedJD.location} · {role.parsedJD.workMode}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/7 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-300">{role.status}</span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-400">
                  <span>JD ID: <span className="text-slate-200">{role.jdId}</span></span>
                  <span>Job ID: <span className="text-slate-200">{role.jobId}</span></span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {role.parsedJD.requiredSkills.slice(0, 4).map((skill) => (
                    <span key={skill} className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-100">{skill}</span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <span>{count} candidates scored</span>
                  <span>{new Date(role.createdAt).toLocaleDateString()}</span>
                  <span className="col-span-2 text-slate-300">Top: {topCandidate ? `${topCandidate.name} (${topMatch?.matchScore})` : "No candidates indexed"}</span>
                  <span className="col-span-2 text-slate-400">Last agent run: {role.agentLogs?.[0]?.timestamp ? new Date(role.agentLogs[0].timestamp).toLocaleString() : new Date(role.updatedAt).toLocaleString()}</span>
                </div>
              </button>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={() => { onSelectRole(role.id); setJdText(role.rawJD); setDrawerRoleId(""); setEditorOpen(true); setMode("paste"); }}
                  className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-300/20"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicateRole(role)}
                  className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteRole(role.id)}
                  className="ml-auto rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-300/20"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {drawerRole ? <JDDetailDrawer role={drawerRole} onClose={() => setDrawerRoleId("")} /> : null}
    </div>
  );
}

function JDDetailDrawer({ role, onClose }: { role: RolePipeline; onClose: () => void }) {
  return (
    <GlassCard id="role-detail-drawer" className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Role Workspace Detail</p>
            <h2 className="mt-1 truncate text-xl font-semibold text-white" title={role.roleTitle}>{role.roleTitle}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full border border-white/10 p-2.5 text-white hover:bg-white/10" aria-label="Close JD details">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ParsedJDPreview parsedJD={role.parsedJD} activeRole={role} />
    </GlassCard>
  );
}

function ParsedJDPreview({ parsedJD, activeRole }: { parsedJD: ParsedJD; activeRole: RolePipeline }) {
  return (
    <GlassCard className="h-fit p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">JD Intelligence</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{parsedJD.roleTitle}</h2>
          <p className="mt-1 text-sm text-slate-400">{parsedJD.seniority} · {parsedJD.department}</p>
        </div>
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-right">
          <div className="metric-number text-2xl font-semibold text-emerald-100">{parsedJD.qualityScore}</div>
          <div className="text-[10px] uppercase tracking-wide text-emerald-200/70">JD quality</div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Info label="Location" value={parsedJD.location} />
        <Info label="Work Mode" value={parsedJD.workMode} />
        <Info label="Minimum Exp" value={`${parsedJD.minYearsExperience}+ years`} />
      </div>

      <Section title="Required Skills" values={parsedJD.requiredSkills} tone="cyan" />
      <Section title="Preferred Skills" values={parsedJD.preferredSkills} tone="emerald" />

      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-white">Pipeline Metadata</h3>
        <div className="grid gap-2 text-sm text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">JD ID: {activeRole.jdId}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Job ID: {activeRole.jobId}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Status: {activeRole.status}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Provider used: {providerDisplay(activeRole.agentProviderUsed)}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Model: {activeRole.agentModelUsed ?? "Local deterministic fallback"}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Agent confidence: {activeRole.agentConfidence ?? parsedJD.qualityScore}%</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Created: {new Date(activeRole.createdAt).toLocaleString()}</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Shortlist: {activeRole.shortlist.length} candidates</div>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-white">Agent Reasoning</h3>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-300">
          {activeRole.agentReasoningSummary ?? "No JD agent reasoning stored yet."}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-white">Raw JD Input</h3>
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/45 p-3 font-sans text-sm leading-6 text-slate-300">{activeRole.rawJD}</pre>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-white">Enriched JD</h3>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/45 p-3 font-sans text-sm leading-6 text-slate-300">{activeRole.enrichedJDText ?? activeRole.parsedJD.rawText}</pre>
      </div>

      <div className="mt-6">
        <h3 className="mb-3 text-sm font-semibold text-white">Screening Questions</h3>
        <div className="grid gap-2">
          {parsedJD.screeningQuestions.map((question) => (
            <div key={question} className="rounded-2xl bg-slate-950/45 p-3 text-sm text-slate-300">
              {question}
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function providerDisplay(provider?: string): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  return "Local Fallback";
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
        active ? "bg-cyan-300 text-slate-950 shadow-glow" : "border border-white/10 bg-white/7 text-slate-200 hover:bg-white/12"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold capitalize text-white">{value}</div>
    </div>
  );
}

function Section({ title, values, tone }: { title: string; values: string[]; tone: "cyan" | "emerald" }) {
  const color = tone === "cyan" ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  return (
    <div className="mt-6">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className={`rounded-full border px-3 py-1 text-xs font-semibold ${color}`}>
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
