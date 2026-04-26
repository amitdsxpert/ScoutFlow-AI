import { NextResponse } from "next/server";
import { createDatabaseConnectorFromEnv, mapDatabaseRecordToCandidate } from "@/lib/database";
import type { CandidateProfile } from "@/lib/types";

export const runtime = "nodejs";

interface DatabaseRequest {
  action: "test" | "fetch" | "count" | "query";
  options?: {
    limit?: number;
    offset?: number;
    skills?: string[];
    location?: string;
    minExperience?: number;
    sql?: string;
    params?: unknown[];
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DatabaseRequest;
    const connector = createDatabaseConnectorFromEnv();

    if (!connector) {
      return NextResponse.json(
        { error: "Database not configured. Set DB_TYPE, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in .env.local" },
        { status: 400 }
      );
    }

    switch (body.action) {
      case "test": {
        const result = await connector.testConnection();
        return NextResponse.json(result);
      }

      case "fetch": {
        const records = await connector.fetchCandidates(body.options);
        const candidates = records.map((record) =>
          mapDatabaseRecordToCandidate(record, "database_mock")
        );
        return NextResponse.json({
          candidates,
          count: candidates.length,
          hasMore: (body.options?.limit ?? 100) < (records.length || 0),
        });
      }

      case "count": {
        const count = await connector.countCandidates(body.options);
        return NextResponse.json({ count });
      }

      case "query": {
        if (!body.options?.sql) {
          return NextResponse.json({ error: "SQL query is required" }, { status: 400 });
        }
        const result = await connector.executeQuery(
          body.options.sql,
          body.options.params
        );
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const connector = createDatabaseConnectorFromEnv();

    if (!connector) {
      return NextResponse.json({
        configured: false,
        message: "Database not configured",
      });
    }

    const count = await connector.countCandidates();
    return NextResponse.json({
      configured: true,
      count,
      type: process.env.DB_TYPE,
    });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : "Failed to connect",
    });
  }
}