export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";

export type CandidateSource =
  | "demo"
  | "csv"
  | "json"
  | "database_mock"
  | "metabase_mock"
  | "resume_upload";

export type PersonaType =
  | "highly_interested"
  | "passive"
  | "not_interested"
  | "remote_only"
  | "compensation_sensitive"
  | "available_immediately";

export type CompensationSensitivity = "low" | "medium" | "high";

export type Channel = "email" | "whatsapp" | "linkedin" | "sms" | "phone";

export type OutreachTone =
  | "professional"
  | "friendly"
  | "technical"
  | "startup"
  | "executive"
  | "warm_referral";

export type InterestLevel = "very_high" | "high" | "medium" | "low" | "none";

export type RoleStatus = "draft" | "active" | "completed";

export type CampaignStatus =
  | "draft"
  | "generated"
  | "simulated_sent"
  | "replies_generated"
  | "replied"
  | "interested"
  | "not_interested"
  | "follow_up_needed"
  | "completed";

export type AgentStatus = "idle" | "running" | "completed" | "warning" | "error";
export type AgentProviderUsed = "openrouter" | "gemini" | "groq" | "huggingface" | "local_fallback";

export type AgentId =
  | "jd_intelligence"
  | "source_discovery"
  | "resume_parsing"
  | "candidate_matching"
  | "recommendation"
  | "outreach"
  | "phone_outreach"
  | "interest_detection"
  | "ranking"
  | "export";

export type CandidateStatus =
  | "new"
  | "recommended"
  | "outreach_ready"
  | "contacted"
  | "replied"
  | "interested"
  | "shortlisted"
  | "low_priority";

export type SegmentType = "system" | "custom";

export type AudienceType =
  | "top_recommended"
  | "selected_candidates"
  | "segment"
  | "shortlist"
  | "interested"
  | "all_matched"
  | "current_filtered_view";

export type OptimizationFocus =
  | "balanced"
  | "skills_first"
  | "interest_first"
  | "location_first"
  | "availability_first"
  | "compensation_sensitive"
  | "low_risk";

export type OutreachMode = "draft_only" | "simulate_send_and_replies" | "simulate_phone_transcript";

export type ShortlistPreset =
  | "balanced"
  | "skills_first"
  | "interest_first"
  | "availability_first"
  | "location_first"
  | "custom";

export interface ScoringWeights {
  requiredSkills: number;
  experience: number;
  preferredSkills: number;
  domain: number;
  location: number;
  riskAdjustment: number;
}

export interface ParsedJD {
  roleTitle: string;
  seniority: string;
  department: string;
  location: string;
  workMode: WorkMode;
  requiredSkills: string[];
  preferredSkills: string[];
  minYearsExperience: number;
  responsibilities: string[];
  dealBreakers: string[];
  screeningQuestions: string[];
  scoringWeights: ScoringWeights;
  qualityScore: number;
  rawText: string;
}

export interface CandidatePersona {
  type: PersonaType;
  openness: number;
  enthusiasm: number;
  availability: string;
  compensationSensitivity: CompensationSensitivity;
  likelyObjections: string[];
}

export interface CandidateProfile {
  id: string;
  globalCandidateId?: string;
  name: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  location: string;
  currentTitle: string;
  currentCompany?: string;
  yearsExperience: number;
  skills: string[];
  projects: string[];
  summary: string;
  source: CandidateSource;
  persona: CandidatePersona;
  addedAt?: string;
  status?: CandidateStatus;
  segments?: string[];
  parsingConfidence?: number;
  resumeFileName?: string;
  resumeReference?: string;
}

export interface MatchBreakdown {
  requiredSkills: number;
  experience: number;
  preferredSkills: number;
  domain: number;
  location: number;
  riskAdjustment: number;
}

export interface MatchResult {
  roleId?: string;
  candidateId: string;
  matchScore: number;
  breakdown: MatchBreakdown;
  matchedSkills: string[];
  matchedRequiredSkills: string[];
  matchedPreferredSkills: string[];
  missingSkills: string[];
  explanation: string;
  risks: string[];
  recruiterQuestions: string[];
  confidence: number;
  scoreBand: "Excellent Match" | "Strong Match" | "Partial Match" | "Weak Match" | "Not Recommended";
  experienceFit: string;
  locationFit: string;
  domainRelevance: string;
}

export type MessageDeliveryStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "failed";

export type MessageDeliveryProvider = "resend" | "twilio_sms" | "twilio_whatsapp" | "manual" | "none";

export interface MessageDeliveryEvent {
  status: MessageDeliveryStatus;
  timestamp: string;
  detail?: string;
}

export interface OutreachResult {
  id?: string;
  roleId?: string;
  campaignId?: string;
  candidateId: string;
  channel: Channel;
  tone: OutreachTone;
  subject?: string;
  message: string;
  simulatedReply?: string;
  phoneTranscript?: string;
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
  providerError?: string;
  createdAt: string;
  // Real delivery tracking
  deliveryStatus?: MessageDeliveryStatus;
  deliveryProvider?: MessageDeliveryProvider;
  providerMessageId?: string;
  sentAt?: string;
  deliveredAt?: string;
  repliedAt?: string;
  reply?: string;
  events?: MessageDeliveryEvent[];
}

