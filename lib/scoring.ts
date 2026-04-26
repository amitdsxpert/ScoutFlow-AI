import type { CandidateProfile, MatchResult, ParsedJD } from "./types";
import { domainKeywords, normalizeSkill, normalizeSkillSet, normalizeText } from "./jd";

export function scoreCandidate(candidate: CandidateProfile, jd: ParsedJD, roleId?: string): MatchResult {
  const haystack = candidateHaystack(candidate);
  const candidateSkills = normalizeSkillSet([
    ...candidate.skills,
    ...candidate.projects.flatMap((project) => project.split(/[,\s/]+/)),
    ...candidate.summary.split(/[,\s/]+/),
  ]);

  const requiredSkills = normalizeSkillSet(jd.requiredSkills);
  const preferredSkills = normalizeSkillSet(jd.preferredSkills);
  const matchedRequired = requiredSkills.filter((skill) => hasSkill(skill, candidateSkills, haystack));
  const matchedPreferred = preferredSkills.filter((skill) => hasSkill(skill, candidateSkills, haystack));
  const missingSkills = requiredSkills.filter((skill) => !matchedRequired.includes(skill));

  const requiredSkillScore = percentage(matchedRequired.length, requiredSkills.length);
  const preferredSkillScore = percentage(matchedPreferred.length, preferredSkills.length);
  const experienceScore = scoreExperience(candidate.yearsExperience, jd.minYearsExperience);
  const domainScore = scoreDomain(candidate, jd);
  const locationScore = scoreLocation(candidate, jd);
  const riskScore = scoreRisk(candidate, jd, missingSkills, locationScore);

  const weights = jd.scoringWeights;
  const matchScore = Math.round(
    requiredSkillScore * weights.requiredSkills +
      experienceScore * weights.experience +
      preferredSkillScore * weights.preferredSkills +
      domainScore * weights.domain +
      locationScore * weights.location +
      riskScore * weights.riskAdjustment,
  );

  const risks = generateRisks(candidate, jd, missingSkills, locationScore);
  const matchedSkills = Array.from(new Set([...matchedRequired, ...matchedPreferred])).sort();

  return {
    roleId,
    candidateId: candidate.id,
    matchScore: clamp(matchScore),
    breakdown: {
      requiredSkills: Math.round(requiredSkillScore),
      experience: Math.round(experienceScore),
      preferredSkills: Math.round(preferredSkillScore),
      domain: Math.round(domainScore),
      location: Math.round(locationScore),
      riskAdjustment: Math.round(riskScore),
    },
    matchedSkills,
    matchedRequiredSkills: matchedRequired,
    matchedPreferredSkills: matchedPreferred,
    missingSkills,
    explanation: buildExplanation(candidate, jd, matchedRequired, matchedPreferred, missingSkills, matchScore, risks, locationScore),
    risks,
    recruiterQuestions: buildRecruiterQuestions(candidate, jd, missingSkills, risks),
    confidence: calculateConfidence(candidate, jd, matchedSkills),
    scoreBand: getScoreBand(matchScore),
    experienceFit: describeExperienceFit(candidate, jd),
    locationFit: describeLocationFit(candidate, jd, locationScore),
    domainRelevance: describeDomainRelevance(domainScore),
  };
}

export function scoreCandidates(candidates: CandidateProfile[], jd: ParsedJD | null, roleId?: string): MatchResult[] {
  if (!jd) return [];
  return candidates.map((candidate) => scoreCandidate(candidate, jd, roleId));
}

function candidateHaystack(candidate: CandidateProfile): string {
  return normalizeText([
    candidate.currentTitle,
    candidate.currentCompany,
    candidate.location,
    candidate.skills.join(" "),
    candidate.projects.join(" "),
    candidate.summary,
  ].filter(Boolean).join(" "));
}

function hasSkill(skill: string, candidateSkills: string[], haystack: string): boolean {
  const normalized = normalizeSkill(skill);
  if (candidateSkills.includes(normalized)) return true;
  if (normalized === "cloud") {
    return ["aws", "gcp", "azure", "kubernetes"].some((cloudSkill) => candidateSkills.includes(cloudSkill) || haystack.includes(cloudSkill));
  }
  if (normalized === "llm apis") {
    return haystack.includes("llm") || haystack.includes("openai") || haystack.includes("large language models");
  }
  if (normalized === "retrieval augmented generation") {
    return haystack.includes("rag") || haystack.includes("retrieval augmented generation");
  }
  return haystack.includes(normalized);
}

