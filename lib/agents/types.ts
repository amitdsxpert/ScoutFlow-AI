import { createAgentActivity } from "@/lib/agents";
import type {
  AgentActivity,
  AgentId,
  AgentRunLog as WorkspaceAgentRunLog,
  AgentStatus as WorkspaceAgentStatus,
  CandidateSource,
  Channel,
  OptimizationFocus,
  OutreachMode,
} from "@/lib/types";

export type AgentStatus = WorkspaceAgentStatus;
export type AgentLlmProvider = "auto" | "none" | "openrouter" | "gemini" | "groq" | "huggingface";
export type AgentRunLog = WorkspaceAgentRunLog;

export interface AgentExecutionResult<T> {
  output: T;
  activity: AgentActivity;
  runLog: AgentRunLog;
}

export interface ScoutFlowAgentRunCommand {
  roleId: string;
  candidateLimit: number;
  selectedSources?: CandidateSource[];
  selectedChannels?: Channel[];
  sourceIds?: CandidateSource[];
  channels?: Channel[];
  optimizationFocus?: OptimizationFocus;
  outreachMode?: OutreachMode;
  provider?: AgentLlmProvider;
  model?: string;
}

export function completeAgent<T>(
  agentId: AgentId,
  status: AgentStatus,
  output: T,
  summary: string,
  options: {
    inputSummary?: string;
    outputSummary?: string;
    reasoningSummary?: string;
    confidence?: number;
    providerUsed?: import("@/lib/types").AgentProviderUsed;
    modelUsed?: string;
    roleId?: string;
    logs?: string[];
  } = {},
): AgentExecutionResult<T> {
  const activity = createAgentActivity(agentId, status, summary, {
    relatedRoleId: options.roleId,
    inputSummary: options.inputSummary,
    outputSummary: options.outputSummary ?? summary,
    reasoningSummary: options.reasoningSummary,
    confidence: options.confidence,
    providerUsed: options.providerUsed,
    modelUsed: options.modelUsed,
    logs: options.logs,
  });

  return {
    output,
    activity,
    runLog: {
      id: activity.id,
      agentName: activity.name,
      status,
      inputSummary: options.inputSummary ?? activity.task,
      outputSummary: options.outputSummary ?? summary,
    reasoningSummary: options.reasoningSummary ?? summary,
    confidence: options.confidence ?? 0.82,
    providerUsed: options.providerUsed,
    modelUsed: options.modelUsed,
    roleId: options.roleId,
    timestamp: activity.timestamp,
  },
  };
}

export function availabilityScore(availability: string): number {
  const normalized = availability.toLowerCase();
  if (normalized.includes("immediate")) return 98;
  if (normalized.includes("15")) return 92;
  if (normalized.includes("30")) return 84;
  if (normalized.includes("45")) return 72;
  if (normalized.includes("60")) return 58;
  if (normalized.includes("90")) return 38;
  if (normalized.includes("not")) return 12;
  return 60;
}
