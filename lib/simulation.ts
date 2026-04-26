import type {
  CandidateProfile,
  InterestLevel,
  InterestResult,
  InterestSignals,
  MatchResult,
  ParsedJD,
  PhoneTurn,
} from "./types";

export const phoneQuestions = [
  "Are you open to new opportunities?",
  "What kind of work interests you most?",
  "Do you have experience with the key JD skills?",
  "Are you comfortable with this work mode/location?",
  "What is your notice period?",
  "Would you be open to a recruiter call this week?",
];

export function simulateReply(candidate: CandidateProfile, jd: ParsedJD, match?: MatchResult): string {
  const firstName = candidate.name.split(" ")[0];
  const role = jd.roleTitle;
  const skill = match?.matchedSkills[0] ?? candidate.skills[0] ?? "backend platform work";

  switch (candidate.persona.type) {
    case "highly_interested":
      return `Hi, thanks for reaching out. This sounds very relevant, especially the ${skill} and GenAI platform scope. I am open to a call this week and would like to learn more about the team and roadmap.`;
    case "available_immediately":
      return `Thanks for the note. I am actively exploring and can move quickly. The ${role} role sounds aligned with what I want next. Please share slots for a recruiter call this week.`;
    case "passive":
      return `Thanks for reaching out. I am not actively looking, but the role sounds interesting. Could you share more about compensation range, team size, and the platform problems before I commit to a call?`;
    case "remote_only":
      return jd.workMode === "remote"
        ? `Hi, I am interested if this is fully remote. The backend and GenAI scope sounds aligned. Happy to do an intro call if remote flexibility is confirmed.`
        : `Thanks ${firstName ? "" : ""}for reaching out. I would only consider fully remote roles right now, so I may not be a fit unless the work mode is flexible.`;
    case "compensation_sensitive":
      return `Thanks, this looks relevant. Before scheduling, could you share the compensation range and level? If that aligns, I would be happy to discuss the ${role} role.`;
    case "not_interested":
      return `Thanks for thinking of me. I am happy in my current role and not exploring opportunities right now. Please feel free to check back later in the year.`;
    default:
      return `Thanks for reaching out. I am open to learning more about the role and next steps.`;
  }
}

export function simulatePhoneTranscript(candidate: CandidateProfile, jd: ParsedJD, match?: MatchResult): PhoneTurn[] {
  const skillText = (match?.matchedSkills.length ? match.matchedSkills : candidate.skills).slice(0, 4).join(", ");
  const answers = phoneAnswers(candidate, jd, skillText);
  const turns: PhoneTurn[] = [
    {
      speaker: "AI",
      text: `Hi ${candidate.name.split(" ")[0]}, this is ScoutFlow Recruiting calling about ${jd.roleTitle}. Is now a good time for a quick conversation?`,
    },
  ];

  phoneQuestions.forEach((question, index) => {
    turns.push({ speaker: "AI", text: question });
    turns.push({ speaker: "Candidate", text: answers[index] });
  });

  return turns;
}

export function scoreInterest(candidate: CandidateProfile, jd: ParsedJD, text: string, match?: MatchResult): InterestResult {
  const persona = candidate.persona;
  const workModeFit = persona.type === "remote_only" && jd.workMode !== "remote" ? 25 : persona.type === "remote_only" ? 96 : jd.workMode === "remote" ? 90 : 72;
  const objectionsPenalty = Math.max(0, 100 - persona.likelyObjections.length * 12 - (persona.compensationSensitivity === "high" ? 14 : 0));
  const baseSignals: InterestSignals = {
    explicitInterest: signalFromPersona(persona.type, "explicitInterest"),
    enthusiasm: Math.round(persona.enthusiasm * 100),
    availability: scoreAvailability(persona.availability),
    roleMotivation: scoreRoleMotivation(candidate, match),
    workModeFit,
    objections: objectionsPenalty,
    nextStepReadiness: signalFromPersona(persona.type, "nextStepReadiness"),
  };

  const textBoost = analyzeTextBoost(text);
  const score = Math.round(
    baseSignals.explicitInterest * 0.3 +
      Math.min(100, baseSignals.enthusiasm + textBoost) * 0.2 +
      baseSignals.availability * 0.15 +
      baseSignals.roleMotivation * 0.15 +
      baseSignals.workModeFit * 0.1 +
      baseSignals.nextStepReadiness * 0.1,
  );

  const personaBounded = applyPersonaBounds(persona.type, jd.workMode, score);
  const interestLevel = getInterestLevel(personaBounded);

  return {
    candidateId: candidate.id,
    interestScore: personaBounded,
    interestLevel,
    signals: {
      ...baseSignals,
      enthusiasm: Math.min(100, baseSignals.enthusiasm + textBoost),
    },
    summary: buildInterestSummary(candidate, interestLevel, personaBounded, jd),
    recommendedNextAction: recommendedAction(interestLevel, persona.type),
  };
}

export function transcriptToText(turns: PhoneTurn[]): string {
  return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
}

