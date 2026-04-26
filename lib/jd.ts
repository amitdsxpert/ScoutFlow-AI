import type { ParsedJD, ScoringWeights, WorkMode } from "./types";

export const DEFAULT_WEIGHTS: ScoringWeights = {
  requiredSkills: 0.35,
  experience: 0.2,
  preferredSkills: 0.15,
  domain: 0.15,
  location: 0.1,
  riskAdjustment: 0.05,
};

export const skillAliases: Record<string, string> = {
  postgres: "postgresql",
  postgre: "postgresql",
  "postgre sql": "postgresql",
  node: "node.js",
  nodejs: "node.js",
  js: "javascript",
  ts: "typescript",
  genai: "generative ai",
  "gen ai": "generative ai",
  rag: "retrieval augmented generation",
  llm: "large language models",
  llms: "large language models",
  ai: "artificial intelligence",
  "fast api": "fastapi",
  openai: "llm apis",
  "openai api": "llm apis",
  "vector db": "vector databases",
  "vector database": "vector databases",
  pgvector: "vector databases",
};

export const skillDictionary = [
  "python",
  "fastapi",
  "postgresql",
  "docker",
  "kubernetes",
  "aws",
  "gcp",
  "azure",
  "cloud",
  "large language models",
  "llm apis",
  "retrieval augmented generation",
  "vector databases",
  "distributed systems",
  "microservices",
  "typescript",
  "javascript",
  "node.js",
  "redis",
  "kafka",
  "terraform",
  "observability",
  "langchain",
  "machine learning",
  "system design",
  "rest apis",
  "celery",
  "sql",
  "data modeling",
  "prompt engineering",
  "artificial intelligence",
  "generative ai",
];

export const domainKeywords = [
  "generative ai",
  "artificial intelligence",
  "backend",
  "platform",
  "api",
  "apis",
  "distributed",
  "retrieval augmented generation",
  "rag",
  "vector",
  "large language models",
  "llm",
  "cloud",
  "microservices",
  "orchestration",
  "observability",
  "reliability",
];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSkill(value: string): string {
  const normalized = normalizeText(value)
    .replace(/\bc\+\+\b/g, "cpp")
    .replace(/\bc#\b/g, "csharp");

  return skillAliases[normalized] ?? normalized;
}

export function normalizeSkillSet(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeSkill).filter(Boolean)));
}

export function extractSkills(text: string): string[] {
  const normalized = ` ${normalizeText(text)} `;
  const found = new Set<string>();

  for (const [alias, canonical] of Object.entries(skillAliases)) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (pattern.test(normalized)) {
      found.add(canonical);
    }
  }

  for (const skill of skillDictionary) {
    const pattern = new RegExp(`\\b${escapeRegExp(skill)}\\b`, "i");
    if (pattern.test(normalized)) {
      found.add(skill);
    }
  }

  return Array.from(found);
}

