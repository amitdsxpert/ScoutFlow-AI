import type { ExportPayload, RankedCandidate } from "./types";

export function toExportJson(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function rankedToCsv(rows: RankedCandidate[], roleTitle = "Active Role"): string {
  const headers = [
    "rank",
    "role",
    "global_candidate_id",
    "candidate_name",
    "title",
    "location",
    "years_experience",
    "match_score",
    "interest_score",
    "final_score",
    "recommendation",
    "risks",
    "next_action",
    "source",
  ];

  const body = rows.map((row) => [
    row.rank,
    roleTitle,
    row.candidate.globalCandidateId ?? row.candidate.id,
    row.candidate.name,
    row.candidate.currentTitle,
    row.candidate.location,
    row.candidate.yearsExperience,
    row.match.matchScore,
    row.interest.interestScore,
    row.finalScore,
    row.recommendation,
    row.match.risks.join("; "),
    row.interest.recommendedNextAction,
    row.candidate.source,
  ]);

  return [headers, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
}

export function candidatesToCsv(rows: ExportPayload["candidates"]): string {
  const headers = ["id", "global_candidate_id", "name", "title", "company", "location", "years_experience", "source", "skills", "summary"];
  const body = rows.map((candidate) => [
    candidate.id,
    candidate.globalCandidateId ?? candidate.id,
    candidate.name,
    candidate.currentTitle,
    candidate.currentCompany ?? "",
    candidate.location,
    candidate.yearsExperience,
    candidate.source,
    candidate.skills.join("; "),
    candidate.summary,
  ]);
  return [headers, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
