import type { CandidateProfile, Channel, MatchResult, OutreachTone, ParsedJD } from "./types";

const toneOpeners: Record<OutreachTone, string> = {
  professional: "I came across your background and wanted to reach out with a relevant opportunity.",
  friendly: "Your work caught my eye, and I thought this role might be worth a quick chat.",
  technical: "Your backend and platform experience maps well to a technically deep GenAI role.",
  startup: "We are building quickly and your mix of ownership and backend depth looks highly relevant.",
  executive: "Your experience appears aligned with a high-impact platform mandate we are hiring for.",
  warm_referral: "Your profile was surfaced as a strong fit, and I wanted to reach out with a thoughtful note.",
};

export function generateOutreachMessage(
  candidate: CandidateProfile,
  jd: ParsedJD,
  match: MatchResult | undefined,
  channel: Channel,
  tone: OutreachTone,
): string {
  const matched = match?.matchedSkills.slice(0, 4).join(", ") || candidate.skills.slice(0, 4).join(", ");
  const project = candidate.projects[0] ?? candidate.summary;
  const opener = toneOpeners[tone];

  if (channel === "email") {
    return `Subject: ${jd.roleTitle} opportunity at ScoutFlow

Hi ${candidate.name.split(" ")[0]},

${opener} We are hiring for ${jd.roleTitle}, focused on backend services for a GenAI platform.

What stood out: ${matched}. Your work on ${project} feels especially relevant to the problems this team is solving.

Would you be open to a 20-minute recruiter conversation this week to compare the role with what you want next?

Best,
ScoutFlow Recruiting`;
  }

  if (channel === "whatsapp") {
    return `Hi ${candidate.name.split(" ")[0]}, quick note from ScoutFlow Recruiting. Your ${matched} experience looks relevant for our ${jd.roleTitle} role building GenAI platform backend services. Open to a quick chat this week?`;
  }

  if (channel === "linkedin") {
    return `Hi ${candidate.name.split(" ")[0]} - your ${matched} background stood out for a ${jd.roleTitle} role focused on GenAI platform services. Would you be open to a brief chat this week?`;
  }

  if (channel === "sms") {
    return `ScoutFlow: Hi ${candidate.name.split(" ")[0]}, your backend/GenAI profile fits our ${jd.roleTitle} role. Open to a quick recruiter call?`;
  }

  return generatePhoneOpening(candidate, jd, match);
}

export function generatePhoneOpening(candidate: CandidateProfile, jd: ParsedJD, match?: MatchResult): string {
  const matched = match?.matchedSkills.slice(0, 3).join(", ") || candidate.skills.slice(0, 3).join(", ");

  return `Call objective: Confirm interest, fit, work-mode comfort, and next-step readiness for ${jd.roleTitle}.

Opening script:
Hi ${candidate.name.split(" ")[0]}, this is ScoutFlow Recruiting. I noticed your experience with ${matched}, and I am reaching out about a ${jd.roleTitle} role building backend services for a GenAI platform. Is now still a good time for a short conversation?

Questions:
1. Are you open to new opportunities?
2. What kind of work interests you most?
3. Do you have experience with the key JD skills: ${jd.requiredSkills.slice(0, 5).join(", ")}?
4. Are you comfortable with ${jd.workMode} work and ${jd.location}?
5. What is your notice period?
6. Would you be open to a recruiter call this week?`;
}

export function buildOutreachPrompt(
  candidate: CandidateProfile,
  jd: ParsedJD,
  match: MatchResult | undefined,
  channel: Channel,
  tone: OutreachTone,
): string {
  return [
    "Write a recruiting outreach message.",
    `Candidate: ${candidate.name}, ${candidate.currentTitle}, ${candidate.location}.`,
    `Role: ${jd.roleTitle}, ${jd.location}, ${jd.workMode}.`,
    `Matched skills: ${(match?.matchedSkills ?? candidate.skills).slice(0, 8).join(", ")}.`,
    `Relevant projects: ${candidate.projects.join(" | ")}.`,
    `Channel: ${channel}. Tone: ${tone}.`,
    "Do not claim the message was sent. Keep it concise and recruiter-friendly.",
  ].join("\n");
}