export interface InterestSignals {
  explicitInterest: number;
  enthusiasm: number;
  availability: number;
  roleMotivation: number;
  workModeFit: number;
  objections: number;
  nextStepReadiness: number;
}

export interface InterestResult {
  roleId?: string;
  campaignId?: string;
  candidateId: string;
  interestScore: number;
  interestLevel: InterestLevel;
  signals: InterestSignals;
  summary: string;
  recommendedNextAction: string;
}

export interface RankedCandidate {
  roleId?: string;
  rank: number;
  candidate: CandidateProfile;
  match: MatchResult;
  interest: InterestResult;
  finalScore: number;
  recommendation: string;
}

export interface PhoneTurn {
  speaker: "AI" | "Candidate";
  text: string;
}

export interface ExportPayload {
  roles?: RolePipeline[];
  activeRole?: RolePipeline | null;
  parsedJD: ParsedJD | null;
  candidates: CandidateProfile[];
  matchResults: MatchResult[];
  interestResults: InterestResult[];
  rankedShortlist: RankedCandidate[];
  outreachCampaigns?: OutreachCampaign[];
  candidateLists?: CandidateList[];
  agentActivity?: AgentActivity[];
  agentStates?: AgentModuleState[];
  conversations?: Conversation[];
  shortlistSettings?: ShortlistSettings[];
}

export interface RolePipeline {
  id: string;
  jdId: string;
  jobId: string;
  roleTitle: string;
  rawJD: string;
  enrichedJDText?: string;
  parsedJD: ParsedJD;
  createdAt: string;
  updatedAt: string;
  status: RoleStatus;
  candidateMatches: MatchResult[];
  outreachCampaigns: string[];
  shortlist: string[];
  agentLogs?: AgentRunLog[];
  agentProviderUsed?: AgentProviderUsed;
  agentModelUsed?: string;
  agentConfidence?: number;
  agentReasoningSummary?: string;
}

export interface OutreachCampaign {
  id: string;
  roleId: string;
  name: string;
  audienceType?: AudienceType;
  segmentId?: string;
  candidateIds: string[];
  channels: Channel[];
  tone: OutreachTone;
  createdAt: string;
  status: CampaignStatus;
  messages: OutreachResult[];
  conversations?: Conversation[];
  interestResults: InterestResult[];
  agentActivity?: AgentActivity[];
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
}

export interface CandidateList {
  id: string;
  name: string;
  type: SegmentType;
  candidateIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type Segment = CandidateList;

export interface Conversation {
  id: string;
  campaignId: string;
  roleId: string;
  candidateId: string;
  channel: Channel;
  sentMessage: string;
  reply?: string;
  transcript?: string;
  status: "draft" | "sent" | "replied" | "interested" | "not_interested" | "follow_up_needed";
  interestResult?: InterestResult;
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
  createdAt: string;
}

export interface AgentActivity {
  id: string;
  agentId: AgentId;
  name: string;
  status: AgentStatus;
  task: string;
  description?: string;
  inputSummary?: string;
  outputSummary?: string;
  reasoningSummary?: string;
  confidence?: number;
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
  relatedRoleId?: string;
  logs?: string[];
  summary: string;
  timestamp: string;
}

export interface AgentModuleState {
  id: AgentId;
  name: string;
  description: string;
  status: AgentStatus;
  inputSummary: string;
  outputSummary: string;
  lastRunAt?: string;
  relatedRoleId?: string;
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
  logs: string[];
}

export interface AgentRunLog {
  id: string;
  agentName: string;
  status: AgentStatus;
  inputSummary: string;
  outputSummary: string;
  reasoningSummary: string;
  confidence: number;
  providerUsed?: AgentProviderUsed;
  modelUsed?: string;
  roleId?: string;
  timestamp: string;
}

export interface ShortlistSettings {
  roleId: string;
  preset: ShortlistPreset;
  weights: {
    match: number;
    interest: number;
    experience: number;
    location: number;
    availability: number;
    risk: number;
  };
}

export interface ScoutFlowRunOptions {
  roleId: string;
  sourceIds: CandidateSource[];
  candidateLimit: number;
  optimizationFocus: OptimizationFocus;
  channels: Channel[];
  outreachMode: OutreachMode;
  provider?: "auto" | "none" | "openrouter" | "gemini" | "groq" | "huggingface";
  model?: string;
}

export interface ScoutFlowRunResult {
  roles: RolePipeline[];
  candidates: CandidateProfile[];
  matchResults: MatchResult[];
  recommendedCandidateIds: string[];
  campaign?: OutreachCampaign;
  outreachResults: OutreachResult[];
  interestResults: InterestResult[];
  rankedShortlist: RankedCandidate[];
  agentActivity: AgentActivity[];
  agentStates: AgentModuleState[];
  agentRunLogs: AgentRunLog[];
  exportSummary: string;
}