function percentage(matched: number, total: number): number {
  if (total <= 0) return 100;
  return (matched / total) * 100;
}

function scoreExperience(years: number, minimum: number): number {
  if (years >= minimum) return 100;
  if (years >= minimum - 1) return 82;
  if (years >= minimum - 2) return 64;
  return Math.max(20, Math.round((years / Math.max(1, minimum)) * 55));
}

function scoreDomain(candidate: CandidateProfile, jd: ParsedJD): number {
  const candidateText = candidateHaystack(candidate);
  const jdText = normalizeText(jd.rawText);
  const relevant = domainKeywords.filter((keyword) => jdText.includes(normalizeText(keyword)) || candidateText.includes(normalizeText(keyword)));
  const matched = relevant.filter((keyword) => candidateText.includes(normalizeText(keyword)));
  return percentage(matched.length, Math.max(5, relevant.length));
}

function scoreLocation(candidate: CandidateProfile, jd: ParsedJD): number {
  const location = normalizeText(candidate.location);
  const roleLocation = normalizeText(jd.location);

  if (jd.workMode === "remote") {
    if (location.includes("india") || roleLocation.includes("remote")) return 100;
    if (candidate.persona.type === "remote_only") return 88;
    return 62;
  }

  if (jd.workMode === "unknown") {
    return location.includes("india") ? 82 : 60;
  }

  if (roleLocation !== "not specified" && location.includes(roleLocation.replace("india", "").trim())) return 100;
  if (location.includes("india") && jd.workMode === "hybrid") return 70;
  return 38;
}

function scoreRisk(candidate: CandidateProfile, jd: ParsedJD, missingSkills: string[], locationScore: number): number {
  let riskScore = 100;
  const coreMissing = missingSkills.filter((skill) => ["python", "fastapi", "postgresql", "docker", "llm apis"].includes(skill)).length;

  riskScore -= coreMissing * 9;
  if (candidate.yearsExperience < jd.minYearsExperience) riskScore -= 18;
  if (candidate.yearsExperience < jd.minYearsExperience - 2) riskScore -= 15;
  if (locationScore < 60) riskScore -= 18;
  if (candidate.persona.compensationSensitivity === "high") riskScore -= 8;
  if (candidate.persona.availability.toLowerCase().includes("90")) riskScore -= 9;
  if (candidate.persona.type === "not_interested") riskScore -= 12;
  if (candidate.persona.type === "remote_only" && jd.workMode !== "remote") riskScore -= 20;

  return clamp(riskScore);
}

function generateRisks(candidate: CandidateProfile, jd: ParsedJD, missingSkills: string[], locationScore: number): string[] {
  const risks = new Set<string>();

  if (missingSkills.length > 0) {
    risks.add(`Missing or unproven: ${missingSkills.slice(0, 4).join(", ")}.`);
  }
  if (candidate.yearsExperience < jd.minYearsExperience) {
    risks.add(`Experience is ${candidate.yearsExperience} years versus ${jd.minYearsExperience}+ target.`);
  }
  if (locationScore < 70) {
    risks.add("Location or work-mode fit needs validation.");
  }
  if (candidate.persona.compensationSensitivity === "high") {
    risks.add("High compensation sensitivity.");
  }
  if (candidate.persona.availability.toLowerCase().includes("90")) {
    risks.add("Long notice period.");
  }
  if (candidate.persona.type === "not_interested") {
    risks.add("Low current openness to a move.");
  }
  for (const objection of candidate.persona.likelyObjections.slice(0, 2)) {
    risks.add(objection);
  }

  return Array.from(risks).slice(0, 5);
}

