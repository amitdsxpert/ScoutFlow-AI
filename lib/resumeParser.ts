import type { CandidateProfile, PersonaType } from "./types";
import { ensureCandidateIdentifier } from "./identity";
import { makeId } from "./roles";
import { generateAgentText } from "./agents/llmClient";

export interface ResumeParseResult {
  success: boolean;
  candidate?: CandidateProfile;
  confidence: number;
  warnings: string[];
  rawText: string;
}

export interface ResumeFieldExtraction {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  location?: string;
  currentTitle?: string;
  currentCompany?: string;
  yearsExperience?: number;
  skills: string[];
  projects: string[];
  summary?: string;
}

const COMMON_SKILLS = [
  "javascript", "typescript", "python", "java", "go", "rust", "c++", "c#", "ruby", "php", "swift", "kotlin", "scala",
  "react", "angular", "vue", "nextjs", "nodejs", "express", "django", "flask", "fastapi", "spring",
  "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "jenkins", "github actions",
  "llm", "gpt", "gemini", "claude", "openai", "rag", "vector", "embeddings", "langchain", "llamaindex",
  "machine learning", "deep learning", "tensorflow", "pytorch", "scikit-learn", "nlp",
  "git", "linux", "bash", "sql", "rest", "graphql", "grpc", "microservices", "api",
  "agile", "scrum", "jira", "confluence", "figma", "design",
];

const SKILL_PATTERN = new RegExp(
  `\\b(${COMMON_SKILLS.map((skill) => skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);

export async function parseResumeFile(file: File): Promise<ResumeParseResult> {
  const warnings: string[] = [];
  let rawText = "";

  try {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      rawText = await parsePdf(file);
    } else if (file.name.toLowerCase().endsWith(".docx")) {
      rawText = await parseDocx(file);
    } else if (file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md")) {
      rawText = await file.text();
    } else {
      warnings.push(`Unsupported file type: ${file.name}`);
      return { success: false, confidence: 0, warnings, rawText: "" };
    }

    const baseline = extractFieldsFromText(rawText);
    const { extraction, usedLlm } = await enrichExtractionWithLlm(baseline, rawText);
    if (usedLlm) warnings.push("Enriched with LLM resume agent.");
    const confidence = calculateConfidence(extraction, rawText);

    const candidate = buildCandidateFromExtraction(extraction, file.name);

    return {
      success: true,
      candidate,
      confidence,
      warnings,
      rawText,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Failed to parse file");
    return { success: false, confidence: 0, warnings, rawText };
  }
}

export async function parseResumeFileBuffer(buffer: ArrayBuffer, filename: string): Promise<ResumeParseResult> {
  const warnings: string[] = [];
  let rawText = "";

  try {
    if (filename.toLowerCase().endsWith(".pdf")) {
      rawText = await parsePdfBuffer(buffer);
    } else if (filename.toLowerCase().endsWith(".docx")) {
      rawText = await parseDocxBuffer(buffer);
    } else if (filename.toLowerCase().endsWith(".txt") || filename.toLowerCase().endsWith(".md")) {
      const decoder = new TextDecoder();
      rawText = decoder.decode(buffer);
    } else {
      warnings.push(`Unsupported file type: ${filename}`);
      return { success: false, confidence: 0, warnings, rawText: "" };
    }

    const baseline = extractFieldsFromText(rawText);
    const { extraction, usedLlm } = await enrichExtractionWithLlm(baseline, rawText);
    if (usedLlm) warnings.push("Enriched with LLM resume agent.");
    const confidence = calculateConfidence(extraction, rawText);

    const candidate = buildCandidateFromExtraction(extraction, filename);

    return {
      success: true,
      candidate,
      confidence,
      warnings,
      rawText,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Failed to parse file");
    return { success: false, confidence: 0, warnings, rawText };
  }
}

async function parsePdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return parsePdfBuffer(arrayBuffer);
}

async function parsePdfBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    // Legacy build is required for Node.js (avoids DOMMatrix / Path2D browser-only globals).
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // Resolve worker source to an absolute file:// URL inside node_modules so the
    // fake-worker loader can import it. This avoids Turbopack rewriting the path.
    try {
      const { pathToFileURL } = await import("url");
      const path = await import("path");
      const workerPath = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch {
      // If we cannot resolve the worker, pdfjs will still attempt fake-worker setup.
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdfDoc = await loadingTask.promise;

    const textParts: string[] = [];
    const collectedUrls: string[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      // Reconstruct line breaks from item.transform Y coordinate so per-line regexes work.
      type PdfTextItem = { str?: string; transform?: number[]; hasEOL?: boolean };
      const items = textContent.items as PdfTextItem[];
      let prevY: number | undefined;
      const lineFragments: string[] = [];
      for (const item of items) {
        const text = typeof item.str === "string" ? item.str : "";
        const y = item.transform?.[5];
        if (prevY !== undefined && typeof y === "number" && Math.abs(y - prevY) > 2) {
          lineFragments.push("\n");
        } else if (lineFragments.length > 0) {
          lineFragments.push(" ");
        }
        lineFragments.push(text);
        if (item.hasEOL) lineFragments.push("\n");
        if (typeof y === "number") prevY = y;
      }
      textParts.push(lineFragments.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"));

      // Pull URLs out of link annotations (hyperlinks aren't part of the rendered text).
      try {
        const annotations = await page.getAnnotations();
        for (const annot of annotations as Array<{ subtype?: string; url?: string; unsafeUrl?: string }>) {
          const url = annot.url || annot.unsafeUrl;
          if (annot.subtype === "Link" && typeof url === "string" && url.trim()) {
            collectedUrls.push(url.trim());
          }
        }
      } catch {
        // Annotations are optional; ignore failures.
      }
    }

    let pageText = textParts.join("\n\n");
    if (collectedUrls.length) {
      // Append unique URLs so downstream regexes (linkedin.com, github.com, mailto:) can find them.
      const uniqueUrls = Array.from(new Set(collectedUrls));
      pageText += `\n\nLinks: ${uniqueUrls.join(" | ")}`;
    }
    return pageText;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : "Unknown error"}. Install pdfjs-dist for PDF support.`);
  }
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return parseDocxBuffer(arrayBuffer);
}

