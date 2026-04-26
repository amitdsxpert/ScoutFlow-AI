import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { CandidateProfile } from "./types";

const SESSION_COOKIE_NAME = "scoutflow_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_TOKEN_LENGTH = 32;

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
  lastLoginAt?: string;
}

export type UserRole = "admin" | "recruiter" | "viewer" | "api_user";

export type Permission =
  | "roles:read"
  | "roles:write"
  | "candidates:read"
  | "candidates:write"
  | "candidates:delete"
  | "campaigns:read"
  | "campaigns:write"
  | "agents:run"
  | "export:read"
  | "export:write"
  | "settings:read"
  | "settings:write"
  | "users:read"
  | "users:write";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "roles:read", "roles:write",
    "candidates:read", "candidates:write", "candidates:delete",
    "campaigns:read", "campaigns:write",
    "agents:run",
    "export:read", "export:write",
    "settings:read", "settings:write",
    "users:read", "users:write",
  ],
  recruiter: [
    "roles:read", "roles:write",
    "candidates:read", "candidates:write",
    "campaigns:read", "campaigns:write",
    "agents:run",
    "export:read", "export:write",
  ],
  viewer: [
    "roles:read",
    "candidates:read",
    "campaigns:read",
    "export:read",
  ],
  api_user: [
    "roles:read",
    "candidates:read",
    "campaigns:read",
    "agents:run",
    "export:read",
  ],
};

export interface Session {
  id: string;
  userId: string;
  user: User;
  csrfToken: string;
  expiresAt: number;
  createdAt: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthConfig {
  sessionDuration?: number;
  maxSessionsPerUser?: number;
  requireEmailVerification?: boolean;
  allowedOrigins?: string[];
}

const defaultConfig: Required<AuthConfig> = {
  sessionDuration: SESSION_DURATION_MS,
  maxSessionsPerUser: 5,
  requireEmailVerification: false,
  allowedOrigins: [],
};

const ROLE_PERMISSIONS_MAP: Record<UserRole, Permission[]> = ROLE_PERMISSIONS;

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const saltBytes = salt || randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(saltBytes + password).digest("hex");
  return { hash, salt: saltBytes };
}

function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPassword(password, salt);
  try {
    return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

function createUserObject(id: string, email: string, name: string, role: UserRole): User {
  return {
    id,
    email,
    name,
    role,
    permissions: ROLE_PERMISSIONS_MAP[role] || [],
    createdAt: new Date().toISOString(),
  };
}

export class AuthManager {
  private config: Required<AuthConfig>;
  private users: Map<string, User & { passwordHash: string; salt: string }> = new Map();
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();

  constructor(config: AuthConfig = {}) {
    this.config = { ...defaultConfig, ...config };
    this.loadUsers();
  }

  private loadUsers(): void {
    const envUsers = process.env.AUTH_USERS;
    if (!envUsers) return;

    try {
      const usersList = JSON.parse(envUsers) as Array<{
        email: string;
        password: string;
        name: string;
        role?: UserRole;
      }>;

      usersList.forEach((userData) => {
        const id = createHash("sha256").update(userData.email).digest("hex").slice(0, 16);
        const { hash, salt } = hashPassword(userData.password);
        this.users.set(userData.email, {
          ...createUserObject(id, userData.email, userData.name, userData.role || "recruiter"),
          passwordHash: hash,
          salt,
        });
      });
    } catch (error) {
      console.error("Failed to parse AUTH_USERS env var:", error);
    }
  }

  async login(email: string, password: string, metadata?: { ip?: string; userAgent?: string }): Promise<{ success: true; session: Session } | { success: false; error: string }> {
    const userRecord = this.users.get(email.toLowerCase());
    if (!userRecord) {
      return { success: false, error: "Invalid credentials" };
    }

    if (!verifyPassword(password, userRecord.passwordHash, userRecord.salt)) {
      return { success: false, error: "Invalid credentials" };
    }

    const userSessionIds = this.userSessions.get(userRecord.id);
    if (userSessionIds && userSessionIds.size >= this.config.maxSessionsPerUser) {
      const oldestSession = Array.from(userSessionIds)
        .map((sid) => this.sessions.get(sid))
        .filter((s): s is Session => s !== undefined)
        .sort((a, b) => a.expiresAt - b.expiresAt)[0];

      if (oldestSession) {
        this.revokeSession(oldestSession.id);
      }
    }

    const sessionId = generateSessionId();
    const csrfToken = generateCsrfToken();
    const expiresAt = Date.now() + this.config.sessionDuration;

    const session: Session = {
      id: sessionId,
      userId: userRecord.id,
      user: {
        ...userRecord,
        lastLoginAt: new Date().toISOString(),
      },
      csrfToken,
      expiresAt,
      createdAt: new Date().toISOString(),
      ipAddress: metadata?.ip,
      userAgent: metadata?.userAgent,
    };

    this.sessions.set(sessionId, session);

    if (!this.userSessions.has(userRecord.id)) {
      this.userSessions.set(userRecord.id, new Set());
    }
    this.userSessions.get(userRecord.id)!.add(sessionId);

    return { success: true, session };
  }

  async logout(sessionId: string): Promise<boolean> {
    return this.revokeSession(sessionId);
  }

  async validateSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
      this.revokeSession(sessionId);
      return null;
    }

    return session;
  }

  async validateCsrfToken(sessionId: string, token: string): Promise<boolean> {
    const session = await this.validateSession(sessionId);
    if (!session) return false;
    return timingSafeEqual(Buffer.from(session.csrfToken), Buffer.from(token));
  }

  async refreshSession(sessionId: string): Promise<Session | null> {
    const session = await this.validateSession(sessionId);
    if (!session) return null;

    const newExpiresAt = Date.now() + this.config.sessionDuration;
    const newCsrfToken = generateCsrfToken();

    const refreshed: Session = {
      ...session,
      csrfToken: newCsrfToken,
      expiresAt: newExpiresAt,
    };

    this.sessions.set(sessionId, refreshed);
    return refreshed;
  }

  hasPermission(session: Session, permission: Permission): boolean {
    return session.user.permissions.includes(permission);
  }

  getUser(userId: string): User | null {
    const session = Array.from(this.sessions.values()).find((s) => s.userId === userId);
    return session?.user ?? null;
  }

  getUserSessions(userId: string): Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map((sid) => this.sessions.get(sid))
      .filter((s): s is Session => s !== undefined && s.expiresAt > Date.now());
  }

  private revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);

    const userSessionSet = this.userSessions.get(session.userId);
    if (userSessionSet) {
      userSessionSet.delete(sessionId);
      if (userSessionSet.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    return true;
  }

  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.revokeSession(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

let authManagerInstance: AuthManager | null = null;

export function getAuthManager(config?: AuthConfig): AuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new AuthManager(config);
  }
  return authManagerInstance;
}

