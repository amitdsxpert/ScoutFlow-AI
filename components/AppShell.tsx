"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BarChart3,
  Bot,
  Cpu,
  Database,
  Download,
  FileText,
  LogOut,
  Menu,
  Search,
  Send,
  Settings,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { AgentWorkflowPanel } from "@/components/AgentWorkflowPanel";
import { CandidateDiscovery } from "@/components/CandidateDiscovery";
import { Dashboard } from "@/components/Dashboard";
import { ExportPanel } from "@/components/ExportPanel";
import { OutreachStudio } from "@/components/OutreachStudio";
import { RoleBuilder } from "@/components/RoleBuilder";
import { Shortlist } from "@/components/Shortlist";
import { SourceHub } from "@/components/SourceHub";
import { GlassPanel, MetricCard } from "@/components/ui";
import { createAgentActivity, initialAgentActivity, initialAgentStates } from "@/lib/agents";
import { demoCandidates, sampleParsedJD } from "@/lib/demoData";
import { toExportJson } from "@/lib/export";
import { ensureCandidateIdentifier, ensureRoleIdentifiers } from "@/lib/identity";
import { rankCandidates } from "@/lib/ranking";
import { defaultRolePipeline, makeId, roleFromParsedJD } from "@/lib/roles";
import { scoreCandidates } from "@/lib/scoring";
import type {
  AgentActivity,
  AgentId,
  AgentModuleState,
  AgentStatus,
  CandidateList,
  CandidateProfile,
  ExportPayload,
  InterestResult,
  MatchResult,
  OutreachCampaign,
  OutreachResult,
  ParsedJD,
  RolePipeline,
  RoleStatus,
  ScoutFlowRunResult,
  ScoutFlowRunOptions,
  ShortlistSettings,
} from "@/lib/types";

type Section =
  | "dashboard"
  | "role"
  | "sources"
  | "candidates"
  | "outreach"
  | "shortlist"
  | "agents"
  | "export"
  | "settings";

interface LlmStatus {
  provider: LlmProviderSetting;
  providerLabel: string;
  configured: boolean;
  mode: "ai" | "fallback";
  model?: string;
  error?: string;
}

type LlmProviderSetting = "auto" | "none" | "openrouter" | "gemini" | "groq" | "huggingface";

interface PersistedPhaseTwoState {
  roles: RolePipeline[];
  activeRoleId: string;
  candidates: CandidateProfile[];
  outreachResults: OutreachResult[];
  outreachCampaigns: OutreachCampaign[];
  interestResults: InterestResult[];
  candidateLists: CandidateList[];
  selectedCandidateIds: string[];
  selectedCandidateId: string;
  agentActivity: AgentActivity[];
  agentStates?: AgentModuleState[];
  shortlistSettings?: ShortlistSettings[];
}

interface PersistedSettings {
  llmProvider?: LlmProviderSetting;
  llmModel?: string;
}

interface JDIntelligenceResponse {
  output: {
    role: RolePipeline;
  };
  activity: AgentActivity;
}

interface OutreachAgentResponse {
  campaign: OutreachCampaign;
  outreachResults: OutreachResult[];
  interestResults: InterestResult[];
  agentActivity: AgentActivity[];
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "role", label: "Roles", icon: FileText },
  { id: "candidates", label: "Candidates", icon: Users },
  { id: "outreach", label: "Outreach", icon: Send },
  { id: "shortlist", label: "Shortlist", icon: Trophy },
  { id: "agents", label: "Agent Activity", icon: Cpu },
  { id: "sources", label: "Sources", icon: Database },
  { id: "export", label: "Export", icon: Download },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

const storageKey = "scoutflow-ai-state-v3";
const phaseTwoStorageKey = "scoutflow-ai-state-v2";
const legacyStorageKey = "scoutflow-ai-state-v1";
const settingsStorageKey = "scoutflow-ai-settings-v1";
const authStorageKey = "scoutflow-ai-auth-v1";

const MAX_AGENT_ACTIVITY = 50;
const MAX_AGENT_LOG_LINES = 8;
const MAX_AGENT_REASONING_CHARS = 800;
const MAX_OUTREACH_RESULTS = 200;
const MAX_OUTREACH_CAMPAIGNS = 25;
const MAX_INTEREST_RESULTS = 200;
const MAX_CONVERSATIONS_PER_CAMPAIGN = 60;
const MAX_MESSAGES_PER_CAMPAIGN = 80;
const MAX_ROLE_AGENT_LOGS = 10;

