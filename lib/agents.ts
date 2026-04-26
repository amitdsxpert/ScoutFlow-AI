import type { AgentActivity, AgentId, AgentModuleState, AgentStatus } from "./types";
import { makeId } from "./roles";

export const agentDefinitions: Record<AgentId, { name: string; description: string; task: string }> = {
  jd_intelligence: {
    name: "JD Intelligence Agent",
    description: "Parses and validates role requirements, skills, work mode, seniority, and screening guidance.",
    task: "Parse role requirements, scoring weights, work mode, and screening questions.",
  },
  source_discovery: {
    name: "Source Discovery Agent",
    description: "Indexes candidates from approved local sources, uploads, and internal connector adapters.",
    task: "Index candidate profiles from approved internal and uploaded sources.",
  },
  resume_parsing: {
    name: "Resume Parsing Agent",
    description: "Validates uploaded resume-derived profiles and extracts confidence, skills, contact signals, and summary readiness.",
    task: "Parse and validate uploaded resume profiles before matching.",
  },
  candidate_matching: {
    name: "Candidate Matching Agent",
    description: "Scores candidates against the active role with explainable match dimensions.",
    task: "Score candidates against the active role pipeline.",
  },
  recommendation: {
    name: "Recommendation Agent",
    description: "Selects top candidates for a role using the selected optimization focus and hard-fit constraints.",
    task: "Recommend top candidates for the selected role and optimization focus.",
  },
  outreach: {
    name: "Outreach Agent",
    description: "Generates personalized outreach drafts for selected channels.",
    task: "Generate personalized multi-channel engagement drafts.",
  },
  phone_outreach: {
    name: "Phone Outreach Agent",
    description: "Creates phone scripts and voice interest-check transcripts when phone is selected.",
    task: "Create voice outreach scripts and interest-check transcripts.",
  },
  interest_detection: {
    name: "Interest Detection Agent",
    description: "Analyzes replies and transcripts to estimate candidate intent and next actions.",
    task: "Read replies and transcripts to estimate candidate intent.",
  },
  ranking: {
    name: "Ranking Agent",
    description: "Combines match, interest, availability, location, and risk into role-specific ranking outputs.",
    task: "Combine match and interest signals into recruiter-ready shortlists.",
  },
  export: {
    name: "Export Agent",
    description: "Prepares role shortlist, campaign, candidate pool, agent log, and workspace export packages.",
    task: "Package shortlists, candidates, roles, and campaign outputs for handoff.",
  },
};

export function createAgentActivity(
  agentId: AgentId,
  status: AgentStatus,
  summary: string,
  options: {
    inputSummary?: string;
    outputSummary?: string;
    reasoningSummary?: string;
    confidence?: number;
    providerUsed?: import("./types").AgentProviderUsed;
    modelUsed?: string;
    relatedRoleId?: string;
    logs?: string[];
  } = {},
): AgentActivity {
  const definition = agentDefinitions[agentId];
  return {
    id: makeId("agent"),
    agentId,
    name: definition.name,
    status,
    task: definition.task,
    description: definition.description,
    inputSummary: options.inputSummary,
    outputSummary: options.outputSummary ?? summary,
    reasoningSummary: options.reasoningSummary,
    confidence: options.confidence,
    providerUsed: options.providerUsed,
    modelUsed: options.modelUsed,
    relatedRoleId: options.relatedRoleId,
    logs: options.logs,
    summary,
    timestamp: new Date().toISOString(),
  };
}

export function initialAgentStates(): AgentModuleState[] {
  return Object.entries(agentDefinitions).map(([id, definition]) => ({
    id: id as AgentId,
    name: definition.name,
    description: definition.description,
    status: "idle",
    inputSummary: "Waiting for a role command.",
    outputSummary: "No run yet.",
    logs: [],
  }));
}

export function initialAgentActivity(): AgentActivity[] {
  return initialAgentStates().map((agent) => createAgentActivity(agent.id, "idle", "Waiting for recruiter workflow activity."));
}

export function activityToAgentState(activity: AgentActivity): AgentModuleState {
  const definition = agentDefinitions[activity.agentId];
  return {
    id: activity.agentId,
    name: definition.name,
    description: definition.description,
    status: activity.status,
    inputSummary: activity.inputSummary ?? definition.task,
    outputSummary: activity.outputSummary ?? activity.summary,
    lastRunAt: activity.timestamp,
    relatedRoleId: activity.relatedRoleId,
    providerUsed: activity.providerUsed,
    modelUsed: activity.modelUsed,
    logs: activity.logs ?? [activity.reasoningSummary ?? activity.summary],
  };
}
