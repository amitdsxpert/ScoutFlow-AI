import { ensureCandidateIdentifier } from "./identity";
import type { CandidateProfile, CandidateSource } from "./types";
import { makeId } from "./roles";

export interface DatabaseConfig {
  type: "postgresql" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  tableName?: string;
}

export interface DatabaseQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

export interface DatabaseCandidateRecord {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  title?: string;
  current_title?: string;
  company?: string;
  current_company?: string;
  years_experience?: number;
  yearsExperience?: number;
  skills?: string;
  projects?: string;
  summary?: string;
  [key: string]: unknown;
}

export class DatabaseConnector {
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = {
      tableName: "candidates",
      ssl: false,
      ...config,
    };
  }

  async testConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const start = performance.now();
    try {
      const pool = await this.createPool();
      await pool.query("SELECT 1 as test");
      await pool.end();
      return { success: true, latency: Math.round(performance.now() - start) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
        latency: Math.round(performance.now() - start),
      };
    }
  }

  async fetchCandidates(options?: {
    limit?: number;
    offset?: number;
    skills?: string[];
    location?: string;
    minExperience?: number;
  }): Promise<DatabaseCandidateRecord[]> {
    const pool = await this.createPool();
    try {
      const { limit = 100, offset = 0, skills, location, minExperience } = options ?? {};

      let query = `SELECT * FROM ${this.config.tableName}`;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (location) {
        conditions.push(`(location ILIKE $${paramIndex} OR city ILIKE $${paramIndex} OR country ILIKE $${paramIndex})`);
        params.push(`%${location}%`);
        paramIndex++;
      }

      if (minExperience !== undefined) {
        conditions.push(`(years_experience >= $${paramIndex} OR yearsExperience >= $${paramIndex})`);
        params.push(minExperience);
        paramIndex++;
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);
      let records = result.rows as DatabaseCandidateRecord[];

      if (skills && skills.length > 0) {
        records = records.filter((record) => {
          const recordSkills = (record.skills || "").toLowerCase();
          return skills.some((skill) => recordSkills.includes(skill.toLowerCase()));
        });
      }

      return records;
    } finally {
      await pool.end();
    }
  }

  async countCandidates(filters?: {
    skills?: string[];
    location?: string;
    minExperience?: number;
  }): Promise<number> {
    const pool = await this.createPool();
    try {
      const { location, minExperience } = filters ?? {};
      let query = `SELECT COUNT(*) as count FROM ${this.config.tableName}`;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (location) {
        conditions.push(`(location ILIKE $${paramIndex} OR city ILIKE $${paramIndex} OR country ILIKE $${paramIndex})`);
        params.push(`%${location}%`);
        paramIndex++;
      }

      if (minExperience !== undefined) {
        conditions.push(`(years_experience >= $${paramIndex} OR yearsExperience >= $${paramIndex})`);
        params.push(minExperience);
        paramIndex++;
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      const result = await pool.query(query, params);
      const firstRow = result.rows[0] as { count?: string | number } | undefined;
      return parseInt(String(firstRow?.count ?? 0), 10);
    } finally {
      await pool.end();
    }
  }

  async executeQuery(sql: string, params?: unknown[]): Promise<DatabaseQueryResult> {
    const start = performance.now();
    const pool = await this.createPool();
    try {
      const result = await pool.query(sql, params);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0,
        duration: Math.round(performance.now() - start),
      };
    } finally {
      await pool.end();
    }
  }

  private async createPool(): Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>; end: () => Promise<void> }> {
    if (this.config.type === "postgresql") {
      try {
        const { Pool } = await import("pg");
        return new Pool({
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.username,
          password: this.config.password,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
          max: 5,
          idleTimeoutMillis: 15000,
          connectionTimeoutMillis: 10000,
        }) as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>; end: () => Promise<void> };
      } catch {
        throw new Error("PostgreSQL driver not installed. Install with: npm install pg");
      }
    } else if (this.config.type === "mysql") {
      try {
        const mysql = await import("mysql2/promise");
        return mysql.createPool({
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.username,
          password: this.config.password,
          waitForConnections: true,
          connectionLimit: 5,
          queueLimit: 0,
        }) as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>; end: () => Promise<void> };
      } catch {
        throw new Error("MySQL driver not installed. Install with: npm install mysql2");
      }
    }

    throw new Error("Unsupported database type. Use 'postgresql' or 'mysql'.");
  }
}

export function mapDatabaseRecordToCandidate(
  record: DatabaseCandidateRecord,
  source: CandidateSource = "database_mock"
): CandidateProfile {
  const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
  const asNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return undefined;
  };
  const name = asString(record.name) || asString(record.full_name) || asString(record.fullName) || "Unknown Candidate";
  const email = asString(record.email) || asString(record.email_address) || asString(record.emailAddress);
  const phone = asString(record.phone) || asString(record.phone_number) || asString(record.phoneNumber) || asString(record.mobile);
  const location = asString(record.location) || asString(record.city) || asString(record.current_location) || asString(record.currentLocation) || "Location not specified";
  const currentTitle = asString(record.title) || asString(record.current_title) || asString(record.currentTitle) || asString(record.job_title) || "Title not specified";
  const currentCompany = asString(record.company) || asString(record.current_company) || asString(record.currentCompany) || asString(record.employer);
  const yearsExperience = asNumber(record.years_experience) ?? asNumber(record.yearsExperience) ?? asNumber(record.experience_years) ?? 0;

  let skills: string[] = [];
  const rawSkills: unknown = record.skills;
  if (rawSkills) {
    if (typeof rawSkills === "string") {
      skills = rawSkills.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(rawSkills)) {
      skills = rawSkills.map((s) => String(s).trim()).filter(Boolean);
    }
  }

  let projects: string[] = [];
  const rawProjects: unknown = record.projects;
  if (rawProjects) {
    if (typeof rawProjects === "string") {
      projects = rawProjects.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(rawProjects)) {
      projects = rawProjects.map((s) => String(s).trim()).filter(Boolean);
    }
  }

  const summary = asString(record.summary) || asString(record.description) || asString(record.bio) || asString(record.about) || "";

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

export function createDatabaseConnectorFromEnv(): DatabaseConnector | null {
  const type = process.env.DB_TYPE as "postgresql" | "mysql" | undefined;
  if (!type) return null;

  const requiredEnvVars = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
  ];

  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.warn(`Database connector: missing env vars ${missing.join(", ")}`);
    return null;
  }

  return new DatabaseConnector({
    type,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "",
    username: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    ssl: process.env.DB_SSL === "true",
    tableName: process.env.DB_TABLE || "candidates",
  });
}