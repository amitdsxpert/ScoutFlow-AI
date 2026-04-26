"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Mail, MessageCircle, Phone, Play, Send, Smartphone, Users } from "lucide-react";
import { AgentWorkflowPanel } from "@/components/AgentWorkflowPanel";
import { DataTable, EmptyState, GlassPanel, MetricCard, PrimaryButton, SectionHeader, StatusPill } from "@/components/ui";
import type {
  AgentActivity,
  AgentModuleState,
  CandidateProfile,
  CandidateSource,
  Channel,
  InterestResult,
  MatchResult,
  OutreachCampaign,
  RankedCandidate,
  RolePipeline,
  ScoutFlowRunOptions,
} from "@/lib/types";

type Section = "dashboard" | "role" | "sources" | "candidates" | "outreach" | "shortlist" | "agents" | "export" | "settings";

interface DashboardProps {
  roles: RolePipeline[];
  activeRole: RolePipeline;
  candidates: CandidateProfile[];
  matches: MatchResult[];
  interests: InterestResult[];
  ranked: RankedCandidate[];
  campaigns: OutreachCampaign[];
  agentActivity: AgentActivity[];
  agentStates: AgentModuleState[];
  onNavigate: (section: Section) => void;
  onLoadDemo: () => void;
  onAutoSimulate: () => void;
  onRunAgents: (options: ScoutFlowRunOptions) => Promise<void>;
}

const sourceOptions: Array<{ id: CandidateSource; label: string }> = [
  { id: "demo", label: "Internal database" },
  { id: "csv", label: "Uploaded CSV" },
  { id: "json", label: "Uploaded JSON" },
  { id: "resume_upload", label: "Resume uploads" },
  { id: "database_mock", label: "Database connector" },
  { id: "metabase_mock", label: "Analytics connector" },
];

const channelOptions: Array<{ id: Channel; label: string; icon: React.ReactNode }> = [
  { id: "email", label: "Email", icon: <Mail className="h-4 w-4" /> },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
  { id: "linkedin", label: "LinkedIn", icon: <Send className="h-4 w-4" /> },
  { id: "sms", label: "SMS", icon: <Smartphone className="h-4 w-4" /> },
  { id: "phone", label: "Phone", icon: <Phone className="h-4 w-4" /> },
];

