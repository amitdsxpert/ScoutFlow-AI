import { createFallbackJD, parseJD } from "@/lib/jd";
import { roleFromParsedJD } from "@/lib/roles";
import type { ParsedJD, RolePipeline, RoleStatus } from "@/lib/types";
import { generateAgentText } from "./llmClient";
import { completeAgent, type AgentExecutionResult, type AgentLlmProvider } from "./types";

export interface JDIntelligenceOutput {
  role: RolePipeline;
  roleTitle: string;
  skills: string[];
  location: string;
  experience: number;
  enrichedJDText?: string;
  confidence?: number;
  providerUsed?: string;
  reasoningSummary?: string;
}

export interface JDIntelligenceInput {
  rawInput: string;
  mode: "parse" | "generate";
  status?: RoleStatus;
  existingRole?: RolePipeline;
  provider?: AgentLlmProvider;
  model?: string;
}

interface JDJsonOutput {
  roleTitle?: string;
  department?: string;
  seniority?: string;
  location?: string;
  workMode?: ParsedJD["workMode"];
  requiredSkills?: string[];
  preferredSkills?: string[];
  minYearsExperience?: number;
  responsibilities?: string[];
  dealBreakers?: string[];
  screeningQuestions?: string[];
  enrichedJDText?: string;
  confidence?: number;
  reasoningSummary?: string;
}