export function parseJD(rawText: string): ParsedJD {
  const text = rawText.trim();
  const normalized = normalizeText(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const roleTitle = detectRoleTitle(lines, normalized);
  const minYearsExperience = detectYearsExperience(normalized);
  const workMode = detectWorkMode(normalized);
  const location = detectLocation(text, workMode);
  const seniority = detectSeniority(roleTitle, normalized);
  const department = detectDepartment(roleTitle, normalized);
  const allSkills = extractSkills(text);
  const preferredSkills = detectPreferredSkills(text, allSkills);
  const requiredSkills = detectRequiredSkills(text, allSkills, preferredSkills);
  const responsibilities = detectResponsibilities(text, roleTitle);
  const dealBreakers = detectDealBreakers(requiredSkills, minYearsExperience, workMode);
  const screeningQuestions = detectScreeningQuestions(requiredSkills, preferredSkills, workMode);
  const qualityScore = calculateJDQualityScore({
    roleTitle,
    requiredSkills,
    preferredSkills,
    responsibilities,
    location,
    minYearsExperience,
    rawText: text,
  });

  return {
    roleTitle,
    seniority,
    department,
    location,
    workMode,
    requiredSkills,
    preferredSkills,
    minYearsExperience,
    responsibilities,
    dealBreakers,
    screeningQuestions,
    scoringWeights: DEFAULT_WEIGHTS,
    qualityScore,
    rawText: text,
  };
}

export function createFallbackJD(description: string): string {
  const roleTitle = detectRoleTitle([description], normalizeText(description));
  const skills = extractSkills(description);
  const requiredSkills = ensureSkills(skills, ["python", "fastapi", "postgresql", "docker", "cloud", "llm apis"]);
  const preferredSkills = ensureSkills(
    skills.filter((skill) => !requiredSkills.includes(skill)),
    ["retrieval augmented generation", "vector databases", "distributed systems", "kubernetes", "typescript"],
  );

  return `${roleTitle || "Senior Backend Engineer"} — GenAI Platform

We are hiring a ${roleTitle || "Senior Backend Engineer"} to build reliable backend services for a GenAI platform. The ideal candidate has 5+ years of software engineering experience and strong ownership across ${requiredSkills.slice(0, 6).join(", ")}. Experience with ${preferredSkills.slice(0, 5).join(", ")} is preferred. Location: Remote India.

Responsibilities:
- Design, build, and operate scalable backend services for AI product workflows.
- Build API layers, async jobs, provider integrations, and observability for LLM-powered features.
- Partner with product, data, and ML teammates to ship safe, measurable GenAI experiences.
- Improve reliability, latency, developer experience, and platform quality.

Required skills:
- ${requiredSkills.join("\n- ")}

Preferred skills:
- ${preferredSkills.join("\n- ")}

Screening questions:
- Tell us about a production backend service you owned end to end.
- How have you integrated or evaluated LLM APIs?
- What trade-offs would you consider when designing a RAG pipeline?
- Are you comfortable working in a remote India setup?`;
}

function detectRoleTitle(lines: string[], normalized: string): string {
  const firstUseful = lines.find((line) => /engineer|developer|architect|scientist|manager|lead|platform|backend|ai/i.test(line));
  if (firstUseful) {
    return firstUseful
      .replace(/^role\s*:\s*/i, "")
      .replace(/\s+we are hiring.*$/i, "")
      .split(/[|]/)[0]
      .trim();
  }

  const match = normalized.match(/(?:hire|hiring|need|looking for)\s+(?:a|an)?\s*([a-z0-9\s+-]*(?:engineer|developer|architect|scientist|lead|manager))/i);
  if (match?.[1]) {
    return toTitleCase(match[1]);
  }

  return "Senior Backend Engineer";
}

function detectYearsExperience(normalized: string): number {
  const plusMatch = normalized.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)/i);
  if (plusMatch) {
    return Number(plusMatch[1]);
  }

  const rangeMatch = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:years|yrs)/i);
  if (rangeMatch) {
    return Number(rangeMatch[1]);
  }

  return normalized.includes("senior") ? 5 : 3;
}

function detectWorkMode(normalized: string): WorkMode {
  if (/\bremote\b|work from home|wfh/.test(normalized)) return "remote";
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\bonsite\b|on site|office/.test(normalized)) return "onsite";
  return "unknown";
}

function detectLocation(text: string, workMode: WorkMode): string {
  const locationMatch = text.match(/location\s*:\s*([^\n.]+)/i);
  if (locationMatch?.[1]) {
    return locationMatch[1].trim();
  }

  const normalized = normalizeText(text);
  if (normalized.includes("india")) {
    return workMode === "remote" ? "Remote India" : "India";
  }
  if (normalized.includes("bengaluru") || normalized.includes("bangalore")) return "Bengaluru, India";
  if (normalized.includes("pune")) return "Pune, India";
  if (normalized.includes("hyderabad")) return "Hyderabad, India";
  return workMode === "remote" ? "Remote" : "Not specified";
}

function detectSeniority(roleTitle: string, normalized: string): string {
  const haystack = normalizeText(`${roleTitle} ${normalized}`);
  if (haystack.includes("principal")) return "Principal";
  if (haystack.includes("staff")) return "Staff";
  if (haystack.includes("senior") || haystack.includes("lead")) return "Senior";
  if (haystack.includes("junior")) return "Junior";
  return "Mid-Senior";
}

function detectDepartment(roleTitle: string, normalized: string): string {
  const haystack = normalizeText(`${roleTitle} ${normalized}`);
  if (haystack.includes("data scientist") || haystack.includes("machine learning")) return "Data & AI";
  if (haystack.includes("frontend")) return "Engineering - Frontend";
  if (haystack.includes("backend") || haystack.includes("platform")) return "Engineering - Platform";
  if (haystack.includes("product")) return "Product";
  return "Engineering";
}