function clampString(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[ScoutFlow] storage write failed for ${key}:`, error);
    return false;
  }
}

function compactPersistedState(state: PersistedPhaseTwoState): PersistedPhaseTwoState {
  return {
    ...state,
    roles: state.roles.map((role) => ({
      ...role,
      agentLogs: (role.agentLogs ?? []).slice(0, MAX_ROLE_AGENT_LOGS).map((log) => ({
        ...log,
        outputSummary: clampString(log.outputSummary, MAX_AGENT_REASONING_CHARS) ?? "",
        reasoningSummary: clampString(log.reasoningSummary, MAX_AGENT_REASONING_CHARS) ?? "",
        inputSummary: clampString(log.inputSummary, 240) ?? "",
      })),
      agentReasoningSummary: clampString(role.agentReasoningSummary, MAX_AGENT_REASONING_CHARS),
    })),
    agentActivity: state.agentActivity.slice(0, MAX_AGENT_ACTIVITY).map((activity) => ({
      ...activity,
      logs: activity.logs?.slice(0, MAX_AGENT_LOG_LINES),
      reasoningSummary: clampString(activity.reasoningSummary, MAX_AGENT_REASONING_CHARS),
      outputSummary: clampString(activity.outputSummary, MAX_AGENT_REASONING_CHARS),
      inputSummary: clampString(activity.inputSummary, 240),
    })),
    agentStates: (state.agentStates ?? []).map((agent) => ({
      ...agent,
      logs: agent.logs.slice(0, MAX_AGENT_LOG_LINES),
      outputSummary: clampString(agent.outputSummary, MAX_AGENT_REASONING_CHARS) ?? "",
      inputSummary: clampString(agent.inputSummary, 240) ?? "",
    })),
    outreachResults: state.outreachResults.slice(0, MAX_OUTREACH_RESULTS),
    interestResults: state.interestResults.slice(0, MAX_INTEREST_RESULTS),
    outreachCampaigns: state.outreachCampaigns.slice(0, MAX_OUTREACH_CAMPAIGNS).map((campaign) => ({
      ...campaign,
      messages: campaign.messages.slice(0, MAX_MESSAGES_PER_CAMPAIGN),
      conversations: campaign.conversations?.slice(0, MAX_CONVERSATIONS_PER_CAMPAIGN),
      agentActivity: campaign.agentActivity?.slice(0, MAX_AGENT_LOG_LINES),
    })),
  };
}

function persistWorkspaceState(key: string, state: PersistedPhaseTwoState): void {
  if (typeof window === "undefined") return;
  let payload: PersistedPhaseTwoState = state;
  try {
    let serialized = JSON.stringify(payload);
    if (!safeSetItem(key, serialized)) {
      payload = compactPersistedState(payload);
      serialized = JSON.stringify(payload);
      if (!safeSetItem(key, serialized)) {
        // Last resort: drop heavy collections entirely so settings/roles still survive.
        const minimal: PersistedPhaseTwoState = {
          ...payload,
          agentActivity: payload.agentActivity.slice(0, 5),
          agentStates: (payload.agentStates ?? []).slice(0, 8),
          outreachResults: [],
          outreachCampaigns: payload.outreachCampaigns.slice(0, 3).map((campaign) => ({
            ...campaign,
            messages: campaign.messages.slice(0, 5),
            conversations: campaign.conversations?.slice(0, 5),
          })),
          interestResults: payload.interestResults.slice(0, 25),
        };
        safeSetItem(key, JSON.stringify(minimal));
      }
    }
  } catch (error) {
    console.warn("[ScoutFlow] persistWorkspaceState failed:", error);
  }
}

export function AppShell() {
  const defaultRole = useMemo(() => defaultRolePipeline(), []);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [roles, setRoles] = useState<RolePipeline[]>([defaultRole]);
  const [activeRoleId, setActiveRoleId] = useState(defaultRole.id);
  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [outreachResults, setOutreachResults] = useState<OutreachResult[]>([]);
  const [outreachCampaigns, setOutreachCampaigns] = useState<OutreachCampaign[]>([]);
  const [interestResults, setInterestResults] = useState<InterestResult[]>([]);
  const [candidateLists, setCandidateLists] = useState<CandidateList[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>(initialAgentActivity());
  const [agentStates, setAgentStates] = useState<AgentModuleState[]>(initialAgentStates());
  const [shortlistSettings, setShortlistSettings] = useState<ShortlistSettings[]>([]);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProviderSetting>("auto");
  const [llmModel, setLlmModel] = useState("");
  const [llmStatus, setLlmStatus] = useState<LlmStatus>({ provider: "none", providerLabel: "Local Fallback", configured: false, mode: "fallback" });
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("Workspace ready");

  useEffect(() => {
    const savedAuth = localStorage.getItem(authStorageKey);
    if (savedAuth) {
      try {
        const parsed = JSON.parse(savedAuth) as { email?: string };
        if (parsed.email) {
          setAuthenticated(true);
          setUserEmail(parsed.email);
        }
      } catch {
        localStorage.removeItem(authStorageKey);
      }
    }

    const savedSettings = localStorage.getItem(settingsStorageKey);
    let initialProvider: LlmProviderSetting | undefined;
    let initialModel = "";
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as PersistedSettings;
        if (parsed.llmProvider && ["auto", "none", "openrouter", "gemini", "groq", "huggingface"].includes(parsed.llmProvider)) {
          initialProvider = parsed.llmProvider;
          setLlmProvider(parsed.llmProvider);
        }
        initialModel = parsed.llmModel ?? "";
        setLlmModel(initialModel);
      } catch {
        localStorage.removeItem(settingsStorageKey);
      }
    }

    const saved = localStorage.getItem(storageKey);
    const phaseTwo = localStorage.getItem(phaseTwoStorageKey);
    const legacy = localStorage.getItem(legacyStorageKey);

    if (saved || phaseTwo) {
      try {
        const parsed = JSON.parse(saved ?? phaseTwo ?? "") as PersistedPhaseTwoState;
        const nextRoles = (parsed.roles?.length ? parsed.roles : [defaultRole]).map(ensureRoleIdentifiers);
        setRoles(nextRoles);
        setActiveRoleId(parsed.activeRoleId || nextRoles[0].id);
        setCandidates((parsed.candidates ?? []).map(ensureCandidateIdentifier));
        setOutreachResults(parsed.outreachResults ?? []);
        setOutreachCampaigns(parsed.outreachCampaigns ?? []);
        setInterestResults(parsed.interestResults ?? []);
        setCandidateLists(parsed.candidateLists ?? []);
        setSelectedCandidateIds(parsed.selectedCandidateIds ?? []);
        setSelectedCandidateId(parsed.selectedCandidateId ?? parsed.selectedCandidateIds?.[0] ?? "");
        setAgentActivity(parsed.agentActivity?.length ? parsed.agentActivity : initialAgentActivity());
        setAgentStates(parsed.agentStates?.length ? parsed.agentStates : initialAgentStates());
        setShortlistSettings(parsed.shortlistSettings ?? []);
      } catch {
        localStorage.removeItem(storageKey);
      }
    } else if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as {
          parsedJD?: ParsedJD | null;
          candidates?: CandidateProfile[];
          outreachResults?: OutreachResult[];
          interestResults?: InterestResult[];
          selectedCandidateId?: string;
        };
        const migratedRole = roleFromParsedJD(parsed.parsedJD ?? sampleParsedJD, parsed.parsedJD?.rawText ?? sampleParsedJD.rawText, "active");
        setRoles([ensureRoleIdentifiers({ ...migratedRole, id: defaultRole.id })]);
        setActiveRoleId(defaultRole.id);
        setCandidates((parsed.candidates ?? []).map(ensureCandidateIdentifier));
        setOutreachResults((parsed.outreachResults ?? []).map((result) => ({ ...result, roleId: defaultRole.id })));
        setInterestResults((parsed.interestResults ?? []).map((result) => ({ ...result, roleId: defaultRole.id })));
        setSelectedCandidateId(parsed.selectedCandidateId ?? "");
        setSelectedCandidateIds(parsed.selectedCandidateId ? [parsed.selectedCandidateId] : []);
      } catch {
        localStorage.removeItem(legacyStorageKey);
      }
    }

    const statusUrl = initialProvider
      ? `/api/llm?provider=${initialProvider}&model=${encodeURIComponent(initialModel)}`
      : "/api/llm";
    fetch(statusUrl)
      .then((response) => response.json())
      .then((status: LlmStatus) => {
        setLlmStatus(status);
        if (!initialProvider) setLlmProvider(status.provider);
        if (!initialModel && status.model) setLlmModel(status.model);
      })
      .catch(() => setLlmStatus({ provider: "none", providerLabel: "Local Fallback", configured: false, mode: "fallback" }));

    setAuthReady(true);
    setHydrated(true);
  }, [defaultRole]);

  const activeRole = useMemo(
    () => roles.find((role) => role.id === activeRoleId) ?? roles[0] ?? defaultRole,
    [activeRoleId, defaultRole, roles],
  );
  const parsedJD = activeRole?.parsedJD ?? sampleParsedJD;

  const matchResults = useMemo(
    () => {
      const stored = activeRole?.candidateMatches?.filter((match) => candidates.some((candidate) => candidate.id === match.candidateId)) ?? [];
      return stored.length ? stored : scoreCandidates(candidates, parsedJD, activeRole?.id);
    },
    [activeRole?.candidateMatches, activeRole?.id, candidates, parsedJD],
  );

  const activeInterestResults = useMemo(
    () => interestResults.filter((interest) => interest.roleId === activeRole?.id || (!interest.roleId && activeRole?.id === defaultRole.id)),
    [activeRole?.id, defaultRole.id, interestResults],
  );

  const rankedShortlist = useMemo(
    () => rankCandidates(candidates, matchResults, activeInterestResults, activeRole?.id),
    [activeInterestResults, activeRole?.id, candidates, matchResults],
  );

  const conversations = useMemo(
    () => outreachCampaigns.flatMap((campaign) => campaign.conversations ?? []),
    [outreachCampaigns],
  );

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates.find((candidate) => selectedCandidateIds.includes(candidate.id)) ?? candidates[0],
    [candidates, selectedCandidateId, selectedCandidateIds],
  );

  const exportPayload: ExportPayload = useMemo(
    () => ({
      roles,
      activeRole,
      parsedJD,
      candidates,
      matchResults,
      interestResults,
      rankedShortlist,
      outreachCampaigns,
      candidateLists,
      agentActivity,
      agentStates,
      conversations,
      shortlistSettings,
    }),
    [activeRole, agentActivity, agentStates, candidateLists, candidates, conversations, interestResults, matchResults, outreachCampaigns, parsedJD, rankedShortlist, roles, shortlistSettings],
  );

  useEffect(() => {
    if (!hydrated) return;
    persistWorkspaceState(storageKey, {
      roles,
      activeRoleId: activeRole?.id ?? "",
      candidates,
      outreachResults,
      outreachCampaigns,
      interestResults,
      candidateLists,
      selectedCandidateIds,
      selectedCandidateId,
      agentActivity,
      agentStates,
      shortlistSettings,
    });
  }, [
    activeRole?.id,
    agentActivity,
    candidateLists,
    candidates,
    hydrated,
    interestResults,
    outreachCampaigns,
    outreachResults,
    roles,
    selectedCandidateId,
    selectedCandidateIds,
    agentStates,
    shortlistSettings,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    safeSetItem(settingsStorageKey, JSON.stringify({ llmProvider, llmModel } satisfies PersistedSettings));
  }, [hydrated, llmModel, llmProvider]);

  const recordAgent = useCallback((agentId: AgentId, status: AgentStatus, summary: string) => {
    const activity = createAgentActivity(agentId, status, summary, { relatedRoleId: activeRole?.id });
    setAgentActivity((current) => [activity, ...current].slice(0, 120));
    setAgentStates((current) => current.map((agent) => (
      agent.id === agentId
        ? {
            ...agent,
            status,
            outputSummary: summary,
            lastRunAt: activity.timestamp,
            relatedRoleId: activeRole?.id,
            logs: [summary, ...agent.logs].slice(0, 8),
          }
        : agent
    )));
  }, [activeRole?.id]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast("Workspace synced"), 2600);
  }, []);

  const saveRole = useCallback((role: RolePipeline, activate = true) => {
    const normalizedRole = ensureRoleIdentifiers(role);
    setRoles((current) => {
      const exists = current.some((item) => item.id === normalizedRole.id);
      const next = exists ? current.map((item) => (item.id === normalizedRole.id ? normalizedRole : item)) : [normalizedRole, ...current];
      return next.map((item) => ({
        ...item,
        status: activate && normalizedRole.status === "active" && item.id !== normalizedRole.id && item.status === "active" ? "draft" : item.status,
      }));
    });
    if (activate) setActiveRoleId(normalizedRole.id);
    recordAgent("jd_intelligence", "completed", `Parsed ${normalizedRole.roleTitle} with ${normalizedRole.parsedJD.requiredSkills.length} required skills.`);
    showToast(`Role pipeline saved: ${normalizedRole.roleTitle}`);
  }, [recordAgent, showToast]);

  const runJDIntelligence = useCallback(async (input: { rawInput: string; mode: "parse" | "generate"; status: RoleStatus; existingRole?: RolePipeline }) => {
    const response = await fetch("/api/agents/jd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        provider: llmProvider,
        model: llmModel.trim() || undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "JD Intelligence Agent failed");
    }
    const result = payload as JDIntelligenceResponse;
    const role = ensureRoleIdentifiers(result.output.role);

    setRoles((current) => {
      const exists = current.some((item) => item.id === role.id);
      const next = exists ? current.map((item) => (item.id === role.id ? role : item)) : [role, ...current];
      return next.map((item) => ({
        ...item,
        status: role.status === "active" && item.id !== role.id && item.status === "active" ? "draft" : item.status,
      }));
    });
    setActiveRoleId(role.id);
    setAgentActivity((current) => [result.activity, ...current.filter((item) => item.id !== result.activity.id)].slice(0, 160));
    setAgentStates((current) => current.map((agent) => (
      agent.id === result.activity.agentId
        ? {
            ...agent,
            status: result.activity.status,
            inputSummary: result.activity.inputSummary ?? agent.inputSummary,
            outputSummary: result.activity.outputSummary ?? result.activity.summary,
            lastRunAt: result.activity.timestamp,
            relatedRoleId: role.id,
            providerUsed: result.activity.providerUsed,
            modelUsed: result.activity.modelUsed,
            logs: result.activity.logs ?? [result.activity.summary],
          }
        : agent
    )));
    showToast(`${result.activity.summary}`);
    return role;
  }, [llmModel, llmProvider, showToast]);

  const deleteRole = useCallback((roleId: string) => {
    const role = roles.find((item) => item.id === roleId);
    if (!role) return;
    if (!window.confirm(`Delete ${role.roleTitle}? Related campaigns and shortlist references for this role will be removed from the workspace.`)) return;
    setRoles((current) => {
      const remaining = current.filter((item) => item.id !== roleId);
      const fallback = remaining[0] ?? ensureRoleIdentifiers(defaultRolePipeline());
      if (!remaining.length) return [fallback];
      return remaining;
    });
    setOutreachCampaigns((current) => current.filter((campaign) => campaign.roleId !== roleId));
    setOutreachResults((current) => current.filter((result) => result.roleId !== roleId));
    setInterestResults((current) => current.filter((interest) => interest.roleId !== roleId));
    setShortlistSettings((current) => current.filter((settings) => settings.roleId !== roleId));
    setActiveRoleId((current) => current === roleId ? (roles.find((item) => item.id !== roleId)?.id ?? defaultRole.id) : current);
    recordAgent("jd_intelligence", "completed", `Deleted role workspace ${role.roleTitle}.`);
    showToast(`Deleted role: ${role.roleTitle}`);
  }, [defaultRole.id, recordAgent, roles, showToast]);

  const duplicateRole = useCallback((role: RolePipeline) => {
    const now = new Date().toISOString();
    const duplicate = ensureRoleIdentifiers({
      ...role,
      id: makeId("role"),
      jdId: makeId("jd"),
      jobId: makeId("job"),
      roleTitle: `${role.roleTitle} Copy`,
      status: "draft",
      candidateMatches: [],
      outreachCampaigns: [],
      shortlist: [],
      createdAt: now,
      updatedAt: now,
    });
    setRoles((current) => [duplicate, ...current]);
    setActiveRoleId(duplicate.id);
    recordAgent("jd_intelligence", "completed", `Duplicated role workspace ${role.roleTitle}.`);
    showToast(`Duplicated role: ${role.roleTitle}`);
  }, [recordAgent, showToast]);

  const mergeCandidates = useCallback((incoming: CandidateProfile[], replace = false, sourceLabel = "candidate source") => {
    const stamped = incoming.map((candidate) => ensureCandidateIdentifier({ ...candidate, addedAt: candidate.addedAt ?? new Date().toISOString() }));
    setCandidates((current) => {
      if (replace) return stamped;
      const byId = new Map(current.map((candidate) => [candidate.id, candidate]));
      stamped.forEach((candidate) => byId.set(candidate.id, candidate));
      return Array.from(byId.values());
    });
    if (stamped[0]) {
      setSelectedCandidateId(stamped[0].id);
      setSelectedCandidateIds([stamped[0].id]);
    }
    recordAgent("source_discovery", "completed", `Imported ${stamped.length} candidates from ${sourceLabel}.`);
    showToast(`Imported ${stamped.length} candidates from ${sourceLabel}`);
  }, [recordAgent, showToast]);

  const handleRunScoutFlowAgents = useCallback(async (options: ScoutFlowRunOptions) => {
    const roleId = options.roleId || activeRole?.id;
    if (!roleId) return;

    const runOptions: ScoutFlowRunOptions = {
      ...options,
      roleId,
      sourceIds: options.sourceIds.length ? options.sourceIds : ["demo"],
      channels: options.channels,
      candidateLimit: Math.max(1, options.candidateLimit || 10),
      provider: options.provider && options.provider !== "auto" ? options.provider : llmProvider,
      model: options.model ?? (llmModel.trim() || undefined),
    };

    setActiveRoleId(roleId);
    setToast("ScoutFlow agents running...");
    setAgentStates((current) => current.map((agent) => ({
      ...agent,
      status: "running",
      inputSummary: `Run request for ${roles.find((role) => role.id === roleId)?.roleTitle ?? "selected role"}`,
      outputSummary: "Agent run in progress.",
    })));

    try {
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles,
          candidates,
          interestResults,
          outreachCampaigns,
          options: runOptions,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : `Agent run failed with ${response.status}`);
      }
      const result = payload as ScoutFlowRunResult;

      setRoles(result.roles.map(ensureRoleIdentifiers));
      setCandidates(result.candidates.map(ensureCandidateIdentifier));
      setOutreachResults((current) => [
        ...result.outreachResults,
        ...current.filter((item) => !result.outreachResults.some((next) => next.id === item.id)),
      ]);
      if (result.campaign) {
        setOutreachCampaigns((current) => [result.campaign!, ...current.filter((item) => item.id !== result.campaign!.id)]);
      }
      setInterestResults(result.interestResults);
      setAgentActivity((current) => [
        ...result.agentActivity,
        ...current.filter((item) => !result.agentActivity.some((activity) => activity.id === item.id)),
      ].slice(0, 160));
      setAgentStates(result.agentStates);
      setSelectedCandidateIds(result.recommendedCandidateIds);
      setSelectedCandidateId(result.recommendedCandidateIds[0] ?? selectedCandidateId);
      setActiveSection("dashboard");
      showToast(`ScoutFlow Agents completed: ${result.recommendedCandidateIds.length} candidates recommended.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent run failed";
      const activity = createAgentActivity("export", "error", message, { relatedRoleId: roleId });
      setAgentActivity((current) => [activity, ...current].slice(0, 160));
      setAgentStates((current) => current.map((agent) => ({
        ...agent,
        status: agent.status === "running" ? "error" : agent.status,
        outputSummary: agent.status === "running" ? message : agent.outputSummary,
      })));
      showToast(message);
    }
  }, [activeRole?.id, candidates, interestResults, llmModel, llmProvider, outreachCampaigns, roles, selectedCandidateId, showToast]);

  const saveCampaign = useCallback((campaign: OutreachCampaign, activities: AgentActivity[] = []) => {
    setOutreachCampaigns((current) => [campaign, ...current.filter((item) => item.id !== campaign.id)]);
    setOutreachResults((current) => [
      ...campaign.messages,
      ...current.filter((item) => !campaign.messages.some((message) => message.id === item.id)),
    ]);
    setInterestResults((current) => [
      ...campaign.interestResults,
      ...current.filter((item) => !campaign.interestResults.some((interest) => interest.candidateId === item.candidateId && interest.roleId === item.roleId)),
    ]);
    setRoles((current) => current.map((role) => (
      role.id === campaign.roleId
        ? ensureRoleIdentifiers({ ...role, outreachCampaigns: Array.from(new Set([campaign.id, ...role.outreachCampaigns])), updatedAt: new Date().toISOString() })
        : role
    )));
    if (activities.length) {
      setAgentActivity((current) => [
        ...activities,
        ...current.filter((item) => !activities.some((activity) => activity.id === item.id)),
      ].slice(0, 160));
      setAgentStates((current) => current.map((agent) => {
        const activity = activities.find((item) => item.agentId === agent.id);
        if (!activity) return agent;
        return {
          ...agent,
          status: activity.status,
          inputSummary: activity.inputSummary ?? agent.inputSummary,
          outputSummary: activity.outputSummary ?? activity.summary,
          lastRunAt: activity.timestamp,
          relatedRoleId: activity.relatedRoleId,
          providerUsed: activity.providerUsed,
          modelUsed: activity.modelUsed,
          logs: activity.logs ?? [activity.summary],
        };
      }));
    } else {
      recordAgent("outreach", "completed", `Generated ${campaign.messages.length} personalized messages across ${campaign.channels.length} channels.`);
      if (campaign.interestResults.length) {
        recordAgent("interest_detection", "completed", `Identified ${campaign.interestResults.filter((interest) => interest.interestScore >= 75).length} high-interest candidates.`);
      }
    }
    showToast(`Campaign updated: ${campaign.name}`);
  }, [recordAgent, showToast]);

  const saveInterest = useCallback((result: InterestResult) => {
    setInterestResults((current) => {
      const filtered = current.filter((existing) => !(existing.candidateId === result.candidateId && existing.roleId === result.roleId));
      return [result, ...filtered];
    });
    recordAgent(
      "interest_detection",
      "completed",
      `Captured intent ${result.interestScore} for ${result.candidateId} (${result.interestLevel}).`,
    );
  }, [recordAgent]);

  const runOutreachCampaign = useCallback(async (input: {
    candidateIds: string[];
    channels: OutreachCampaign["channels"];
    tone: OutreachCampaign["tone"];
    mode: ScoutFlowRunOptions["outreachMode"];
    audienceType?: OutreachCampaign["audienceType"];
    segmentId?: string;
  }) => {
    const response = await fetch("/api/agents/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: activeRole,
        candidates,
        matches: matchResults,
        existingInterest: interestResults,
        candidateIds: input.candidateIds,
        channels: input.channels,
        tone: input.tone,
        mode: input.mode,
        audienceType: input.audienceType,
        segmentId: input.segmentId,
        provider: llmProvider,
        model: llmModel.trim() || undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Outreach Agent failed");
    }
    const result = payload as OutreachAgentResponse;
    saveCampaign(result.campaign, result.agentActivity);
    return result.campaign;
  }, [activeRole, candidates, interestResults, llmModel, llmProvider, matchResults, saveCampaign]);

  const toggleCandidateSelection = useCallback((candidateId: string) => {
    setSelectedCandidateIds((current) => current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]);
    setSelectedCandidateId(candidateId);
  }, []);

  const setSelection = useCallback((candidateIds: string[]) => {
    setSelectedCandidateIds(candidateIds);
    if (candidateIds[0]) setSelectedCandidateId(candidateIds[0]);
  }, []);

  const updateShortlist = useCallback((candidateIds: string[], action: "add" | "remove") => {
    if (!activeRole) return;
    setRoles((current) => current.map((role) => {
      if (role.id !== activeRole.id) return role;
      const ids = new Set(role.shortlist);
      candidateIds.forEach((id) => {
        if (action === "add") ids.add(id);
        else ids.delete(id);
      });
      return { ...role, shortlist: Array.from(ids), updatedAt: new Date().toISOString() };
    }));
    recordAgent("ranking", "completed", `${action === "add" ? "Added" : "Removed"} ${candidateIds.length} candidates ${action === "add" ? "to" : "from"} ${activeRole.roleTitle} shortlist.`);
    showToast(`${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} ${action === "add" ? "added to" : "removed from"} shortlist`);
  }, [activeRole, recordAgent, showToast]);

  const createCandidateList = useCallback((name: string, candidateIds: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const id = makeId("segment");
    setCandidateLists((current) => [
      {
        id,
        name: trimmed,
        type: "custom",
        candidateIds,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ]);
    setCandidates((current) => current.map((candidate) => candidateIds.includes(candidate.id) ? { ...candidate, segments: Array.from(new Set([...(candidate.segments ?? []), id])) } : candidate));
    showToast(`Segment created: ${trimmed}`);
  }, [showToast]);

  const addToCandidateList = useCallback((listId: string, candidateIds: string[]) => {
    setCandidateLists((current) => current.map((list) => {
      if (list.id !== listId) return list;
      return {
        ...list,
        candidateIds: Array.from(new Set([...list.candidateIds, ...candidateIds])),
        updatedAt: new Date().toISOString(),
      };
    }));
    setCandidates((current) => current.map((candidate) => candidateIds.includes(candidate.id) ? { ...candidate, segments: Array.from(new Set([...(candidate.segments ?? []), listId])) } : candidate));
    showToast("Selected candidates added to segment");
  }, [showToast]);

  const autoSimulateAll = useCallback(() => {
    if (!activeRole) return;
    void handleRunScoutFlowAgents({
      roleId: activeRole.id,
      sourceIds: candidates.length ? [] : ["demo"],
      candidateLimit: 20,
      optimizationFocus: "balanced",
      channels: ["email", "linkedin", "phone"],
      outreachMode: "simulate_send_and_replies",
    });
  }, [activeRole, candidates.length, handleRunScoutFlowAgents]);

  const resetWorkspace = useCallback(() => {
    const role = ensureRoleIdentifiers(defaultRolePipeline());
    setRoles([role]);
    setActiveRoleId(role.id);
    const resetCandidates = demoCandidates.map((candidate) => ensureCandidateIdentifier({ ...candidate, addedAt: new Date().toISOString() }));
    setCandidates(resetCandidates);
    setOutreachResults([]);
    setOutreachCampaigns([]);
    setInterestResults([]);
    setCandidateLists([]);
    setSelectedCandidateIds([resetCandidates[0]?.id ?? ""]);
    setSelectedCandidateId(resetCandidates[0]?.id ?? "");
    setAgentActivity(initialAgentActivity());
    setAgentStates(initialAgentStates());
    setShortlistSettings([]);
    recordAgent("source_discovery", "completed", "Reset workspace and indexed the curated internal candidate pool.");
    setActiveSection("dashboard");
    showToast("Workspace reset with default role and candidate pool");
  }, [recordAgent, showToast]);

  const testLlmProvider = useCallback(async () => {
    const response = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: llmProvider,
        model: llmModel,
        systemPrompt: "You are a provider health check for ScoutFlow AI.",
        userPrompt: "Return one short sentence confirming provider availability.",
        fallback: "Local fallback is available.",
      }),
    });
    const data = (await response.json()) as LlmStatus & { text?: string; usedFallback?: boolean; error?: string };
    setLlmStatus(data);
    return data;
  }, [llmModel, llmProvider]);

  const changeLlmProvider = useCallback((provider: LlmProviderSetting) => {
    setLlmProvider(provider);
    setLlmStatus({
      provider,
      providerLabel: provider === "none" ? "Local Fallback" : providerDisplayName(provider),
      configured: false,
      mode: "fallback",
      model: llmModel || undefined,
    });
  }, [llmModel]);

  const changeLlmModel = useCallback((model: string) => {
    setLlmModel(model);
    setLlmStatus((current) => ({ ...current, model: model || undefined }));
  }, []);

  const handleLogin = useCallback((email: string) => {
    const normalized = email.trim();
    if (!normalized) return;
    safeSetItem(authStorageKey, JSON.stringify({ email: normalized, loggedInAt: new Date().toISOString() }));
    setUserEmail(normalized);
    setAuthenticated(true);
    showToast(`Signed in as ${normalized}`);
  }, [showToast]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(authStorageKey);
    setAuthenticated(false);
    setUserEmail("");
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <Dashboard
            roles={roles}
            activeRole={activeRole}
            candidates={candidates}
            matches={matchResults}
            interests={activeInterestResults}
            ranked={rankedShortlist}
            campaigns={outreachCampaigns}
            agentActivity={agentActivity}
            agentStates={agentStates}
            onNavigate={setActiveSection}
            onLoadDemo={() => mergeCandidates(demoCandidates, true, "Demo Database")}
            onAutoSimulate={autoSimulateAll}
            onRunAgents={handleRunScoutFlowAgents}
          />
        );
      case "role":
        return (
          <RoleBuilder
            roles={roles}
            activeRole={activeRole}
            candidates={candidates}
            matches={matchResults}
            onSaveRole={saveRole}
            onSelectRole={(roleId) => {
              setActiveRoleId(roleId);
              setActiveSection("role");
            }}
            onRunJDIntelligence={runJDIntelligence}
            onDeleteRole={deleteRole}
            onDuplicateRole={duplicateRole}
          />
        );
      case "sources":
        return (
          <SourceHub
            candidates={candidates}
            onLoadCandidates={mergeCandidates}
            onAgentActivity={recordAgent}
          />
        );
      case "candidates":
        return (
          <CandidateDiscovery
            candidates={candidates}
            matches={matchResults}
            interests={activeInterestResults}
            ranked={rankedShortlist}
            outreachResults={outreachResults.filter((result) => result.roleId === activeRole.id)}
            roles={roles}
            activeRole={activeRole}
            selectedCandidateIds={selectedCandidateIds}
            shortlistIds={activeRole.shortlist}
            customLists={candidateLists}
            onToggleCandidate={toggleCandidateSelection}
            onSetSelection={setSelection}
            onStartOutreach={(candidateIds) => {
              setSelection(candidateIds);
              setActiveSection("outreach");
            }}
            onLoadDemo={() => mergeCandidates(demoCandidates, true, "Demo Database")}
            onShortlist={updateShortlist}
            onCreateList={createCandidateList}
            onAddToList={addToCandidateList}
            onDeleteList={(listId) => {
              setCandidateLists((current) => current.filter((list) => list.id !== listId));
              setCandidates((current) => current.map((candidate) => ({ ...candidate, segments: (candidate.segments ?? []).filter((id) => id !== listId) })));
              showToast("Segment deleted");
            }}
            onRenameList={(listId, name) => {
              const trimmed = name.trim();
              if (!trimmed) return;
              setCandidateLists((current) => current.map((list) => list.id === listId ? { ...list, name: trimmed, updatedAt: new Date().toISOString() } : list));
              showToast("Segment renamed");
            }}
            onRemoveFromList={(listId, candidateIds) => {
              setCandidateLists((current) => current.map((list) => list.id === listId ? { ...list, candidateIds: list.candidateIds.filter((id) => !candidateIds.includes(id)), updatedAt: new Date().toISOString() } : list));
              setCandidates((current) => current.map((candidate) => candidateIds.includes(candidate.id) ? { ...candidate, segments: (candidate.segments ?? []).filter((id) => id !== listId) } : candidate));
              showToast("Selected candidates removed from segment");
            }}
            onSelectRole={setActiveRoleId}
            onRunMatching={() => {
              void handleRunScoutFlowAgents({
                roleId: activeRole.id,
                sourceIds: Array.from(new Set(candidates.map((candidate) => candidate.source))),
                candidateLimit: Math.max(candidates.length, 1),
                optimizationFocus: "balanced",
                channels: [],
                outreachMode: "draft_only",
              });
            }}
          />
        );
      case "outreach":
        return (
          <OutreachStudio
            roles={roles}
            activeRole={activeRole}
            candidates={candidates}
            matches={matchResults}
            interests={activeInterestResults}
            ranked={rankedShortlist}
            selectedCandidateIds={selectedCandidateIds}
            candidateLists={candidateLists}
            campaigns={outreachCampaigns}
            onSelectRole={setActiveRoleId}
            onSetSelection={setSelection}
            onSaveCampaign={saveCampaign}
            onRunCampaign={runOutreachCampaign}
            onSaveInterest={saveInterest}
          />
        );
      case "shortlist":
        return (
          <Shortlist
            activeRole={activeRole}
            candidates={candidates}
            matches={matchResults}
            interests={activeInterestResults}
            ranked={rankedShortlist}
            outreachResults={outreachResults.filter((result) => result.roleId === activeRole.id)}
            selectedCandidateIds={selectedCandidateIds}
            onSetSelection={setSelection}
            onShortlist={updateShortlist}
            onAutoSimulate={autoSimulateAll}
            shortlistSettings={shortlistSettings}
            onSaveSettings={(settings) => {
              setShortlistSettings((current) => [settings, ...current.filter((item) => item.roleId !== settings.roleId)]);
              recordAgent("ranking", "completed", `Refreshed ${activeRole.roleTitle} shortlist with ${settings.preset.replace("_", " ")} weighting.`);
            }}
            onViewed={() => recordAgent("ranking", "completed", `Prepared shortlist intelligence for ${activeRole.roleTitle}.`)}
          />
        );
      case "agents":
        return <AgentWorkflowPanel activities={agentActivity} agentStates={agentStates} roles={roles} />;
      case "export":
        return (
          <ExportPanel
            payload={exportPayload}
            jsonPreview={toExportJson(exportPayload)}
            activeRole={activeRole}
            onAgentActivity={(summary) => recordAgent("export", "completed", summary)}
          />
        );
      case "settings":
        return (
          <SettingsPanel
            llmStatus={llmStatus}
            llmProvider={llmProvider}
            llmModel={llmModel}
            onProviderChange={changeLlmProvider}
            onModelChange={changeLlmModel}
            onTestProvider={testLlmProvider}
            roles={roles.length}
            candidates={candidates.length}
            campaigns={outreachCampaigns.length}
            userEmail={userEmail}
            onLogout={handleLogout}
            onReset={resetWorkspace}
          />
        );
    }
  };

  if (!authReady) {
    return (
      <div className="liquid-bg flex min-h-screen items-center justify-center px-4">
        <GlassPanel className="w-full max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] text-white">
            <Bot className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-white">Preparing ScoutFlow AI...</p>
        </GlassPanel>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="liquid-bg min-h-screen overflow-hidden">
      <aside className="glass-panel fixed left-4 top-4 z-40 hidden h-[calc(100vh-2rem)] w-72 flex-col rounded-2xl p-4 lg:flex">
        <BrandBlock />
        <nav className="mt-8 flex flex-1 flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium ${
                  active
                    ? "bg-white/[0.12] text-white ring-1 ring-white/15"
                    : "text-slate-400 hover:bg-white/[0.07] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm text-white">
          <div className="font-semibold">Role Command Center</div>
          <p className="mt-2 text-xs leading-5 muted-text">
            Agent workflow, candidate engagement, and shortlist intelligence.
          </p>
        </div>
      </aside>

      <div className="lg:pl-80">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-black/25 backdrop-blur-2xl">
          <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="glass-button rounded-2xl p-3 text-white lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400/80">ScoutFlow AI</p>
                <h1 className="truncate text-xl font-semibold text-white sm:text-2xl">{navItems.find((item) => item.id === activeSection)?.label}</h1>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <label className="relative hidden max-w-md flex-1 xl:block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={workspaceSearch}
                  onChange={(event) => setWorkspaceSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && workspaceSearch.trim()) setActiveSection("candidates");
                  }}
                  placeholder="Search roles or candidates"
                  className="w-full rounded-full border border-white/10 bg-white/[0.055] py-2.5 pl-11 pr-4 text-sm text-white outline-none ring-white/10 transition placeholder:text-slate-500 focus:ring-4"
                />
              </label>
              <span className="hidden rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-slate-200 sm:inline-flex">
                Provider: {llmStatus.mode === "ai" ? llmStatus.providerLabel : "Local Fallback"}
              </span>
              <button
                onClick={() => setActiveSection("settings")}
                className="rounded-full border border-white/10 bg-white/[0.055] p-2.5 text-white hover:bg-white/[0.1]"
                aria-label="Open settings"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogout}
                className="glass-button flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                aria-label={`Sign out ${userEmail}`}
                title={`Signed in as ${userEmail}`}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="border-t border-white/5 px-4 py-2 text-xs text-slate-400 sm:px-6 lg:px-8">{toast}</div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{renderSection()}</main>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur lg:hidden">
          <div className="glass-panel m-3 rounded-2xl p-4">
            <div className="mb-4 flex items-center justify-between">
              <BrandBlock />
              <button className="rounded-2xl border border-white/10 p-3 text-white" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveSection(item.id);
                      setMobileNavOpen(false);
                    }}
                    className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-sm font-medium text-white"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BrandBlock() {
  return (
    <div className="flex items-center gap-3">
      <div className="glass-button flex h-12 w-12 items-center justify-center rounded-2xl text-white">
        <Bot className="h-6 w-6" />
      </div>
      <div>
        <div className="text-lg font-semibold text-white">ScoutFlow AI</div>
        <div className="text-xs muted-text">Talent intelligence workspace</div>
      </div>
    </div>
  );
}