export async function getSessionFromCookies(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) return null;

  const authManager = getAuthManager();
  return authManager.validateSession(sessionCookie.value);
}

export async function setSessionCookie(session: Session): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(session.expiresAt),
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export function requirePermission(session: Session, permission: Permission): void {
  if (!session.user.permissions.includes(permission)) {
    throw new AuthError(`Permission denied: ${permission}`, 403);
  }
}

export class AuthError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  salt: string;
  permissions: Permission[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: number;
  rateLimitPerMinute?: number;
}

const API_KEYS = new Map<string, ApiKey>();

export function loadApiKeys(): void {
  const envKeys = process.env.AUTH_API_KEYS;
  if (!envKeys) return;

  try {
    const keysList = JSON.parse(envKeys) as Array<{
      name: string;
      key: string;
      permissions?: Permission[];
      expiresAt?: number;
    }>;

    keysList.forEach((keyData) => {
      const id = randomBytes(8).toString("hex");
      const salt = randomBytes(16).toString("hex");
      const keyHash = createHash("sha256").update(keyData.key + salt).digest("hex");

      API_KEYS.set(keyData.key.slice(0, 8), {
        id,
        name: keyData.name,
        keyHash,
        salt,
        permissions: keyData.permissions || ROLE_PERMISSIONS_MAP.recruiter,
        createdAt: new Date().toISOString(),
        expiresAt: keyData.expiresAt,
      });
    });
  } catch (error) {
    console.error("Failed to parse AUTH_API_KEYS env var:", error);
  }
}

export function validateApiKey(key: string): ApiKey | null {
  const prefix = key.slice(0, 8);
  const apiKey = API_KEYS.get(prefix);

  if (!apiKey) return null;

  if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
    return null;
  }

  const hash = createHash("sha256").update(key + apiKey.salt).digest("hex");
  if (!timingSafeEqual(Buffer.from(hash), Buffer.from(apiKey.keyHash))) {
    return null;
  }

  apiKey.lastUsedAt = new Date().toISOString();
  return apiKey;
}

export function apiKeyHasPermission(apiKey: ApiKey, permission: Permission): boolean {
  return apiKey.permissions.includes(permission);
}

loadApiKeys();