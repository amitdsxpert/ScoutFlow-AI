"use client";

import { Download, FileJson, Table } from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { candidatesToCsv, downloadTextFile, rankedToCsv, toExportJson } from "@/lib/export";
import type { ExportPayload, RolePipeline } from "@/lib/types";

interface ExportPanelProps {
  payload: ExportPayload;
  jsonPreview: string;
  activeRole: RolePipeline;
  onAgentActivity: (summary: string) => void;
}

export function ExportPanel({ payload, jsonPreview, activeRole, onAgentActivity }: ExportPanelProps) {
  const roleRows = payload.rankedShortlist.filter((row) => row.roleId === activeRole.id || !row.roleId);
  const rolePayload = {
    activeRole,
    rankedShortlist: roleRows,
    matchResults: payload.matchResults,
    interestResults: payload.interestResults.filter((interest) => interest.roleId === activeRole.id || !interest.roleId),
    outreachCampaigns: payload.outreachCampaigns?.filter((campaign) => campaign.roleId === activeRole.id) ?? [],
  };

  const exportFile = (name: string, content: string, type: string, summary: string) => {
    downloadTextFile(name, content, type);
    onAgentActivity(summary);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <GlassCard className="h-fit p-5">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Export Agent</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Recruiter-ready packages</h2>
        <div className="mt-5 grid gap-3">
          <Stat label="Active role" value={activeRole.roleTitle} />
          <Stat label="Role shortlist rows" value={roleRows.length.toString()} />
          <Stat label="All candidates" value={payload.candidates.length.toString()} />
          <Stat label="Role pipelines" value={(payload.roles?.length ?? 0).toString()} />
          <Stat label="Campaigns" value={(payload.outreachCampaigns?.length ?? 0).toString()} />
          <Stat label="Conversations" value={(payload.conversations?.length ?? 0).toString()} />
          <Stat label="Agent events" value={(payload.agentActivity?.length ?? 0).toString()} />
        </div>

        <div className="mt-6 grid gap-3">
          <button
            onClick={() => exportFile("scoutflow-active-role-shortlist.csv", rankedToCsv(roleRows, activeRole.roleTitle), "text/csv", `Exported CSV shortlist for ${activeRole.roleTitle}.`)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow"
          >
            <Table className="h-4 w-4" />
            Current Role CSV
          </button>
          <button
            onClick={() => exportFile("scoutflow-active-role-shortlist.json", JSON.stringify(rolePayload, null, 2), "application/json", `Exported JSON package for ${activeRole.roleTitle}.`)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-sm font-semibold text-cyan-100"
          >
            <FileJson className="h-4 w-4" />
            Current Role JSON
          </button>
          <button
            onClick={() => exportFile("scoutflow-all-candidates.csv", candidatesToCsv(payload.candidates), "text/csv", `Exported ${payload.candidates.length} indexed candidates.`)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-5 py-3 text-sm font-semibold text-emerald-100"
          >
            <Table className="h-4 w-4" />
            All Candidates CSV
          </button>
          <button
            onClick={() => exportFile("scoutflow-campaign-report.json", JSON.stringify(payload.outreachCampaigns ?? [], null, 2), "application/json", "Exported campaign engagement report.")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-300/25 bg-violet-300/10 px-5 py-3 text-sm font-semibold text-violet-100"
          >
            <FileJson className="h-4 w-4" />
            Campaign Report JSON
          </button>
          <button
            onClick={() => exportFile("scoutflow-agent-activity.json", JSON.stringify(payload.agentActivity ?? [], null, 2), "application/json", "Exported agent activity log.")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-5 py-3 text-sm font-semibold text-amber-100"
          >
            <FileJson className="h-4 w-4" />
            Agent Activity JSON
          </button>
          <button
            onClick={() => exportFile("scoutflow-workspace-backup.json", toExportJson(payload), "application/json", "Exported full ScoutFlow AI workspace backup.")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/7 px-5 py-3 text-sm font-semibold text-white"
          >
            <Download className="h-4 w-4" />
            Full Workspace Backup
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Workspace Preview</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">JSON payload</h2>
          </div>
          <Download className="h-5 w-5 text-cyan-200" />
        </div>
        <pre className="scrollbar-slim max-h-[720px] overflow-auto rounded-2xl border border-white/10 bg-slate-950/65 p-5 text-xs leading-5 text-slate-300">
          {jsonPreview}
        </pre>
      </GlassCard>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="metric-number max-w-48 truncate text-right font-semibold text-white">{value}</span>
    </div>
  );
}
