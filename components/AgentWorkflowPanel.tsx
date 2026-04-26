"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Cpu, ListFilter, X } from "lucide-react";
import { AgentCard, EmptyState, GlassPanel, SectionHeader, StatusPill } from "@/components/ui";
import { initialAgentStates } from "@/lib/agents";
import type { AgentActivity, AgentId, AgentModuleState, AgentStatus, RolePipeline } from "@/lib/types";

interface AgentWorkflowPanelProps {
  activities: AgentActivity[];
  agentStates?: AgentModuleState[];
  roles?: RolePipeline[];
  compact?: boolean;
}

export function AgentWorkflowPanel({ activities, agentStates = [], roles = [], compact = false }: AgentWorkflowPanelProps) {
  const [agentFilter, setAgentFilter] = useState<AgentId | "all">("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [selectedActivity, setSelectedActivity] = useState<AgentActivity | null>(null);

  const states = agentStates.length ? agentStates : initialAgentStates();
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const filteredActivities = activities
    .filter((activity) => agentFilter === "all" || activity.agentId === agentFilter)
    .filter((activity) => roleFilter === "all" || activity.relatedRoleId === roleFilter)
    .filter((activity) => statusFilter === "all" || activity.status === statusFilter)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const completed = states.filter((agent) => agent.status === "completed").length;
  const running = states.filter((agent) => agent.status === "running").length;

  const board = (
    <GlassPanel>
      <SectionHeader
        eyebrow="Agent Command Center"
        title="Agent Status Board"
        description={`${completed} of ${states.length} agents completed${running ? `, ${running} running` : ""}.`}
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {states.map((agent) => (
          <AgentCard
            key={agent.id}
            name={agent.name}
            status={agent.status}
            output={agent.outputSummary}
            progress={progressFor(agent.status)}
            onClick={() => {
              const latest = filteredActivities.find((activity) => activity.agentId === agent.id);
              if (latest) setSelectedActivity(latest);
            }}
          />
        ))}
      </div>
    </GlassPanel>
  );

  const timeline = (
    <GlassPanel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader eyebrow="Timeline" title="Recent Agent Activity" description={`${filteredActivities.length} logged events`} />
        {!compact ? (
          <div className="flex flex-wrap items-center gap-2">
            <ListFilter className="h-4 w-4 text-slate-500" />
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value as AgentId | "all")} className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none">
              <option value="all">All agents</option>
              {states.map((agent) => <option key={agent.id} value={agent.id}>{shortAgentName(agent.name)}</option>)}
            </select>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none">
              <option value="all">All roles</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.roleTitle}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AgentStatus | "all")} className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs text-white outline-none">
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="idle">Idle</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="mt-5 space-y-3">
        {(compact ? filteredActivities.slice(0, 6) : filteredActivities).map((activity) => (
          <ActivityRow
            key={activity.id}
            activity={activity}
            roleName={activity.relatedRoleId ? roleById.get(activity.relatedRoleId)?.roleTitle : undefined}
            onClick={() => setSelectedActivity(activity)}
          />
        ))}
        {!filteredActivities.length ? <EmptyState title="No agent activity yet" description="Run ScoutFlow Agents to populate the execution timeline." /> : null}
      </div>
    </GlassPanel>
  );

  return (
    <div className={compact ? "grid gap-5 2xl:grid-cols-[1fr_430px]" : "space-y-5"}>
      {!compact ? (
        <GlassPanel>
          <div className="flex items-start justify-between gap-4">
            <SectionHeader
              eyebrow="Agent Workflow"
              title="ScoutFlow Agent Execution"
              description="Each role run is logged across JD parsing, sourcing, matching, recommendations, outreach, phone, interest detection, and ranking."
            />
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-white">
              <Cpu className="h-6 w-6" />
            </div>
          </div>
        </GlassPanel>
      ) : null}
      {board}
      {timeline}
      {selectedActivity ? (
        <AgentDetailsDrawer activity={selectedActivity} roleName={selectedActivity.relatedRoleId ? roleById.get(selectedActivity.relatedRoleId)?.roleTitle : undefined} onClose={() => setSelectedActivity(null)} />
      ) : null}
    </div>
  );
}

function ActivityRow({ activity, roleName, onClick }: { activity: AgentActivity; roleName?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass-card w-full rounded-2xl p-4 text-left hover:border-white/20 hover:bg-white/[0.07]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={activity.status} />
            <p className="text-sm font-semibold text-white">{shortAgentName(activity.name)}</p>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 muted-text">{activity.outputSummary ?? activity.summary}</p>
          {roleName ? <p className="mt-2 text-[11px] text-violet-100">{roleName}</p> : null}
          <p className="mt-1 text-[11px] text-cyan-100">Provider: {providerDisplay(activity.providerUsed)}{activity.modelUsed ? ` · ${activity.modelUsed}` : ""}</p>
        </div>
        <div className="text-right">
          <StatusPill status={activity.status} />
          <p className="mt-2 text-[11px] muted-text">{formatTime(activity.timestamp)}</p>
        </div>
      </div>
    </button>
  );
}

function AgentDetailsDrawer({ activity, roleName, onClose }: { activity: AgentActivity; roleName?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="glass-panel scrollbar-slim ml-auto h-full w-full max-w-xl overflow-auto border-l border-white/10 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <SectionHeader eyebrow="Agent Run Details" title={activity.name} description={activity.description} />
          <button onClick={onClose} className="rounded-full border border-white/10 p-2 text-white hover:bg-white/[0.08]" aria-label="Close agent details">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <Detail title="Status" text={activity.status} badge />
          <Detail title="Input Summary" text={activity.inputSummary ?? "No input summary recorded."} />
          <Detail title="Output Summary" text={activity.outputSummary ?? activity.summary} />
          <Detail title="Reasoning Summary" text={activity.reasoningSummary ?? "Deterministic workflow completed without additional reasoning notes."} />
          <Detail title="Confidence" text={typeof activity.confidence === "number" ? `${Math.round(activity.confidence * 100)}%` : "Not scored"} />
          <Detail title="Provider Used" text={`${providerDisplay(activity.providerUsed)}${activity.modelUsed ? ` · ${activity.modelUsed}` : ""}`} />
          <Detail title="Related Role" text={roleName ?? activity.relatedRoleId ?? "No role linked"} />
          <Detail title="Timestamp" text={formatTime(activity.timestamp)} />
        </div>

        {activity.logs?.length ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <h4 className="text-sm font-semibold text-white">Agent Log</h4>
            <div className="mt-3 space-y-2">
              {activity.logs.map((log) => <p key={log} className="text-sm leading-6 muted-text">{log}</p>)}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Detail({ title, text, badge = false }: { title: string; text: string; badge?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/70">{title}</div>
      {badge ? <div className="mt-2"><StatusPill status={text} /></div> : <p className="mt-2 text-sm leading-6 text-slate-200">{text}</p>}
    </div>
  );
}

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-300" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 text-rose-300" />;
  if (status === "running") return <Cpu className="h-4 w-4 animate-pulse text-violet-200" />;
  return <Clock className="h-4 w-4 text-slate-500" />;
}

function progressFor(status: AgentStatus) {
  if (status === "completed") return 100;
  if (status === "running") return 52;
  if (status === "warning") return 72;
  if (status === "error") return 100;
  return 0;
}

function shortAgentName(name: string): string {
  return name.replace(" Agent", "");
}

function providerDisplay(provider?: string): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  return "Local Fallback";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