function buildExplanation(
  candidate: CandidateProfile,
  jd: ParsedJD,
  matchedRequired: string[],
  matchedPreferred: string[],
  missingSkills: string[],
  score: number,
  risks: string[],
  locationScore: number,
): string {
  const band = getScoreBand(score).toLowerCase();
  const requiredText = matchedRequired.length ? matchedRequired.slice(0, 6).join(", ") : "limited required skill evidence";
  const preferredText = matchedPreferred.length ? ` Preferred overlap includes ${matchedPreferred.slice(0, 4).join(", ")}.` : "";
  const missingText = missingSkills.length
    ? ` Main gap: ${missingSkills.slice(0, 3).join(", ")} ${missingSkills.length === 1 ? "is" : "are"} not explicit.`
    : " Required skill coverage is strong.";
  const locationText = locationScore >= 85 ? "The profile is work-mode compatible." : "Work-mode or location fit needs validation.";
  const riskText = risks.length ? ` Risk flag: ${risks[0]}` : " No major risk is obvious from the profile.";

  return `${candidate.name} is a ${band} for ${jd.roleTitle} because they bring ${candidate.yearsExperience} years of experience and evidence of ${requiredText}. They match ${matchedRequired.length} of ${Math.max(1, jd.requiredSkills.length)} required skills.${preferredText} ${locationText} ${missingText} ${riskText}`;
}

function buildRecruiterQuestions(candidate: CandidateProfile, jd: ParsedJD, missingSkills: string[], risks: string[]): string[] {
  const questions = new Set<string>();

  if (missingSkills.length > 0) {
    questions.add(`Can you share hands-on examples with ${missingSkills.slice(0, 2).join(" and ")}?`);
  }
  if (candidate.yearsExperience < jd.minYearsExperience) {
    questions.add("Which production services have you owned independently end to end?");
  }
  if (risks.some((risk) => risk.toLowerCase().includes("compensation"))) {
    questions.add("What compensation range would make this move worthwhile?");
  }
  if (risks.some((risk) => risk.toLowerCase().includes("remote") || risk.toLowerCase().includes("location"))) {
    questions.add(`Are you comfortable with the ${jd.workMode} work mode and ${jd.location} location expectation?`);
  }
  if (risks.some((risk) => risk.toLowerCase().includes("notice"))) {
    questions.add("What is your realistic earliest joining date?");
  }

  questions.add("What type of GenAI platform work would be most motivating for you?");
  return Array.from(questions).slice(0, 4);
}

function calculateConfidence(candidate: CandidateProfile, jd: ParsedJD, matchedSkills: string[]): number {
  let confidence = 58;
  confidence += Math.min(22, matchedSkills.length * 3);
  if (candidate.summary.length > 120) confidence += 6;
  if (candidate.projects.length >= 2) confidence += 6;
  if (jd.qualityScore >= 80) confidence += 8;
  return clamp(confidence);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getScoreBand(score: number): MatchResult["scoreBand"] {
  if (score >= 90) return "Excellent Match";
  if (score >= 75) return "Strong Match";
  if (score >= 60) return "Partial Match";
  if (score >= 40) return "Weak Match";
  return "Not Recommended";
}

function describeExperienceFit(candidate: CandidateProfile, jd: ParsedJD): string {
  if (candidate.yearsExperience >= jd.minYearsExperience) {
    return `${candidate.yearsExperience} years meets the ${jd.minYearsExperience}+ target.`;
  }
  if (candidate.yearsExperience >= jd.minYearsExperience - 2) {
    return `${candidate.yearsExperience} years is close to the ${jd.minYearsExperience}+ target; verify seniority depth.`;
  }
  return `${candidate.yearsExperience} years is below the ${jd.minYearsExperience}+ target.`;
}

function describeLocationFit(candidate: CandidateProfile, jd: ParsedJD, locationScore: number): string {
  if (locationScore >= 90) return `${candidate.location} is aligned with ${jd.location} and ${jd.workMode} work.`;
  if (locationScore >= 65) return `${candidate.location} is plausible for ${jd.location}; recruiter should confirm constraints.`;
  return `${candidate.location} may not fit ${jd.location} or ${jd.workMode} requirements.`;
}

function describeDomainRelevance(domainScore: number): string {
  if (domainScore >= 80) return "Strong domain relevance across backend, platform, cloud, and GenAI signals.";
  if (domainScore >= 60) return "Moderate domain relevance with some platform or AI signals to verify.";
  return "Limited domain overlap; validate whether experience transfers to this role.";
}