export async function runJDIntelligenceFromInput(input: JDIntelligenceInput): Promise<AgentExecutionResult<JDIntelligenceOutput>> {
  const fallbackText = input.mode === "generate" ? createFallbackJD(input.rawInput) : input.rawInput;
  const fallbackParsed = parseJD(fallbackText);
  const fallbackJson: Required<Pick<JDJsonOutput, "roleTitle" | "department" | "seniority" | "location" | "workMode" | "requiredSkills" | "preferredSkills" | "minYearsExperience" | "responsibilities" | "dealBreakers" | "screeningQuestions" | "enrichedJDText" | "confidence" | "reasoningSummary">> = {
    roleTitle: fallbackParsed.roleTitle,
    department: fallbackParsed.department,
    seniority: fallbackParsed.seniority,
    location: fallbackParsed.location,
    workMode: fallbackParsed.workMode,
    requiredSkills: fallbackParsed.requiredSkills,
    preferredSkills: fallbackParsed.preferredSkills,
    minYearsExperience: fallbackParsed.minYearsExperience,
    responsibilities: fallbackParsed.responsibilities,
    dealBreakers: fallbackParsed.dealBreakers,
    screeningQuestions: fallbackParsed.screeningQuestions,
    enrichedJDText: fallbackText,
    confidence: fallbackParsed.qualityScore,
    reasoningSummary: "Deterministic parser extracted role requirements, skill groups, work mode, location, and screening questions.",
  };

  const result = await generateAgentText({
    task: input.mode === "generate" ? "Generate and parse a recruiting JD" : "Parse and enrich a recruiting JD",
    provider: input.provider,
    model: input.model,
    jsonMode: true,
    systemPrompt: [
      "You are ScoutFlow AI's JD Intelligence Agent.",
      "Return valid JSON only. Do not include markdown.",
      "Extract or generate a realistic recruiting job description, then return structured fields.",
      "Do not invent paid integrations or assessment/interview requirements.",
    ].join(" "),
    userPrompt: [
      `Mode: ${input.mode}`,
      "Input:",
      input.rawInput,
      "",
      "JSON schema keys:",
      "roleTitle, department, seniority, location, workMode(remote|hybrid|onsite|unknown), requiredSkills(string[]), preferredSkills(string[]), minYearsExperience(number), responsibilities(string[]), dealBreakers(string[]), screeningQuestions(string[]), enrichedJDText(string), confidence(number 0-100), reasoningSummary(string).",
    ].join("\n"),
    fallbackJson,
    fallbackText,
  });

  const parsedOutput = normalizeJDJson(result.json, fallbackJson);
  const enrichedJDText = parsedOutput.enrichedJDText || fallbackText;
  const parsedFromText = parseJD(enrichedJDText);
  const parsedJD: ParsedJD = {
    ...parsedFromText,
    roleTitle: parsedOutput.roleTitle || parsedFromText.roleTitle,
    department: parsedOutput.department || parsedFromText.department,
    seniority: parsedOutput.seniority || parsedFromText.seniority,
    location: parsedOutput.location || parsedFromText.location,
    workMode: parsedOutput.workMode || parsedFromText.workMode,
    requiredSkills: cleanStringArray(parsedOutput.requiredSkills, parsedFromText.requiredSkills),
    preferredSkills: cleanStringArray(parsedOutput.preferredSkills, parsedFromText.preferredSkills),
    minYearsExperience: Number(parsedOutput.minYearsExperience) || parsedFromText.minYearsExperience,
    responsibilities: cleanStringArray(parsedOutput.responsibilities, parsedFromText.responsibilities),
    dealBreakers: cleanStringArray(parsedOutput.dealBreakers, parsedFromText.dealBreakers),
    screeningQuestions: cleanStringArray(parsedOutput.screeningQuestions, parsedFromText.screeningQuestions),
    qualityScore: clamp(Number(parsedOutput.confidence) || parsedFromText.qualityScore, 40, 98),
    rawText: enrichedJDText,
  };
  const role = input.existingRole
    ? {
        ...input.existingRole,
        roleTitle: parsedJD.roleTitle,
        rawJD: input.rawInput,
        enrichedJDText,
        parsedJD,
        status: input.status ?? input.existingRole.status,
        updatedAt: new Date().toISOString(),
      }
    : {
        ...roleFromParsedJD(parsedJD, input.rawInput, input.status ?? "active"),
        enrichedJDText,
      };

  const skills = Array.from(new Set([...parsedJD.requiredSkills, ...parsedJD.preferredSkills]));
  const outputSummary = `Parsed ${parsedJD.roleTitle} with ${parsedJD.requiredSkills.length} required skills using ${providerDisplay(result.providerUsed)}.`;
  const execution = completeAgent("jd_intelligence", "completed", {
    role,
    roleTitle: parsedJD.roleTitle,
    skills,
    location: parsedJD.location,
    experience: parsedJD.minYearsExperience,
    enrichedJDText,
    confidence: parsedJD.qualityScore,
    providerUsed: result.providerUsed,
    reasoningSummary: parsedOutput.reasoningSummary,
  }, outputSummary, {
    roleId: role.id,
    inputSummary: input.rawInput.slice(0, 220),
    outputSummary,
    reasoningSummary: parsedOutput.reasoningSummary,
    confidence: parsedJD.qualityScore / 100,
    providerUsed: result.providerUsed,
    modelUsed: result.modelUsed,
    logs: [
      `Mode: ${input.mode}`,
      `Provider used: ${providerDisplay(result.providerUsed)}`,
      result.modelUsed ? `Model used: ${result.modelUsed}` : "Model used: local deterministic fallback",
      `Required skills: ${parsedJD.requiredSkills.join(", ")}`,
      `Confidence: ${parsedJD.qualityScore}%`,
      ...(result.error ? [`Provider note: ${result.error}`] : []),
    ],
  });

  execution.output.role = {
    ...execution.output.role,
    agentProviderUsed: result.providerUsed,
    agentModelUsed: result.modelUsed,
    agentConfidence: parsedJD.qualityScore,
    agentReasoningSummary: parsedOutput.reasoningSummary,
    agentLogs: [execution.runLog, ...(input.existingRole?.agentLogs ?? [])].slice(0, 20),
  };

  return execution;
}