function detectPreferredSkills(text: string, allSkills: string[]): string[] {
  const preferredBlocks = extractSectionText(text, /(preferred|nice to have|bonus|plus)/i);
  const preferred = extractSkills(preferredBlocks);

  if (preferred.length > 0) {
    return preferred;
  }

  return allSkills.filter((skill) =>
    [
      "retrieval augmented generation",
      "vector databases",
      "distributed systems",
      "kubernetes",
      "typescript",
      "langchain",
      "observability",
      "terraform",
    ].includes(skill),
  );
}

function detectRequiredSkills(text: string, allSkills: string[], preferredSkills: string[]): string[] {
  const requiredBlocks = extractSectionText(text, /(required|must have|ideal candidate|strong)/i);
  const required = extractSkills(requiredBlocks).filter((skill) => !preferredSkills.includes(skill));
  const fallbackCore = allSkills.filter((skill) => !preferredSkills.includes(skill));
  return ensureSkills(required.length > 0 ? required : fallbackCore, ["python", "fastapi", "postgresql", "docker", "cloud", "llm apis"]).slice(0, 10);
}

function detectResponsibilities(text: string, roleTitle: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => /responsibilit/i.test(line));
  const items = start >= 0
    ? lines
        .slice(start + 1)
        .filter((line) => !/required|preferred|screening|qualification/i.test(line))
        .slice(0, 5)
    : [];

  if (items.length >= 2) {
    return items;
  }

  return [
    `Design and ship production-grade backend services for the ${roleTitle} scope.`,
    "Build APIs, async workflows, integrations, observability, and reliability improvements.",
    "Partner with product, data, and ML teams to convert requirements into safe product capabilities.",
    "Improve platform quality, latency, developer experience, and operational excellence.",
  ];
}

function detectDealBreakers(requiredSkills: string[], minYearsExperience: number, workMode: WorkMode): string[] {
  const breakers = [
    `Less than ${Math.max(0, minYearsExperience - 2)} years of relevant software engineering experience.`,
    "No evidence of backend service ownership.",
  ];

  if (requiredSkills.length > 0) {
    breakers.push(`Missing multiple core skills: ${requiredSkills.slice(0, 4).join(", ")}.`);
  }

  if (workMode === "onsite" || workMode === "hybrid") {
    breakers.push("Unable to work in the required location or work mode.");
  }

  return breakers;
}

function detectScreeningQuestions(requiredSkills: string[], preferredSkills: string[], workMode: WorkMode): string[] {
  const coreSkill = requiredSkills[0] ?? "backend services";
  const preferred = preferredSkills[0] ?? "platform reliability";

  return [
    `Tell us about a production ${coreSkill} system you owned end to end.`,
    `Which trade-offs would you consider when adding ${preferred} to a backend platform?`,
    "How do you approach reliability, monitoring, and incident prevention for APIs?",
    workMode === "unknown"
      ? "What work mode and location constraints should we know about?"
      : `Are you comfortable with the ${workMode} work mode for this role?`,
  ];
}

function calculateJDQualityScore(input: {
  roleTitle: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  location: string;
  minYearsExperience: number;
  rawText: string;
}): number {
  let score = 30;
  if (input.roleTitle.length > 6) score += 10;
  if (input.requiredSkills.length >= 4) score += 20;
  if (input.preferredSkills.length >= 2) score += 10;
  if (input.responsibilities.length >= 3) score += 10;
  if (input.location !== "Not specified") score += 10;
  if (input.minYearsExperience > 0) score += 5;
  if (input.rawText.length > 500) score += 5;
  return Math.min(100, score);
}

function extractSectionText(text: string, headerPattern: RegExp): string {
  const lines = text.split(/\r?\n/);
  const matches: string[] = [];

  lines.forEach((line, index) => {
    if (headerPattern.test(line)) {
      matches.push(line, ...lines.slice(index + 1, index + 8));
    }
  });

  return matches.join("\n");
}

function ensureSkills(current: string[], fallbacks: string[]): string[] {
  const result = new Set(normalizeSkillSet(current));
  for (const skill of fallbacks) {
    result.add(normalizeSkill(skill));
  }
  return Array.from(result);
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
