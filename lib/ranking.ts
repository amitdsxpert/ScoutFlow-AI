import type { CandidateProfile, InterestResult, MatchResult, RankedCandidate } from "./types";

export function rankCandidates(
  candidates: CandidateProfile[],
  matches: MatchResult[],
  interests: InterestResult[],
  roleId?: string,
): RankedCandidate[] {
  const scopedMatches = roleId ? matches.filter((match) => match.roleId === roleId || !match.roleId) : matches;
  const scopedInterests = roleId ? interests.filter((interest) => interest.roleId === roleId || !interest.roleId) : interests;
  const matchById = new Map(scopedMatches.map((match) => [match.candidateId, match]));
  const interestById = new Map(scopedInterests.map((interest) => [interest.candidateId, interest]));
  const scored: Array<Omit<RankedCandidate, "rank">> = [];

  candidates.forEach((candidate) => {
    const match = matchById.get(candidate.id);
    const interest = interestById.get(candidate.id);
    if (!match || !interest) return;

    const finalScore = Math.round(match.matchScore * 0.65 + interest.interestScore * 0.35);
    scored.push({
      roleId,
      candidate,
      match,
      interest,
      finalScore,
      recommendation: recommendationFor(finalScore),
    });
  });

  return scored
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function recommendationFor(finalScore: number): string {
  if (finalScore >= 85) return "Schedule recruiter call";
  if (finalScore >= 75) return "Strong backup / follow up";
  if (finalScore >= 60) return "Nurture or verify gaps";
  return "Low priority";
}
