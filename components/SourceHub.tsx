"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { Check, Database, Eye, FileJson, FileSpreadsheet, FileText, HardDrive, UploadCloud, Loader2, AlertTriangle, Settings } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { demoCandidates } from "@/lib/demoData";
import { candidateFromResumeText, parseCandidateCsv, parseCandidateJson } from "@/lib/csv";
import type { AgentId, AgentStatus, CandidateProfile, CandidateSource } from "@/lib/types";

interface SourceHubProps {
  candidates: CandidateProfile[];
  onLoadCandidates: (candidates: CandidateProfile[], replace?: boolean, sourceLabel?: string) => void;
  onAgentActivity: (agentId: AgentId, status: AgentStatus, summary: string) => void;
}

type PreviewKind = "csv" | "json" | "resume" | "database" | "metabase" | null;

interface ConnectorStatus {
  configured: boolean;
  loading: boolean;
  error?: string;
  count?: number;
  lastTest?: string;
}

export function SourceHub({ candidates, onLoadCandidates, onAgentActivity }: SourceHubProps) {
  const [status, setStatus] = useState("Candidate sources are ready for indexing.");
  const [previewKind, setPreviewKind] = useState<PreviewKind>(null);
  const [previewCandidates, setPreviewCandidates] = useState<CandidateProfile[]>([]);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<string[]>([]);
  const [dbOption, setDbOption] = useState("Engineering Candidates DB");
  const [metabaseQuestion, setMetabaseQuestion] = useState("Backend Engineers India");
  const [lastImported, setLastImported] = useState<Record<string, string>>({});
  const [connectorStatuses, setConnectorStatuses] = useState<Record<string, ConnectorStatus>>({
    database: { configured: false, loading: false },
    metabase: { configured: false, loading: false },
    resume: { configured: false, loading: false },
  });

  const sourceCounts = useMemo(() => {
    const counts = new Map<CandidateSource, number>();
    candidates.forEach((candidate) => counts.set(candidate.source, (counts.get(candidate.source) ?? 0) + 1));
    return counts;
  }, [candidates]);

  const markImported = (source: string) => {
    setLastImported((current) => ({ ...current, [source]: new Date().toLocaleString() }));
  };

  const loadInternalPool = () => {
    onLoadCandidates(demoCandidates, true, "Internal Candidate Database");
    markImported("internal");
    setStatus("Indexed curated internal candidate database.");
    onAgentActivity("source_discovery", "completed", "Indexed curated internal candidate database.");
  };

  const loadMock = (source: CandidateSource, sourceLabel: string, subset: CandidateProfile[]) => {
    const next = subset.map((candidate) => ({
      ...candidate,
      id: `${source}-${candidate.id}`,
      source,
      addedAt: new Date().toISOString(),
    }));
    onLoadCandidates(next, false, sourceLabel);
    markImported(sourceLabel);
    setStatus(`Indexed ${next.length} candidates from ${sourceLabel}.`);
    onAgentActivity("source_discovery", "completed", `Indexed ${next.length} candidates from ${sourceLabel}.`);
  };

  const testDatabaseConnector = useCallback(async () => {
    setConnectorStatuses((prev) => ({ ...prev, database: { ...prev.database, loading: true, error: undefined } }));
    try {
      const response = await fetch("/api/connector/database", { method: "GET" });
      const data = await response.json();
      setConnectorStatuses((prev) => ({
        ...prev,
        database: {
          configured: data.configured,
          loading: false,
          count: data.count,
          error: data.error,
          lastTest: new Date().toISOString(),
        },
      }));
    } catch (error) {
      setConnectorStatuses((prev) => ({
        ...prev,
        database: {
          configured: false,
          loading: false,
          error: error instanceof Error ? error.message : "Connection failed",
          lastTest: new Date().toISOString(),
        },
      }));
    }
  }, []);

  const fetchFromDatabase = useCallback(async () => {
    setConnectorStatuses((prev) => ({ ...prev, database: { ...prev.database, loading: true } }));
    setStatus("Connecting to database...");
    try {
      const response = await fetch("/api/connector/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fetch",
          options: {
            limit: 50,
            location: dbOption.includes("India") ? "India" : undefined,
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        setStatus(`Database error: ${data.error}`);
        setConnectorStatuses((prev) => ({ ...prev, database: { ...prev.database, loading: false, error: data.error } }));
        return;
      }
      setPreviewKind("database");
      setPreviewCandidates(data.candidates);
      setSelectedPreviewIds(data.candidates.map((c: CandidateProfile) => c.id));
      setStatus(`Previewing ${data.candidates.length} candidates from database.`);
      setConnectorStatuses((prev) => ({ ...prev, database: { ...prev.database, loading: false, count: data.count } }));
      onAgentActivity("source_discovery", "completed", `Fetched ${data.candidates.length} candidates from database connector.`);
    } catch (error) {
      setStatus(`Database fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      setConnectorStatuses((prev) => ({ ...prev, database: { ...prev.database, loading: false, error: String(error) } }));
    }
  }, [dbOption, onAgentActivity]);

  const testMetabaseConnector = useCallback(async () => {
    setConnectorStatuses((prev) => ({ ...prev, metabase: { ...prev.metabase, loading: true, error: undefined } }));
    try {
      const response = await fetch("/api/connector/metabase", { method: "GET" });
      const data = await response.json();
      setConnectorStatuses((prev) => ({
        ...prev,
        metabase: {
          configured: data.configured,
          loading: false,
          count: data.questionCount,
          error: data.error,
          lastTest: new Date().toISOString(),
        },
      }));
    } catch (error) {
      setConnectorStatuses((prev) => ({
        ...prev,
        metabase: {
          configured: false,
          loading: false,
          error: error instanceof Error ? error.message : "Connection failed",
          lastTest: new Date().toISOString(),
        },
      }));
    }
  }, []);

  const fetchFromMetabase = useCallback(async () => {
    setConnectorStatuses((prev) => ({ ...prev, metabase: { ...prev.metabase, loading: true } }));
    setStatus("Connecting to Metabase...");
    try {
      const questionMap: Record<string, number> = {
        "Backend Engineers India": 1,
        "GenAI Talent Pool": 2,
        "Remote Candidates": 3,
        "High Availability Candidates": 4,
      };
      const questionId = questionMap[metabaseQuestion] || 1;

      const response = await fetch("/api/connector/metabase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          options: {
            questionId,
            parameters: {},
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        setStatus(`Metabase error: ${data.error}`);
        setConnectorStatuses((prev) => ({ ...prev, metabase: { ...prev.metabase, loading: false, error: data.error } }));
        return;
      }
      setPreviewKind("metabase");
      setPreviewCandidates(data.candidates);
      setSelectedPreviewIds(data.candidates.map((c: CandidateProfile) => c.id));
      setStatus(`Previewing ${data.candidates.length} candidates from Metabase.`);
      setConnectorStatuses((prev) => ({ ...prev, metabase: { ...prev.metabase, loading: false, count: data.rowCount } }));
      onAgentActivity("source_discovery", "completed", `Fetched ${data.candidates.length} candidates from Metabase connector.`);
    } catch (error) {
      setStatus(`Metabase fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      setConnectorStatuses((prev) => ({ ...prev, metabase: { ...prev.metabase, loading: false, error: String(error) } }));
    }
  }, [metabaseQuestion, onAgentActivity]);

  const uploadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseCandidateCsv(await file.text(), "csv");
      setPreviewKind("csv");
      setPreviewCandidates(imported);
      setSelectedPreviewIds(imported.map((candidate) => candidate.id));
      setStatus(`Previewing ${imported.length} CSV rows from ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "CSV import failed.");
    }
  };

  const uploadJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseCandidateJson(await file.text(), "json");
      setPreviewKind("json");
      setPreviewCandidates(imported);
      setSelectedPreviewIds(imported.map((candidate) => candidate.id));
      setStatus(`Previewing ${imported.length} JSON candidates from ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JSON import failed. Use a JSON array of candidate objects.");
    }
  };

  const uploadResumes = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setConnectorStatuses((prev) => ({ ...prev, resume: { ...prev.resume, loading: true } }));
    setStatus("Parsing resumes...");

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/connector/resume", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (data.error) {
        setStatus(`Resume parsing error: ${data.error}`);
        setConnectorStatuses((prev) => ({ ...prev, resume: { ...prev.resume, loading: false } }));
        return;
      }

      const parsed = data.results
        .filter((r: { success: boolean; candidate?: CandidateProfile }) => r.success && r.candidate)
        .map((r: { candidate: CandidateProfile; filename: string }) => ({
          ...r.candidate,
          name: r.candidate.name || r.filename.replace(/\.(pdf|docx)$/i, ""),
          resumeFileName: r.filename,
          resumeReference: `uploaded://${r.filename}`,
        }));

      if (parsed.length > 0) {
        setPreviewKind("resume");
        setPreviewCandidates(parsed);
        setSelectedPreviewIds(parsed.map((c: CandidateProfile) => c.id));
        setStatus(`Previewing ${parsed.length} parsed resumes. ${data.failed || 0} files failed.`);
      } else {
        setStatus(`No resumes parsed successfully. ${data.unsupportedCount || 0} unsupported files.`);
      }

      setConnectorStatuses((prev) => ({
        ...prev,
        resume: {
          configured: parsed.length > 0,
          loading: false,
          count: parsed.length,
          lastTest: new Date().toISOString(),
        },
      }));
      onAgentActivity("source_discovery", "completed", `Parsed ${parsed.length} resumes from uploads.`);
    } catch (error) {
      setStatus(`Resume upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      setConnectorStatuses((prev) => ({ ...prev, resume: { ...prev.resume, loading: false } }));
    }
  };

  const importPreview = () => {
    const selected = previewCandidates.filter((candidate) => selectedPreviewIds.includes(candidate.id));
    if (!selected.length) {
      setStatus("Select at least one preview row before importing.");
      return;
    }
    const label = previewKind === "csv" ? "CSV Upload" : previewKind === "json" ? "JSON Upload" : previewKind === "resume" ? "Resume Upload" : previewKind === "database" ? "Database Connector" : previewKind === "metabase" ? "Metabase Connector" : "Source";
    onLoadCandidates(selected, false, label);
    markImported(label);
    setStatus(`Imported ${selected.length} candidates from ${label}.`);
    setPreviewKind(null);
    setPreviewCandidates([]);
  };

  return (
    <div className="space-y-6">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Source Discovery</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Candidate connector hub</h2>
            <p className="mt-2 text-sm text-slate-400">Index approved internal pools, uploaded files, and analytics connectors.</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-slate-300">{candidates.length} indexed profiles</div>
        </div>
        <p className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/8 p-3 text-sm text-emerald-100">{status}</p>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ConnectorCard icon={<Database className="h-5 w-5" />} title="Internal Candidate Database" badge="Approved pool" count={sourceCounts.get("demo") ?? 0} lastImported={lastImported.internal}>
          <p className="text-sm text-slate-400">Curated backend and GenAI platform talent profiles for role pipeline matching.</p>
          <button onClick={loadInternalPool} className="mt-5 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow">
            Index internal pool
          </button>
        </ConnectorCard>

        <ConnectorCard icon={<FileSpreadsheet className="h-5 w-5" />} title="CSV Upload" badge="Preview import" count={sourceCounts.get("csv") ?? 0} lastImported={lastImported["CSV Upload"]}>
          <p className="text-sm text-slate-400">Expected fields: name, email, phone, location, title, company, years_experience, skills, projects, summary.</p>
          <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
            <UploadCloud className="h-4 w-4" />
            Preview CSV
            <input type="file" accept=".csv" className="hidden" onChange={uploadCsv} />
          </label>
        </ConnectorCard>

        <ConnectorCard icon={<FileJson className="h-5 w-5" />} title="JSON Upload" badge="Validated array" count={sourceCounts.get("json") ?? 0} lastImported={lastImported["JSON Upload"]}>
          <p className="text-sm text-slate-400">Validate and preview a JSON array before indexing candidates.</p>
          <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
            <UploadCloud className="h-4 w-4" />
            Preview JSON
            <input type="file" accept=".json" className="hidden" onChange={uploadJson} />
          </label>
        </ConnectorCard>

        <ConnectorCard icon={<FileText className="h-5 w-5" />} title="Resume Upload (PDF/DOCX)" badge="AI parser" count={sourceCounts.get("resume_upload") ?? 0} lastImported={lastImported["Resume Upload"]}>
          <p className="text-sm text-slate-400">Upload PDF, DOCX, TXT, or MD resumes. AI extracts name, email, skills, experience, and summary.</p>
          <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12">
            <UploadCloud className="h-4 w-4" />
            {connectorStatuses.resume.loading ? "Parsing..." : "Upload Resumes"}
            <input type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden" onChange={uploadResumes} />
          </label>
          {connectorStatuses.resume.loading && <Loader2 className="mt-2 h-4 w-4 animate-spin text-cyan-300" />}
        </ConnectorCard>

        <RealConnectorCard
          icon={<HardDrive className="h-5 w-5" />}
          title="Database Connector"
          badge={connectorStatuses.database.configured ? "Connected" : "Configure"}
          count={sourceCounts.get("database_mock") ?? 0}
          lastImported={lastImported["Database Connector"]}
          configured={connectorStatuses.database.configured}
          loading={connectorStatuses.database.loading}
          error={connectorStatuses.database.error}
          onTest={testDatabaseConnector}
          onFetch={fetchFromDatabase}
        >
          <label className="grid gap-2 text-xs text-slate-400">
            Candidate database
            <select value={dbOption} onChange={(event) => setDbOption(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none">
              <option>Engineering Candidates DB</option>
              <option>Previous Applicants DB</option>
              <option>Referral Pipeline DB</option>
            </select>
          </label>
        </RealConnectorCard>

        <RealConnectorCard
          icon={<Database className="h-5 w-5" />}
          title="Metabase Connector"
          badge={connectorStatuses.metabase.configured ? "Connected" : "Configure"}
          count={sourceCounts.get("metabase_mock") ?? 0}
          lastImported={lastImported["Metabase Connector"]}
          configured={connectorStatuses.metabase.configured}
          loading={connectorStatuses.metabase.loading}
          error={connectorStatuses.metabase.error}
          onTest={testMetabaseConnector}
          onFetch={fetchFromMetabase}
        >
          <label className="grid gap-2 text-xs text-slate-400">
            Saved question
            <select value={metabaseQuestion} onChange={(event) => setMetabaseQuestion(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none">
              <option>Backend Engineers India</option>
              <option>GenAI Talent Pool</option>
              <option>Remote Candidates</option>
              <option>High Availability Candidates</option>
            </select>
          </label>
        </RealConnectorCard>
      </div>

      {previewCandidates.length ? (
        <GlassCard className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Import Preview</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{previewCandidates.length} candidates ready to index</h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPreviewIds(previewCandidates.map((candidate) => candidate.id))}
                className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm font-semibold text-white hover:bg-white/12"
              >
                Select all
              </button>
              <button onClick={importPreview} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow">
                <Check className="h-4 w-4" />
                Import selected
              </button>
            </div>
          </div>
          <div className="scrollbar-slim overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/7 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="p-3">Select</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Title</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">LinkedIn</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Skills</th>
                  <th className="p-3">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {previewCandidates.slice(0, 25).map((candidate) => (
                  <tr key={candidate.id} className="border-t border-white/10">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedPreviewIds.includes(candidate.id)}
                        onChange={() => setSelectedPreviewIds((current) => current.includes(candidate.id) ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                      />
                    </td>
                    <td className="p-3 font-semibold text-white">{candidate.name}</td>
                    <td className="p-3 text-slate-300">{candidate.currentTitle}</td>
                    <td className="p-3 text-slate-400">{candidate.email ?? "—"}</td>
                    <td className="p-3 text-slate-400">{candidate.phone ?? "—"}</td>
                    <td className="p-3 text-slate-400">
                      {candidate.linkedin ? (
                        <a href={candidate.linkedin.startsWith("http") ? candidate.linkedin : `https://${candidate.linkedin}`} target="_blank" rel="noreferrer" className="text-cyan-200 hover:underline">
                          {candidate.linkedin.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="p-3 text-slate-400">{candidate.location}</td>
                    <td className="p-3 text-slate-400">{candidate.skills.slice(0, 5).join(", ")}</td>
                    <td className="p-3 text-cyan-100">{candidate.parsingConfidence ?? 82}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <Eye className="h-3.5 w-3.5" />
            Preview shows first 25 rows for review.
          </p>
        </GlassCard>
      ) : null}

      <GlassCard className="p-5">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/8 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <p className="font-semibold text-amber-100">Connector Setup Required</p>
            <p className="mt-1 text-sm text-amber-50/80">
              To enable database and Metabase connectors, add the following to your <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">.env.local</code> file:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-black/20 p-3 text-xs text-amber-50/70">
{`# Database Connector
DB_TYPE=postgresql
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=candidates_db
DB_USER=your_user
DB_PASSWORD=your_password

# Metabase Connector
METABASE_URL=https://your-metabase.com
METABASE_API_KEY=your_api_key`}
            </pre>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function ConnectorCard({
  icon,
  title,
  badge,
  count,
  lastImported,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  count: number;
  lastImported?: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="p-5 transition hover:border-cyan-300/30 hover:shadow-glow">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 p-3 text-cyan-100">{icon}</div>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs text-slate-500">{count} indexed · {lastImported ? `Last import ${lastImported}` : "No recent import"}</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/7 px-3 py-1 text-[11px] font-semibold text-slate-300">{badge}</span>
      </div>
      {children}
    </GlassCard>
  );
}

function RealConnectorCard({
  icon,
  title,
  badge,
  count,
  lastImported,
  configured,
  loading,
  error,
  onTest,
  onFetch,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  count: number;
  lastImported?: string;
  configured: boolean;
  loading: boolean;
  error?: string;
  onTest: () => void;
  onFetch: () => void;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className={`p-5 transition ${configured ? "hover:border-emerald-300/30 hover:shadow-glow" : "border-amber-300/20"}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`rounded-2xl bg-white/10 p-3 ${configured ? "text-emerald-100" : "text-amber-100"}`}>{icon}</div>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs text-slate-500">{count} indexed · {lastImported ? `Last import ${lastImported}` : "No recent import"}</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${configured ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-amber-300/25 bg-amber-300/10 text-amber-100"}`}>
          {loading ? "Connecting..." : badge}
        </span>
      </div>

      {error ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-xs text-rose-100">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {children}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onTest}
          disabled={loading}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-3 py-2 text-xs font-semibold text-white hover:bg-white/12 disabled:opacity-50"
        >
          <Settings className="h-3.5 w-3.5" />
          Test
        </button>
        <button
          onClick={onFetch}
          disabled={loading || !configured}
          className="flex items-center gap-2 rounded-full bg-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Import
        </button>
      </div>
    </GlassCard>
  );
}
