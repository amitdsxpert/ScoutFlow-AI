import type { CandidateProfile, CandidateSource } from "./types";
import { ensureCandidateIdentifier } from "./identity";

export function parseCandidateCsv(text: string, source: CandidateSource = "csv"): CandidateProfile[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => normalizeHeader(header));
  return rows.slice(1).map((row, index) => {
    const record = new Map(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    const name = value(record, "name") || `Imported Candidate ${index + 1}`;

    return ensureCandidateIdentifier({
      id: `${source}-${slugify(name)}-${index + 1}`,
      name,
      email: value(record, "email") || undefined,
      phone: value(record, "phone") || undefined,
      location: value(record, "location") || "Unknown",
      currentTitle: value(record, "title") || value(record, "currenttitle") || "Imported Candidate",
      currentCompany: value(record, "company") || undefined,
      yearsExperience: Number(value(record, "yearsexperience") || value(record, "years_experience") || 0),
      skills: splitList(value(record, "skills")),
      projects: splitList(value(record, "projects")),
      summary: value(record, "summary") || "Imported candidate profile.",
      source,
      addedAt: new Date().toISOString(),
      persona: {
        type: "passive",
        openness: 0.62,
        enthusiasm: 0.56,
        availability: "60 days",
        compensationSensitivity: "medium",
        likelyObjections: ["Imported profile needs recruiter validation."],
      },
    });
  });
}

export function parseCandidateJson(text: string, source: CandidateSource = "json"): CandidateProfile[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("JSON must be an array of candidate objects.");
  }

  return parsed.map((item, index) => {
    const record = item as Partial<CandidateProfile> & {
      title?: string;
      company?: string;
      years_experience?: number;
    };
    const name = record.name || `JSON Candidate ${index + 1}`;

    return ensureCandidateIdentifier({
      id: record.id || `${source}-${slugify(name)}-${index + 1}`,
      globalCandidateId: record.globalCandidateId,
      name,
      email: record.email,
      phone: record.phone,
      location: record.location || "Unknown",
      currentTitle: record.currentTitle || record.title || "Imported Candidate",
      currentCompany: record.currentCompany || record.company,
      yearsExperience: Number(record.yearsExperience ?? record.years_experience ?? 0),
      skills: Array.isArray(record.skills) ? record.skills : [],
      projects: Array.isArray(record.projects) ? record.projects : [],
      summary: record.summary || "Imported JSON candidate profile.",
      source,
      addedAt: new Date().toISOString(),
      persona: record.persona ?? {
        type: "passive",
        openness: 0.62,
        enthusiasm: 0.56,
        availability: "60 days",
        compensationSensitivity: "medium",
        likelyObjections: ["Imported profile needs recruiter validation."],
      },
    });
  });
}

export function candidateFromResumeText(text: string): CandidateProfile {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || "Resume Candidate";
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(?:\+?\d[\d\s-]{8,}\d)/)?.[0];
  const yearsMatch = text.match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
  const skills = extractLooseSkills(text);

  return ensureCandidateIdentifier({
    id: `resume-${slugify(name)}-${Date.now()}`,
    name,
    email,
    phone,
    location: detectLocation(text),
    currentTitle: lines.find((line) => /engineer|developer|architect|scientist|lead/i.test(line)) || "Resume Upload Candidate",
    yearsExperience: yearsMatch ? Number(yearsMatch[1]) : 0,
    skills,
    projects: lines.filter((line) => /built|created|designed|led|owned|implemented/i.test(line)).slice(0, 4),
    summary: lines.slice(0, 5).join(" "),
    source: "resume_upload",
    addedAt: new Date().toISOString(),
    parsingConfidence: resumeParsingConfidence({ name, email, phone, years: yearsMatch?.[1], skillsCount: skills.length }),
    persona: {
      type: "passive",
      openness: 0.65,
      enthusiasm: 0.58,
      availability: "60 days",
      compensationSensitivity: "medium",
      likelyObjections: ["Resume upload parsed from plain text only."],
    },
  });
}

export function resumeParsingConfidence(input: {
  name?: string;
  email?: string;
  phone?: string;
  years?: string;
  skillsCount: number;
}): number {
  let confidence = 28;
  if (input.name && input.name !== "Resume Candidate") confidence += 18;
  if (input.email) confidence += 18;
  if (input.phone) confidence += 12;
  if (input.years) confidence += 14;
  confidence += Math.min(18, input.skillsCount * 3);
  return Math.min(96, confidence);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function value(record: Map<string, string>, key: string): string {
  return record.get(normalizeHeader(key))?.trim() ?? "";
}

function splitList(valueToSplit: string): string[] {
  return valueToSplit
    .split(/[;|]/)
    .flatMap((part) => part.split(/,(?=\s*[A-Za-z])/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractLooseSkills(text: string): string[] {
  const known = ["Python", "FastAPI", "PostgreSQL", "Docker", "AWS", "GCP", "Azure", "Kubernetes", "LLM APIs", "RAG", "Vector Databases", "TypeScript"];
  const lower = text.toLowerCase();
  return known.filter((skill) => lower.includes(skill.toLowerCase()));
}

function detectLocation(text: string): string {
  const known = ["Bengaluru", "Bangalore", "Pune", "Hyderabad", "Mumbai", "Delhi", "Chennai", "Kochi", "Noida", "Gurugram", "India"];
  const found = known.find((place) => text.toLowerCase().includes(place.toLowerCase()));
  return found ? `${found}${found === "India" ? "" : ", India"}` : "Unknown";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
