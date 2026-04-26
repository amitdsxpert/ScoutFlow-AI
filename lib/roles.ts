import { DEFAULT_SAMPLE_JD, sampleParsedJD } from "./demoData";
import { ensureRoleIdentifiers } from "./identity";
import { parseJD } from "./jd";
import type { MatchResult, ParsedJD, RolePipeline, RoleStatus } from "./types";

export function createRolePipeline(rawJD: string, status: RoleStatus = "active"): RolePipeline {
  const parsedJD = parseJD(rawJD);
  return roleFromParsedJD(parsedJD, rawJD, status);
}

export function roleFromParsedJD(parsedJD: ParsedJD, rawJD = parsedJD.rawText, status: RoleStatus = "active"): RolePipeline {
  const now = new Date().toISOString();
  return {
    id: makeId("role"),
    jdId: makeId("jd"),
    jobId: makeId("job"),
    roleTitle: parsedJD.roleTitle,
    rawJD,
    parsedJD,
    createdAt: now,
    updatedAt: now,
    status,
    candidateMatches: [],
    outreachCampaigns: [],
    shortlist: [],
  };
}

export function defaultRolePipeline(): RolePipeline {
  return ensureRoleIdentifiers({
    ...roleFromParsedJD(sampleParsedJD, DEFAULT_SAMPLE_JD, "active"),
    id: "role-senior-backend-genai-platform",
  });
}

export function updateRoleWithJD(role: RolePipeline, rawJD: string, status: RoleStatus = role.status): RolePipeline {
  const parsedJD = parseJD(rawJD);
  return {
    ...role,
    rawJD,
    parsedJD,
    roleTitle: parsedJD.roleTitle,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export function updateRoleMatches(role: RolePipeline, matches: MatchResult[]): RolePipeline {
  return {
    ...role,
    candidateMatches: matches,
    updatedAt: new Date().toISOString(),
  };
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