function providerDisplayName(provider: LlmProviderSetting): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  if (provider === "auto") return "Auto";
  return "Local Fallback";
}

function LoginScreen({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState("recruiter@scoutflow.ai");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Enter an email and password to continue.");
      return;
    }
    onLogin(email);
  };

  return (
    <div className="liquid-bg flex min-h-screen items-center justify-center px-4 py-10">
      <GlassPanel className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <div className="glass-button flex h-12 w-12 items-center justify-center rounded-2xl text-white">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/70">Account Login</p>
            <h1 className="text-2xl font-semibold text-white">ScoutFlow AI</h1>
          </div>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="grid gap-2 text-sm text-slate-300">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
            />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
            />
          </label>
          {error ? <p className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{error}</p> : null}
          <button type="submit" className="w-full rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow">
            Sign In
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Demo authentication is local to this browser. No password or API key is sent to an LLM provider.
        </p>
      </GlassPanel>
    </div>
  );
}

function SettingsPanel({
  llmStatus,
  llmProvider,
  llmModel,
  onProviderChange,
  onModelChange,
  onTestProvider,
  roles,
  candidates,
  campaigns,
  userEmail,
  onLogout,
  onReset,
}: {
  llmStatus: LlmStatus;
  llmProvider: LlmProviderSetting;
  llmModel: string;
  onProviderChange: (provider: LlmProviderSetting) => void;
  onModelChange: (model: string) => void;
  onTestProvider: () => Promise<LlmStatus & { text?: string; usedFallback?: boolean; error?: string }>;
  roles: number;
  candidates: number;
  campaigns: number;
  userEmail: string;
  onLogout: () => void;
  onReset: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");

  const runTest = async () => {
    setTesting(true);
    setTestResult("Testing provider...");
    try {
      const result = await onTestProvider();
      const label = result.mode === "ai" && !result.usedFallback ? result.providerLabel : "Local Fallback";
      setTestResult(result.error ? `${label}: ${result.error}` : `${label}: ${result.text ?? "Provider test completed."}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "Provider test failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <GlassPanel>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400/70">Workspace Settings</p>
        <h2 className="mt-2 text-3xl font-semibold text-white">Operating mode and local data</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 muted-text">
          ScoutFlow AI stores role pipelines, candidates, conversation records, agent logs, and exports in browser localStorage for internal evaluation.
        </p>
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Role pipelines" value={roles} />
        <MetricCard label="Candidates indexed" value={candidates} />
        <MetricCard label="Campaign records" value={campaigns} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassPanel>
          <h3 className="text-lg font-semibold text-white">Account</h3>
          <p className="mt-3 text-sm leading-6 muted-text">
            This internal account session is stored locally in the browser for the hackathon workspace. Passwords are never persisted.
          </p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400/70">Signed in as</div>
            <div className="mt-1 truncate text-sm font-semibold text-white">{userEmail}</div>
          </div>
          <button
            onClick={onLogout}
            className="mt-5 rounded-full border border-white/10 bg-white/[0.055] px-5 py-3 text-sm font-semibold text-white hover:bg-white/[0.1]"
          >
            Sign Out
          </button>
        </GlassPanel>

        <GlassPanel>
          <h3 className="text-lg font-semibold text-white">LLM Provider</h3>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-slate-300">
              Provider
              <select
                value={llmProvider}
                onChange={(event) => onProviderChange(event.target.value as LlmProviderSetting)}
                className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
              >
                <option value="auto">Auto (use .env default)</option>
                <option value="openrouter">OpenRouter</option>
                <option value="gemini">Gemini</option>
                <option value="groq">Groq</option>
                <option value="huggingface">Hugging Face</option>
                <option value="none">Local Fallback (no LLM)</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm text-slate-300">
              Model name
              <input
                value={llmModel}
                onChange={(event) => onModelChange(event.target.value)}
                placeholder="Use .env.local default"
                className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
              />
            </label>
            <button
              onClick={runTest}
              disabled={testing}
              className="w-fit rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-glow disabled:opacity-60"
            >
              {testing ? "Testing..." : "Test Provider"}
            </button>
            <p className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-300">
              {testResult || "Keys are read only on the server from .env.local. The browser stores only provider and model selection."}
            </p>
          </div>
        </GlassPanel>

        <GlassPanel>
          <h3 className="text-lg font-semibold text-white">Runtime</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <span>Environment</span>
              <span className="font-semibold text-white">Server API + Browser Workspace</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <span>LLM provider</span>
              <span className="font-semibold text-white">{llmStatus.providerLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <span>Generation mode</span>
              <span className="font-semibold capitalize text-emerald-100">{llmStatus.mode === "ai" ? "AI assisted" : "Local fallback"}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <span>Configured</span>
              <span className="font-semibold text-white">{llmStatus.configured ? "Key found on server" : "No key required"}</span>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className="border-rose-300/15 bg-rose-300/[0.035] xl:col-span-2">
          <h3 className="text-lg font-semibold text-white">Reset workspace</h3>
          <p className="mt-3 text-sm leading-6 muted-text">
            Restores the default role workspace and internal candidate pool. Current browser-local role, campaign, segment, and agent log data will be replaced.
          </p>
          <button
            onClick={onReset}
            className="mt-5 rounded-full border border-rose-300/30 bg-rose-300/10 px-5 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-300/15"
          >
            Reset Workspace Data
          </button>
        </GlassPanel>
      </div>
    </div>
  );
}