export async function runJDIntelligenceAgent(role: RolePipeline, provider?: AgentLlmProvider, model?: string): Promise<AgentExecutionResult<JDIntelligenceOutput>> {
  const skills = Array.from(new Set([...role.parsedJD.requiredSkills, ...role.parsedJD.preferredSkills]));
  const output: JDIntelligenceOutput = {
    role,
    roleTitle: role.roleTitle,
    skills,
    location: role.parsedJD.location,
    experience: role.parsedJD.minYearsExperience,
  };
  const outputSummary = `Parsed ${role.roleTitle} with ${role.parsedJD.requiredSkills.length} required skills, ${role.parsedJD.location}, and ${role.parsedJD.minYearsExperience}+ years target.`;
  const fallbackReasoning = `Validated the active JD, normalized required and preferred skills, checked location/work mode, and preserved the role scoring weights for downstream matching.`;
  const reasoning = await generateAgentText({
    provider,
    model,
    systemPrompt: "You are the JD Intelligence Agent for ScoutFlow AI. Explain parsing decisions without changing extracted data.",
    userPrompt: `Summarize the JD parsing reasoning in one sentence for ${role.roleTitle}. Required skills: ${role.parsedJD.requiredSkills.join(", ")}. Preferred skills: ${role.parsedJD.preferredSkills.join(", ")}. Location: ${role.parsedJD.location}.`,
    fallback: fallbackReasoning,
  });

  return completeAgent("jd_intelligence", "completed", output, outputSummary, {
    roleId: role.id,
    inputSummary: role.rawJD.slice(0, 180),
    outputSummary,
    reasoningSummary: reasoning.text,
    confidence: Math.max(0.68, Math.min(0.98, role.parsedJD.qualityScore / 100)),
    providerUsed: reasoning.providerUsed,
    modelUsed: reasoning.modelUsed,
    logs: [
      `Role title: ${role.roleTitle}`,
      `Required skills: ${role.parsedJD.requiredSkills.join(", ")}`,
      `Location: ${role.parsedJD.location}`,
      `Experience: ${role.parsedJD.minYearsExperience}+ years`,
      `Provider used: ${providerDisplay(reasoning.providerUsed)}`,
      reasoning.modelUsed ? `Model used: ${reasoning.modelUsed}` : "Model used: local deterministic fallback",
    ],
  });
}

function normalizeJDJson(json: unknown, fallback: JDJsonOutput): JDJsonOutput {
  if (!json || typeof json !== "object") return fallback;
  const record = json as Record<string, unknown>;
  return {
    roleTitle: asString(record.roleTitle) || fallback.roleTitle,
    department: asString(record.department) || fallback.department,
    seniority: asString(record.seniority) || fallback.seniority,
    location: asString(record.location) || fallback.location,
    workMode: asWorkMode(record.workMode) || fallback.workMode,
    requiredSkills: asStringArray(record.requiredSkills) ?? fallback.requiredSkills,
    preferredSkills: asStringArray(record.preferredSkills) ?? fallback.preferredSkills,
    minYearsExperience: asNumber(record.minYearsExperience) ?? fallback.minYearsExperience,
    responsibilities: asStringArray(record.responsibilities) ?? fallback.responsibilities,
    dealBreakers: asStringArray(record.dealBreakers) ?? fallback.dealBreakers,
    screeningQuestions: asStringArray(record.screeningQuestions) ?? fallback.screeningQuestions,
    enrichedJDText: asString(record.enrichedJDText) || fallback.enrichedJDText,
    confidence: asNumber(record.confidence) ?? fallback.confidence,
    reasoningSummary: asString(record.reasoningSummary) || fallback.reasoningSummary,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(next) ? next : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => asString(item)).filter(Boolean);
}

function asWorkMode(value: unknown): ParsedJD["workMode"] | undefined {
  const text = asString(value).toLowerCase();
  if (text === "remote" || text === "hybrid" || text === "onsite" || text === "unknown") return text;
  return undefined;
}

function cleanStringArray(value: string[] | undefined, fallback: string[]): string[] {
  const cleaned = Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
  return cleaned.length ? cleaned : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function providerDisplay(provider: string): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "huggingface") return "Hugging Face";
  return "Local Fallback";
}