export function Dashboard({
  roles,
  activeRole,
  candidates,
  matches,
  interests,
  ranked,
  campaigns,
  agentActivity,
  agentStates,
  onNavigate,
  onLoadDemo: _onLoadDemo,
  onAutoSimulate: _onAutoSimulate,
  onRunAgents,
}: DashboardProps) {
  const [runRoleId, setRunRoleId] = useState(activeRole.id);
  const [sourceIds, setSourceIds] = useState<CandidateSource[]>(["demo"]);
  const [channels, setChannels] = useState<Channel[]>(["email", "linkedin", "phone"]);
  const [candidateLimit, setCandidateLimit] = useState(10);
  const [running, setRunning] = useState(false);

  const shortlisted = roles.reduce((total, role) => total + role.shortlist.length, 0);
  const matchedCount = matches.filter((match) => match.matchScore >= 60).length;
  const interestedCount = interests.filter((interest) => interest.interestScore >= 75).length;
  const topRecommended = ranked.slice(0, 5);
  const selectedRunRole = roles.find((role) => role.id === runRoleId) ?? activeRole;
  const completedAgents = agentStates.filter((agent) => agent.status === "completed").length;
  const activeAgents = agentStates.filter((agent) => agent.status === "running").length;

  const outreachSummary = useMemo(() => {
    const conversations = campaigns.flatMap((campaign) => campaign.conversations ?? []);
    return {
      campaigns: campaigns.length,
      messages: campaigns.reduce((total, campaign) => total + campaign.messages.length, 0),
      replies: conversations.filter((conversation) => conversation.reply || conversation.transcript).length,
      followUps: conversations.filter((conversation) => conversation.status === "follow_up_needed").length,
    };
  }, [campaigns]);

  const finalSummary = topRecommended[0]
    ? `${topRecommended[0].candidate.name} leads the shortlist at ${topRecommended[0].finalScore}. ${topRecommended.length} recommendations are ready for review.`
    : "Run the agents to generate a ranked shortlist, outreach drafts, and interest signals.";

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunAgents({
        roleId: runRoleId,
        sourceIds,
        candidateLimit,
        optimizationFocus: "balanced",
        channels,
        outreachMode: "simulate_send_and_replies",
        provider: "auto",
      });
    } finally {
      setRunning(false);
    }
  };

  const toggleSource = (source: CandidateSource) => {
    setSourceIds((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
  };

  const toggleChannel = (channel: Channel) => {
    setChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel]);
  };

  return (
    <div className="space-y-5">
      <GlassPanel className="p-5 sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400/70">ScoutFlow AI</p>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-white">Agent Command Center</h2>
            <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-6 muted-text">
              <span className="font-semibold text-white">{selectedRunRole.roleTitle}</span> is ready for a role-scoped agent run.
            </p>
          </div>
          <PrimaryButton onClick={handleRun} disabled={running || !sourceIds.length || !channels.length} className="w-full xl:w-auto">
            <Play className="h-4 w-4" />
            {running ? "Running Agents" : "Run ScoutFlow Agents"}
          </PrimaryButton>
        </div>
      </GlassPanel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Active Roles" value={roles.filter((role) => role.status === "active").length} />
        <MetricCard label="Candidates" value={candidates.length} />
        <MetricCard label="Matches" value={matchedCount} tone="accent" />
        <MetricCard label="Interested" value={interestedCount} tone="emerald" />
        <MetricCard label="Shortlisted" value={shortlisted} />
        <MetricCard label="Agents Done" value={`${completedAgents}/${agentStates.length || 8}`} detail={activeAgents ? `${activeAgents} running` : undefined} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <GlassPanel>
          <SectionHeader eyebrow="Run Setup" title="Agent Run Configuration" description="Choose the role scope, candidate sources, and outreach channels for this execution." />

          <div className="mt-5 grid max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_170px]">
            <label className="grid gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/70">
              Role
              <select value={runRoleId} onChange={(event) => setRunRoleId(event.target.value)} className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm normal-case text-white outline-none focus:border-white/20">
                {roles.map((role) => <option key={role.id} value={role.id}>{role.roleTitle}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/70">
              Limit
              <select value={candidateLimit} onChange={(event) => setCandidateLimit(Number(event.target.value))} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm normal-case text-white outline-none focus:border-white/20">
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
                <option value={20}>Top 20</option>
                <option value={50}>Top 50</option>
              </select>
            </label>
          </div>

          <ControlBlock title="Candidate Sources">
            {sourceOptions.map((source) => (
              <Toggle key={source.id} active={sourceIds.includes(source.id)} label={source.label} onClick={() => toggleSource(source.id)} />
            ))}
          </ControlBlock>

          <ControlBlock title="Outreach Channels">
            {channelOptions.map((channel) => (
              <IconToggle key={channel.id} active={channels.includes(channel.id)} label={channel.label} icon={channel.icon} onClick={() => toggleChannel(channel.id)} />
            ))}
          </ControlBlock>
        </GlassPanel>

        <GlassPanel>
          <SectionHeader eyebrow="Final Output" title="Run Summary" />
          <p className="mt-4 text-sm leading-6 muted-text">{finalSummary}</p>
          <div className="mt-5 space-y-3">
            <Progress label="Candidates indexed" value={candidates.length} total={Math.max(25, candidates.length)} />
            <Progress label="Matched candidates" value={matchedCount} total={Math.max(1, candidates.length)} />
            <Progress label="Interested candidates" value={interestedCount} total={Math.max(1, candidates.length)} />
            <Progress label="Shortlisted candidates" value={activeRole.shortlist.length} total={Math.max(1, candidates.length)} />
          </div>
        </GlassPanel>
      </section>

      <AgentWorkflowPanel activities={agentActivity} agentStates={agentStates} roles={roles} compact />

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <GlassPanel>
          <SectionHeader
            eyebrow="Recommendations"
            title="Top Candidates"
            action={<button onClick={() => onNavigate("candidates")} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.08]">Open</button>}
          />
          <div className="mt-4 space-y-3">
            {topRecommended.length ? (
              topRecommended.map((row) => <CompactCandidate key={row.candidate.id} row={row} />)
            ) : (
              <EmptyState title="No recommendations yet" description="Run the agents to populate a ranked shortlist for the active role." />
            )}
          </div>
          {topRecommended.length ? (
            <button onClick={() => onNavigate("shortlist")} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08]">
              Review shortlist <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
        </GlassPanel>

        <GlassPanel>
          <SectionHeader
            eyebrow="Pipelines"
            title="Active Role Board"
            action={<button onClick={() => onNavigate("role")} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.08]">Open</button>}
          />
          <div className="mt-4">
            <DataTable className="min-w-[680px]">
              <thead className="text-[10px] uppercase tracking-[0.18em] text-slate-400/70">
                <tr>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Candidates</th>
                  <th className="p-3">Top Candidate</th>
                  <th className="p-3">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => {
                  const roleTop = topCandidateForRole(role, candidates, ranked);
                  const roleActivity = agentActivity.find((activity) => activity.relatedRoleId === role.id && activity.status === "completed");
                  return (
                    <tr key={role.id} className="border-t border-white/10 hover:bg-white/[0.035]">
                      <td className="p-3">
                        <p className="max-w-[260px] truncate font-semibold text-white">{role.roleTitle}</p>
                        <p className="mt-1 text-xs muted-text">{role.parsedJD.location} · {role.parsedJD.workMode}</p>
                      </td>
                      <td className="p-3"><StatusPill status={role.status} /></td>
                      <td className="p-3 metric-number text-white">{role.candidateMatches.length || (role.id === activeRole.id ? matches.length : 0)}</td>
                      <td className="p-3 text-slate-300">{roleTop?.name ?? "Awaiting run"}</td>
                      <td className="p-3 muted-text">{roleActivity ? formatTime(roleActivity.timestamp) : "Not run yet"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        </GlassPanel>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Campaigns" value={outreachSummary.campaigns} />
        <MetricCard label="Messages" value={outreachSummary.messages} />
        <MetricCard label="Replies" value={outreachSummary.replies} tone="emerald" />
        <MetricCard label="Follow Ups" value={outreachSummary.followUps} tone="amber" />
      </section>
    </div>
  );
}

function Progress({ label, value, total }: { label: string; value: number; total: number }) {
  const width = Math.min(100, Math.round((value / total) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="metric-number text-white">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-white/70" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ControlBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/70">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Toggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-2 text-xs font-semibold ${active ? "border border-white/20 bg-white/[0.18] text-white" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}>
      {label}
    </button>
  );
}

function IconToggle({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${active ? "border border-white/20 bg-white/[0.18] text-white" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}>
      {icon}
      {label}
    </button>
  );
}

function CompactCandidate({ row }: { row: RankedCandidate }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{row.candidate.name}</p>
          <p className="mt-1 truncate text-xs muted-text">{row.candidate.currentTitle} · {row.candidate.location}</p>
        </div>
        <span className="metric-number text-lg font-semibold text-white">{row.finalScore}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 muted-text">{row.recommendation}</p>
    </div>
  );
}

function topCandidateForRole(role: RolePipeline, candidates: CandidateProfile[], ranked: RankedCandidate[]) {
  const rankedForRole = ranked.find((row) => row.roleId === role.id || role.shortlist.includes(row.candidate.id));
  if (rankedForRole) return rankedForRole.candidate;
  const match = role.candidateMatches.slice().sort((a, b) => b.matchScore - a.matchScore)[0];
  return candidates.find((candidate) => candidate.id === match?.candidateId);
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Not run yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