async function parseDocxBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    // mammoth expects { buffer: Buffer } in Node.js (not { arrayBuffer }).
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return result.value;
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error instanceof Error ? error.message : "Unknown error"}. Install mammoth for DOCX support.`);
  }
}

/**
 * Enriches a deterministic extraction with an LLM pass over the raw resume text.
 * Falls back gracefully on any provider error or invalid JSON.
 */
async function enrichExtractionWithLlm(
  baseline: ResumeFieldExtraction,
  rawText: string,
): Promise<{ extraction: ResumeFieldExtraction; usedLlm: boolean }> {
  const trimmedText = rawText.length > 12000 ? rawText.slice(0, 12000) : rawText;
  if (trimmedText.trim().length < 40) return { extraction: baseline, usedLlm: false };

  const fallbackJson = {
    name: baseline.name ?? "",
    email: baseline.email ?? "",
    phone: baseline.phone ?? "",
    linkedin: baseline.linkedin ?? "",
    location: baseline.location ?? "",
    currentTitle: baseline.currentTitle ?? "",
    currentCompany: baseline.currentCompany ?? "",
    yearsExperience: baseline.yearsExperience ?? 0,
    skills: baseline.skills,
    projects: baseline.projects,
    summary: baseline.summary ?? "",
  };

  const result = await generateAgentText({
    task: "Resume parsing - structured field extraction",
    jsonMode: true,
    systemPrompt: [
      "You are a resume parser. Extract structured fields from the raw resume text.",
      "Return STRICT JSON only, no markdown, no commentary.",
      "If a field cannot be found, return an empty string for strings, 0 for numbers, [] for arrays.",
      "Preserve the candidate's full job title verbatim, including separators like '|', '/', or '·'.",
    ].join(" "),
    userPrompt: [
      "JSON schema (all keys required):",
      "{",
      '  "name": string,',
      '  "email": string,',
      '  "phone": string,',
      '  "linkedin": string (URL or path like linkedin.com/in/...),',
      '  "location": string (city, state/country),',
      '  "currentTitle": string (full current role title verbatim, e.g. "Applied AI / LLM Engineer | Agentic Systems | MLOps"),',
      '  "currentCompany": string,',
      '  "yearsExperience": number (0 if not stated),',
      '  "skills": string[] (deduplicated tools, languages, frameworks),',
      '  "projects": string[] (short project names or bullets, max 5),',
      '  "summary": string (2-3 sentence professional summary)',
      "}",
      "",
      "Resume text:",
      trimmedText,
    ].join("\n"),
    fallbackJson,
  });

  if (!result.ok || !result.json || typeof result.json !== "object" || result.usedFallback) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[resumeParser] LLM enrichment unavailable:",
        result.error?.slice(0, 200) ?? "no error message",
      );
    }
    return { extraction: baseline, usedLlm: false };
  }

  const parsed = result.json as Record<string, unknown>;
  const stringField = (key: string): string | undefined => {
    const value = parsed[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const arrayField = (key: string): string[] => {
    const value = parsed[key];
    if (!Array.isArray(value)) return [];
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  };
  const numberField = (key: string): number | undefined => {
    const value = parsed[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return undefined;
  };

  // Merge: LLM overrides baseline whenever it returned a non-empty value, so we capture
  // multi-segment titles and contact links the deterministic regex misses. Fall back to
  // baseline values otherwise so we never lose data.
  const llmSkills = arrayField("skills");
  const llmProjects = arrayField("projects");
  const merged: ResumeFieldExtraction = {
    name: stringField("name") ?? baseline.name,
    email: stringField("email") ?? baseline.email,
    phone: stringField("phone") ?? baseline.phone,
    linkedin: stringField("linkedin") ?? baseline.linkedin,
    location: stringField("location") ?? baseline.location,
    currentTitle: stringField("currentTitle") ?? baseline.currentTitle,
    currentCompany: stringField("currentCompany") ?? baseline.currentCompany,
    yearsExperience: numberField("yearsExperience") ?? baseline.yearsExperience,
    skills: dedupePreserveOrder([...llmSkills, ...baseline.skills]).slice(0, 30),
    projects: llmProjects.length ? llmProjects.slice(0, 5) : baseline.projects,
    summary: stringField("summary") ?? baseline.summary,
  };

  return { extraction: merged, usedLlm: true };
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.trim());
  }
  return result;
}

function extractFieldsFromText(text: string): ResumeFieldExtraction {
  // Normalize line whitespace but PRESERVE line breaks so per-line regexes still work.
  const lineBased = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  const normalized = lineBased.replace(/\s+/g, " ").trim();

  const name = extractName(lineBased);
  const email = extractEmail(normalized);
  const phone = extractPhone(normalized);
  const linkedin = extractLinkedIn(normalized);
  const location = extractLocation(lineBased, normalized);
  const { currentTitle, currentCompany } = extractTitleAndCompany(lineBased);
  const yearsExperience = extractYearsExperience(normalized);
  const skills = extractSkills(lineBased);
  const projects = extractProjects(lineBased);
  const summary = extractSummary(lineBased);

  return {
    name,
    email,
    phone,
    linkedin,
    location,
    currentTitle,
    currentCompany,
    yearsExperience,
    skills,
    projects,
    summary,
  };
}

function extractName(text: string): string | undefined {
  const labeled = text.match(/(?:^|\n)\s*(?:Name|Candidate|Full\s*Name)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i);
  if (labeled) return labeled[1].trim();

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    // Skip lines with obvious non-name content
    if (/[@:|/]/.test(line)) continue;
    if (/\d/.test(line)) continue;
    if (line.length > 60) continue;
    // Skip section headers / titles that contain role keywords
    if (new RegExp(`\\b(${ROLE_KEYWORDS.join("|")}|Resume|CV|Curriculum)\\b`, "i").test(line)) continue;
    // Match 2-4 capitalised words; allow uppercase-first letters.
    if (/^([A-Z][a-zA-Z'.-]+\s+){1,3}[A-Z][a-zA-Z'.-]+$/.test(line)) {
      return line;
    }
  }
  return undefined;
}

function extractEmail(text: string): string | undefined {
  // Try mailto: hyperlinks first (these come from annotations).
  const mailto = text.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (mailto) return mailto[1].toLowerCase();
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : undefined;
}

function extractPhone(text: string): string | undefined {
  // tel: hyperlinks first (most reliable).
  const tel = text.match(/tel:(\+?[\d .()-]{8,})/i);
  if (tel) {
    const cleaned = tel[1].replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/^\+/, "");
    if (digits.length >= 8 && digits.length <= 15) return cleaned;
  }
  const formatted = text.match(/(?:\+?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)|\d{2,4})[ .-]?\d{2,4}[ .-]?\d{3,5}(?:[ .-]?\d{2,4})?/);
  if (formatted) {
    const cleaned = formatted[0].replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/^\+/, "");
    if (digits.length >= 10 && digits.length <= 15) {
      return cleaned.startsWith("+") ? cleaned : (digits.length === 10 ? cleaned : `+${cleaned}`);
    }
  }
  return undefined;
}

function extractLinkedIn(text: string): string | undefined {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_-]+\/?/i);
  return m ? m[0].replace(/^https?:\/\//i, "").replace(/\/$/, "") : undefined;
}

function extractLocation(lineBased: string, _normalized: string): string | undefined {
  // Prefer explicit labels.
  const labeled = lineBased.match(/(?:^|\n)\s*(?:Location|Address|City|Based(?:\s+in)?|Living\s+in|Located\s+in)\s*[:\-]\s*([A-Za-z][A-Za-z .,'-]{2,60})/i);
  if (labeled) return cleanLocation(labeled[1]);

  const lines = lineBased.split("\n");
  // Look for "City, ST" or "City, Country" anywhere in the document - including inside
  // bullet/pipe-separated lines like "Acme Corp · San Francisco, CA · Hybrid".
  for (const rawLine of lines.slice(0, 20)) {
    const line = rawLine.trim();
    if (!line || line.length > 200) continue;
    if (/@|\bhttp|linkedin/i.test(line)) continue;
    // Try splitting by common separators and inspect each segment.
    const segments = line.split(/\s*[·•|]\s*/);
    for (const segment of segments) {
      const seg = segment.trim();
      if (!seg) continue;
      // City, ST  (e.g. "San Francisco, CA")
      const m1 = seg.match(/^([A-Z][A-Za-z .'-]{1,40},\s*(?:[A-Z]{2,3}|[A-Z][A-Za-z .'-]+))$/);
      if (m1) return cleanLocation(m1[1]);
    }
  }

  // Country fallback (only on a short line)
  const countryLine = lines.find((line) => /^[A-Z][A-Za-z .,'-]{2,40}$/.test(line.trim()) && /\b(India|USA|United States|UK|United Kingdom|Canada|Australia|Germany|France|Singapore|Ireland|Netherlands)\b/i.test(line));
  if (countryLine) return cleanLocation(countryLine.trim());

  return undefined;
}

function cleanLocation(value: string): string {
  return value.replace(/[•|]/g, "").replace(/\s{2,}/g, " ").trim().replace(/[,\s]+$/, "");
}

const SENIORITIES = ["Senior", "Sr\\.?", "Junior", "Jr\\.?", "Lead", "Staff", "Principal", "Head", "Chief"];
const ROLE_KEYWORDS = ["Engineer", "Developer", "Manager", "Architect", "Analyst", "Designer", "Scientist", "Consultant", "Lead", "Director"];

function extractTitleAndCompany(lineBased: string): { currentTitle?: string; currentCompany?: string } {
  // Prefer label-based extraction first.
  const labeledTitle = lineBased.match(/(?:^|\n)\s*(?:Title|Role|Position|Designation|Current\s*Role)\s*[:\-]\s*([^\n]+)/i);
  const labeledCompany = lineBased.match(/(?:^|\n)\s*(?:Company|Employer|Organization|Current\s*Company)\s*[:\-]\s*([^\n]+)/i);

  const lines = lineBased.split("\n").map((l) => l.trim()).filter(Boolean);
  const roleRe = new RegExp(`\\b(?:${ROLE_KEYWORDS.join("|")})\\b`, "i");

  // Find the first line that looks like a job title (contains a role keyword and
  // not too long). Multi-segment titles like
  //   "Applied AI / LLM Engineer | Agentic Systems | MLOps"
  // are kept verbatim because we capture the entire matching line.
  let titleLine: string | undefined;
  for (const line of lines.slice(0, 20)) {
    if (line.includes("@") || /\d{3}/.test(line)) continue;
    if (/^(Skills?|Experience|Education|Summary|Profile|Projects?|Certifications?|Languages?|About|Tools?|Technologies)\s*[:\-]?$/i.test(line)) continue;
    if (line.length > 120) continue;
    if (roleRe.test(line)) {
      titleLine = line;
      break;
    }
  }

  let currentTitle: string | undefined;
  let currentCompany: string | undefined;

  if (titleLine) {
    // Split on " at "/"@"/" with "/" for " — extract company portion if present.
    const atSplit = titleLine.split(/\s+(?:at|@|with|for)\s+/i);
    if (atSplit.length >= 2) {
      currentTitle = cleanInline(atSplit[0]);
      currentCompany = cleanInline(atSplit.slice(1).join(" at "));
    } else {
      currentTitle = cleanInline(titleLine);
    }
  }

  // Look for a "Company · Location" style line below the title (common in modern resumes).
  if (!currentCompany && titleLine) {
    const titleIndex = lines.indexOf(titleLine);
    const next = lines[titleIndex + 1];
    if (next && /[·•|]/.test(next) && !next.includes("@") && !/\d{3}/.test(next)) {
      const firstSegment = next.split(/[·•|]/)[0].trim();
      if (firstSegment && firstSegment.length < 60 && !roleRe.test(firstSegment)) {
        currentCompany = firstSegment;
      }
    }
  }

  if (labeledTitle) currentTitle = cleanInline(labeledTitle[1]);
  if (labeledCompany) currentCompany = cleanInline(labeledCompany[1]);

  // Strip trailing section words like "Skills" / "Experience" that bleed in from greedy matches.
  if (currentCompany) {
    currentCompany = currentCompany
      .replace(/\b(Skills?|Experience|Education|Summary|Profile|Projects?|Certifications?|Languages?|About|Tools?|Technologies)\b.*$/i, "")
      .replace(/[,\s]+$/, "")
      .trim();
    if (!currentCompany || /^(Skills?|Experience|Education|Summary|Profile|Projects?)$/i.test(currentCompany)) {
      currentCompany = undefined;
    }
  }

  return { currentTitle, currentCompany };
}

function cleanInline(value: string): string {
  // Keep " | " separators (commonly used in multi-segment titles); just normalise whitespace and bullets.
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*•\s*/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .trim()
    .replace(/[,\s|]+$/, "")
    .replace(/^[,\s|]+/, "");
}

function extractYearsExperience(text: string): number {
  const patterns = [
    /(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/i,
    /(?:experience|exp)[:\s]*(\d+)\+?\s*years?/i,
    /(\d+)\+?\s*(?:yrs|years)\s*(?:experience|exp)/i,
    /total\s*(?:experience|exp)[:\s]*(\d+)/i,
    /over\s*(\d+)\s*years?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const years = parseInt(match[1], 10);
      if (years > 0 && years < 50) return years;
    }
  }

  const sections = text.split(/\n\n|\n-\n/);
  for (const section of sections.slice(0, 5)) {
    const yearMatch = section.match(/20\d{2}|19\d{2}/g);
    if (yearMatch && yearMatch.length >= 2) {
      const years = Math.max(...yearMatch.map((y) => 2026 - parseInt(y, 10))) - Math.min(...yearMatch.map((y) => 2026 - parseInt(y, 10)));
      if (years > 0 && years < 40) return years;
    }
  }

  return 0;
}

function extractSkills(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  // Whole-document scan with the precompiled known-skills regex.
  const allMatches = lower.match(SKILL_PATTERN);
  if (allMatches) allMatches.forEach((skill) => found.add(skill.trim()));

  // Inside an explicit skills section, also accept any comma/bullet-separated tokens.
  const sectionMatch = text.match(/(?:^|\n)\s*(?:skills|technical\s*skills|technologies|tech\s*stack|expertise|competencies|tools)\s*[:\-]?\s*\n?([\s\S]+?)(?:\n\s*\n|\n[A-Z][a-z]+\s*[:\n]|$)/i);
  if (sectionMatch) {
    const tokens = sectionMatch[1]
      .split(/[,;|•\n\u2022]+/)
      .map((token) => token.replace(/^[\s\-•*●]+/, "").trim().toLowerCase())
      .filter((token) => token && token.length <= 30 && /[a-z]/.test(token));
    tokens.forEach((token) => {
      // Keep known skills directly.
      if (COMMON_SKILLS.includes(token)) {
        found.add(token);
        return;
      }
      // Keep multi-word tokens that contain a known skill (e.g. "node.js", "react native").
      const hit = COMMON_SKILLS.find((skill) => token.includes(skill));
      if (hit) found.add(hit);
    });
  }

  return Array.from(found).slice(0, 25);
}

function extractProjects(text: string): string[] {
  const projects: string[] = [];

  const projectSection = text.match(/(?:projects?|portfolio|work|achievements)[:\s]*(.+?)(?:\n\n[A-Z]|\n\s*\n|$)/is);
  if (projectSection) {
    const projectLines = projectSection[1].split(/\n(?=[A-Z])|\n\n/).slice(0, 5);
    projectLines.forEach((line) => {
      const trimmed = line.trim().replace(/^[-•*]\s*/, "");
      if (trimmed.length > 10 && trimmed.length < 150) {
        projects.push(trimmed);
      }
    });
  }

  return projects.slice(0, 5);
}

function extractSummary(text: string): string | undefined {
  const patterns = [
    /(?:summary|profile|objective|about)[:\s]*(.+?)(?:\n\n|\n[A-Z]|$)/is,
    /^([A-Z][^\n]{50,200}(?:\n[A-Z][^\n]{50,200})?)/m,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const summary = match[1].replace(/\n+/g, " ").trim();
      if (summary.length > 50 && summary.length < 500) {
        return summary;
      }
    }
  }

  return undefined;
}

function calculateConfidence(extraction: ResumeFieldExtraction, rawText: string): number {
  let score = 40;

  if (extraction.name) score += 10;
  if (extraction.email) score += 10;
  if (extraction.phone) score += 5;
  if (extraction.currentTitle) score += 10;
  if ((extraction.yearsExperience ?? 0) > 0) score += 5;
  if (extraction.skills.length >= 5) score += 10;
  if (extraction.skills.length >= 10) score += 5;
  if (extraction.summary) score += 5;

  const hasContact = extraction.email || extraction.phone;
  if (hasContact && extraction.currentTitle) score += 5;

  const minExpectedLength = 100;
  if (rawText.length < minExpectedLength) score -= 20;
  else if (rawText.length > 500) score += 5;

  return Math.max(10, Math.min(98, score));
}

function buildCandidateFromExtraction(
  extraction: ResumeFieldExtraction,
  filename: string
): CandidateProfile {
  const name = extraction.name || filename.replace(/\.(pdf|docx|txt|md)$/i, "").replace(/[-_]/g, " ");

  const personaType = determinePersonaType(extraction);

  return ensureCandidateIdentifier({
    id: makeId("candidate"),
    name,
    email: extraction.email,
    phone: extraction.phone,
    linkedin: extraction.linkedin,
    location: extraction.location || "Location not specified",
    currentTitle: extraction.currentTitle || "Title not specified",
    currentCompany: extraction.currentCompany,
    yearsExperience: extraction.yearsExperience || 0,
    skills: extraction.skills,
    projects: extraction.projects,
    summary: extraction.summary || "",
    source: "resume_upload",
    addedAt: new Date().toISOString(),
    status: "new",
    parsingConfidence: calculateConfidence(extraction, ""),
    persona: {
      type: personaType,
      openness: 65,
      enthusiasm: 50,
      availability: determineAvailability(extraction),
      compensationSensitivity: "medium",
      likelyObjections: [],
    },
  });
}

function determinePersonaType(extraction: ResumeFieldExtraction): PersonaType {
  const summary = (extraction.summary || "").toLowerCase();
  const title = (extraction.currentTitle || "").toLowerCase();
  const combined = summary + " " + title;

  if (combined.includes("open to") || combined.includes("actively seeking") || combined.includes("available immediately")) {
    return "available_immediately";
  }
  if (combined.includes("remote only") || combined.includes("remote only")) {
    return "remote_only";
  }
  if (combined.includes("not interested") || combined.includes("not looking")) {
    return "not_interested";
  }
  if (extraction.skills.some((s) => ["llm", "rag", "genai", "machine learning", "ai"].includes(s.toLowerCase()))) {
    return "highly_interested";
  }

  return "passive";
}

function determineAvailability(extraction: ResumeFieldExtraction): string {
  const summary = (extraction.summary || "").toLowerCase();
  if (summary.includes("immediate") || summary.includes("available now")) return "Immediate";
  if (summary.includes("15 days") || summary.includes("2 weeks")) return "15";
  if (summary.includes("30 days") || summary.includes("1 month") || summary.includes("notice")) return "30";
  if (summary.includes("45 days") || summary.includes("6 weeks")) return "45";
  if (summary.includes("60 days") || summary.includes("2 months")) return "60";
  if (summary.includes("90 days") || summary.includes("3 months")) return "90";

  return "30";
}

export async function batchParseResumes(files: File[]): Promise<ResumeParseResult[]> {
  return Promise.all(files.map((file) => parseResumeFile(file)));
}

export function getSupportedResumeExtensions(): string[] {
  return [".pdf", ".docx", ".txt", ".md"];
}

export function isResumeFileSupported(filename: string): boolean {
  return getSupportedResumeExtensions().some((ext) => filename.toLowerCase().endsWith(ext));
}