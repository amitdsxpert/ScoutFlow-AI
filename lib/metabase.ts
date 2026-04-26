import { ensureCandidateIdentifier } from "./identity";
import type { CandidateProfile, CandidateSource } from "./types";
import { makeId } from "./roles";

export interface MetabaseConfig {
  baseUrl: string;
  apiKey: string;
  collectionId?: number;
}

export interface MetabaseQuestion {
  id: number;
  name: string;
  description?: string;
  collectionId?: number;
  cache_duration?: number;
}

export interface MetabaseQueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  running_time?: number;
}

export class MetabaseConnector {
  private config: MetabaseConfig;

  constructor(config: MetabaseConfig) {
    this.config = config;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; version?: string }> {
    try {
      const response = await this.request("/api/health");
      if (response.status === "ok") {
        return { success: true, version: response.version };
      }
      return { success: false, error: "Metabase health check failed" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  async listQuestions(options?: {
    collectionId?: number;
    search?: string;
  }): Promise<MetabaseQuestion[]> {
    const params = new URLSearchParams();
    if (options?.collectionId) params.set("collection", String(options.collectionId));
    if (options?.search) params.set("search", options.search);

    const response = await this.request(`/api/search?${params.toString()}&type=card`);
    return (response.items || []).map((item: Record<string, unknown>) => ({
      id: item.id as number,
      name: item.name as string,
      description: item.description as string | undefined,
      collectionId: item.collection_id as number | undefined,
    }));
  }

  async getQuestion(questionId: number): Promise<MetabaseQuestion | null> {
    try {
      const response = await this.request(`/api/card/${questionId}`);
      return {
        id: response.id,
        name: response.name,
        description: response.description,
        collectionId: response.collection_id,
        cache_duration: response.cache_duration,
      };
    } catch {
      return null;
    }
  }

  async executeSavedQuestion(
    questionId: number,
    parameters?: Record<string, string>
  ): Promise<MetabaseQueryResult> {
    const start = performance.now();

    let queryUrl = `/api/card/${questionId}/query`;
    if (parameters && Object.keys(parameters).length > 0) {
      queryUrl += `?${new URLSearchParams(parameters).toString()}`;
    }

    const response = await this.request(queryUrl, "POST");

    if (response.status === "completed" && response.results) {
      const result = response.results[0];
      const data = result.data || result;

      return {
        rows: (data.rows || []) as Record<string, unknown>[],
        columns: (data.cols || data.columns || []).map((col: Record<string, unknown>) =>
          typeof col === "string" ? col : col.name || String(col)
        ),
        rowCount: data.rows?.length ?? 0,
        running_time: Math.round(performance.now() - start),
      };
    }

    if (response.status === "failed") {
      throw new Error(`Query failed: ${response.error || "Unknown error"}`);
    }

    throw new Error(`Query status: ${response.status}`);
  }

  async executeQuery(
    collectionId: number,
    query: {
      database: number;
      query: {
        "source-table"?: number;
        aggregation?: Array<unknown>;
        breakout?: Array<unknown>;
        filters?: Array<unknown>;
        "order-by"?: Array<unknown>;
        limit?: number;
      };
    },
    parameters?: Record<string, string>
  ): Promise<MetabaseQueryResult> {
    const start = performance.now();

    const response = await this.request("/api/dataset", "POST", {
      type: "query",
      collection: collectionId,
      query,
      parameters: parameters ? Object.entries(parameters).map(([key, value]) => ({ type: "category", target: ["variable", ["template-tag", key]], value })) : [],
    });

    return {
      rows: (response.rows || []) as Record<string, unknown>[],
      columns: (response.columns || []) as string[],
      rowCount: response.rows?.length ?? 0,
      running_time: Math.round(performance.now() - start),
    };
  }

  async getCollections(): Promise<Array<{ id: number; name: string; slug: string }>> {
    const response = await this.request("/api/collection");
    return (Array.isArray(response) ? response : []).map((item: Record<string, unknown>) => ({
      id: item.id as number,
      name: item.name as string,
      slug: item.slug as string || String(item.id),
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request<T = any>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Key": this.config.apiKey,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "No error body");
      throw new Error(`Metabase API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }
}

export function mapMetabaseRecordToCandidate(
  record: Record<string, unknown>,
  source: CandidateSource = "metabase_mock"
): CandidateProfile {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };

  const getNumber = (keys: string[]): number => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return 0;
  };

  const getArray = (keys: string[]): string[] => {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value.map(String).filter(Boolean);
      if (typeof value === "string" && value.trim()) {
        return value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const name = getString(["name", "full_name", "candidate_name", "employee_name", "person_name"]) || "Unknown Candidate";
  const email = getString(["email", "email_address", "contact_email", "candidate_email"]);
  const phone = getString(["phone", "phone_number", "contact_phone", "mobile", "phone_number"]);
  const location = getString(["location", "city", "current_location", "work_location", "address"]) || "Location not specified";
  const currentTitle = getString(["title", "job_title", "current_title", "position", "role"]) || "Title not specified";
  const currentCompany = getString(["company", "current_company", "employer", "organization", "workplace"]);
  const yearsExperience = getNumber(["years_experience", "yearsexperience", "experience_years", "total_experience", "work_experience"]);
  const skills = getArray(["skills", "technical_skills", "competencies", "expertise", "technology"]);
  const projects = getArray(["projects", "key_projects", "notable_projects", "portfolio"]);
  const summary = getString(["summary", "description", "bio", "about", "profile", "headline"]) || "";

  return ensureCandidateIdentifier({
    id: makeId("candidate"),
    name,
    email,
    phone,
    location,
    currentTitle,
    currentCompany,
    yearsExperience,
    skills,
    projects,
    summary,
    source,
    addedAt: new Date().toISOString(),
    status: "new",
    persona: {
      type: "passive",
      openness: 65,
      enthusiasm: 50,
      availability: "30",
      compensationSensitivity: "medium",
      likelyObjections: [],
    },
  });
}

export function createMetabaseConnectorFromEnv(): MetabaseConnector | null {
  const baseUrl = process.env.METABASE_URL;
  const apiKey = process.env.METABASE_API_KEY;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return new MetabaseConnector({
    baseUrl,
    apiKey,
    collectionId: process.env.METABASE_COLLECTION_ID ? parseInt(process.env.METABASE_COLLECTION_ID, 10) : undefined,
  });
}

export const METABASE_PRESET_QUERIES = [
  {
    id: "backend-engineers",
    label: "Backend Engineers India",
    description: "Candidates with backend engineering skills in India",
    parameters: { location: "India", role: "backend" },
  },
  {
    id: "genai-talent",
    label: "GenAI Talent Pool",
    description: "Candidates with LLM, RAG, or GenAI experience",
    parameters: { skills: "llm,rag,genai" },
  },
  {
    id: "remote-candidates",
    label: "Remote Candidates",
    description: "Candidates open to remote work",
    parameters: { work_mode: "remote" },
  },
  {
    id: "high-availability",
    label: "High Availability Candidates",
    description: "Candidates available within 30 days",
    parameters: { availability: "30" },
  },
] as const;