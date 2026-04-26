import type { CandidateProfile, RolePipeline } from "./types";

export function ensureRoleIdentifiers(role: RolePipeline): RolePipeline {
  return {
    ...role,
    jdId: role.jdId || makeStableId("jd", `${role.id}:jd`),
    jobId: role.jobId || makeStableId("job", `${role.id}:job`),
  };
}

export function ensureCandidateIdentifier<T extends CandidateProfile>(candidate: T): T {
  return {
    ...candidate,
    globalCandidateId: candidate.globalCandidateId || globalCandidateIdFor(candidate),
  };
}

export function globalCandidateIdFor(candidate: Pick<CandidateProfile, "id" | "name" | "email" | "phone" | "location" | "currentCompany">): string {
  const seed = candidate.email || candidate.phone || `${candidate.name}:${candidate.currentCompany || ""}:${candidate.location}` || candidate.id;
  return makeStableId("cand", seed);
}

export function makeStableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36).padStart(7, "0")}`;
}