function phoneAnswers(candidate: CandidateProfile, jd: ParsedJD, skillText: string): string[] {
  switch (candidate.persona.type) {
    case "highly_interested":
      return [
        "Yes, I am actively open if the role has strong backend and AI platform scope.",
        "I enjoy owning APIs, platform workflows, and reliability improvements.",
        `Yes, I have worked with ${skillText}, and I can go deeper in a technical screen.`,
        `Yes, ${jd.workMode} works for me, especially with the India remote setup.`,
        candidate.persona.availability,
        "Yes, I can speak with the recruiter this week.",
      ];
    case "available_immediately":
      return [
        "Yes, I am available immediately and looking for the right team.",
        "I want hands-on backend ownership with practical GenAI product impact.",
        `I have recent experience with ${skillText}.`,
        `Yes, ${jd.workMode} and ${jd.location} work for me.`,
        candidate.persona.availability,
        "Definitely. Please send slots as soon as possible.",
      ];
    case "passive":
      return [
        "I am not actively searching, but I will listen if the scope is strong.",
        "I care about platform depth, team quality, and long-term technical problems.",
        `I have used ${skillText}, though I would like to understand how deep the AI work is.`,
        `The work mode sounds possible, but I need details.`,
        candidate.persona.availability,
        "Maybe. I would first like compensation and team context.",
      ];
    case "remote_only":
      return [
        "I am open only for fully remote roles.",
        "I like backend platform work where I can focus deeply and contribute asynchronously.",
        `Yes, I can discuss ${skillText}.`,
        jd.workMode === "remote" ? "Fully remote works well." : "Hybrid or onsite would not work for me.",
        candidate.persona.availability,
        jd.workMode === "remote" ? "Yes, if remote is confirmed." : "Probably not unless work mode changes.",
      ];
    case "compensation_sensitive":
      return [
        "I am open if the level and compensation range are aligned.",
        "I like AI platform work with meaningful ownership and measurable business impact.",
        `I have worked with ${skillText}, but would want to understand expectations.`,
        `The work mode is okay if the overall package fits.`,
        candidate.persona.availability,
        "Yes, after I understand compensation range.",
      ];
    case "not_interested":
      return [
        "Not at this time.",
        "I am focused on my current roadmap.",
        `I do have experience with ${skillText}, but I am not exploring.`,
        "Work mode is not the issue right now.",
        "Not available",
        "No, please check later.",
      ];
  }
}

function signalFromPersona(type: CandidateProfile["persona"]["type"], signal: "explicitInterest" | "nextStepReadiness"): number {
  const table: Record<CandidateProfile["persona"]["type"], [number, number]> = {
    highly_interested: [92, 90],
    available_immediately: [95, 96],
    passive: [66, 58],
    remote_only: [78, 70],
    compensation_sensitive: [76, 66],
    not_interested: [18, 14],
  };
  return signal === "explicitInterest" ? table[type][0] : table[type][1];
}

function scoreAvailability(availability: string): number {
  const normalized = availability.toLowerCase();
  if (normalized.includes("immediate")) return 98;
  if (normalized.includes("15")) return 92;
  if (normalized.includes("30")) return 84;
  if (normalized.includes("45")) return 74;
  if (normalized.includes("60")) return 62;
  if (normalized.includes("90")) return 42;
  if (normalized.includes("not")) return 12;
  return 60;
}

function scoreRoleMotivation(candidate: CandidateProfile, match?: MatchResult): number {
  const matchComponent = match ? Math.round(match.matchScore * 0.7) : 55;
  const opennessComponent = Math.round(candidate.persona.openness * 30);
  return Math.min(100, matchComponent + opennessComponent);
}

function analyzeTextBoost(text: string): number {
  const normalized = text.toLowerCase();
  let boost = 0;
  if (normalized.includes("open") || normalized.includes("interested")) boost += 5;
  if (normalized.includes("this week") || normalized.includes("slots")) boost += 6;
  if (normalized.includes("not exploring") || normalized.includes("not interested")) boost -= 18;
  if (normalized.includes("compensation")) boost -= 4;
  return boost;
}

function applyPersonaBounds(type: CandidateProfile["persona"]["type"], workMode: ParsedJD["workMode"], score: number): number {
  const bounds: Record<CandidateProfile["persona"]["type"], [number, number]> = {
    highly_interested: [85, 95],
    available_immediately: [85, 95],
    passive: [60, 75],
    compensation_sensitive: [65, 80],
    remote_only: workMode === "remote" ? [76, 90] : [34, 58],
    not_interested: [10, 30],
  };
  const [min, max] = bounds[type];
  return Math.max(min, Math.min(max, score));
}

function getInterestLevel(score: number): InterestLevel {
  if (score >= 90) return "very_high";
  if (score >= 75) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "none";
}

function buildInterestSummary(candidate: CandidateProfile, level: InterestLevel, score: number, jd: ParsedJD): string {
  if (level === "very_high" || level === "high") {
    return `${candidate.name} shows ${level.replace("_", " ")} intent with a ${score} interest score and appears ready to discuss ${jd.roleTitle}.`;
  }
  if (level === "medium") {
    return `${candidate.name} is meaningfully curious, but objections should be resolved before advancing.`;
  }
  if (level === "low") {
    return `${candidate.name} has limited intent right now; keep warm only if the skill fit is strategic.`;
  }
  return `${candidate.name} is not interested at this time.`;
}

function recommendedAction(level: InterestLevel, type: CandidateProfile["persona"]["type"]): string {
  if (level === "very_high" || level === "high") return "Schedule recruiter call";
  if (type === "compensation_sensitive") return "Share range, then follow up";
  if (type === "remote_only") return "Confirm remote policy";
  if (level === "medium") return "Nurture and verify objections";
  if (level === "low") return "Keep warm for later";
  return "Do not pursue now";
}
