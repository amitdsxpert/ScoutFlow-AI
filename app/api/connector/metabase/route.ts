import { NextResponse } from "next/server";
import { createMetabaseConnectorFromEnv, mapMetabaseRecordToCandidate, METABASE_PRESET_QUERIES } from "@/lib/metabase";
import type { CandidateProfile } from "@/lib/types";

export const runtime = "nodejs";

interface MetabaseRequest {
  action: "test" | "questions" | "execute" | "collections";
  options?: {
    questionId?: number;
    parameters?: Record<string, string>;
    collectionId?: number;
    search?: string;
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MetabaseRequest;
    const connector = createMetabaseConnectorFromEnv();

    if (!connector) {
      return NextResponse.json(
        { error: "Metabase not configured. Set METABASE_URL and METABASE_API_KEY in .env.local" },
        { status: 400 }
      );
    }

    switch (body.action) {
      case "test": {
        const result = await connector.testConnection();
        return NextResponse.json(result);
      }

      case "questions": {
        const questions = await connector.listQuestions(body.options);
        return NextResponse.json({ questions });
      }

      case "execute": {
        if (!body.options?.questionId) {
          return NextResponse.json({ error: "Question ID is required" }, { status: 400 });
        }
        const result = await connector.executeSavedQuestion(
          body.options.questionId,
          body.options.parameters
        );
        const candidates = result.rows.map((record) =>
          mapMetabaseRecordToCandidate(record, "metabase_mock")
        );
        return NextResponse.json({
          candidates,
          columns: result.columns,
          rowCount: result.rowCount,
          runningTime: result.running_time,
        });
      }

      case "collections": {
        const collections = await connector.getCollections();
        return NextResponse.json({ collections });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Metabase operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const connector = createMetabaseConnectorFromEnv();

    if (!connector) {
      return NextResponse.json({
        configured: false,
        message: "Metabase not configured",
        presets: METABASE_PRESET_QUERIES,
      });
    }

    const questions = await connector.listQuestions();
    return NextResponse.json({
      configured: true,
      questionCount: questions.length,
      presets: METABASE_PRESET_QUERIES,
      questions: questions.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : "Failed to connect",
      presets: METABASE_PRESET_QUERIES,
    });
  }
}