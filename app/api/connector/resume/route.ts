import { NextResponse } from "next/server";
import { parseResumeFileBuffer, batchParseResumes, getSupportedResumeExtensions, isResumeFileSupported } from "@/lib/resumeParser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    const supportedFiles = files.filter((file) => isResumeFileSupported(file.name));
    const unsupportedFiles = files.filter((file) => !isResumeFileSupported(file.name));

    if (supportedFiles.length === 0) {
      return NextResponse.json({
        error: "No supported files provided",
        supported: getSupportedResumeExtensions(),
        unsupported: unsupportedFiles.map((f) => f.name),
      }, { status: 400 });
    }

    const results = await batchParseResumes(supportedFiles);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    return NextResponse.json({
      total: files.length,
      processed: supportedFiles.length,
      successful: successful.length,
      failed: failed.length,
      unsupportedCount: unsupportedFiles.length,
      unsupportedFiles: unsupportedFiles.map((f) => f.name),
      results: results.map((result, index) => ({
        filename: supportedFiles[index].name,
        success: result.success,
        candidate: result.candidate,
        confidence: result.confidence,
        warnings: result.warnings,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resume parsing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    supportedExtensions: getSupportedResumeExtensions(),
    formats: {
      pdf: "PDF documents are parsed using pdf.js",
      docx: "Word documents are parsed using mammoth",
      txt: "Plain text files are parsed directly",
      md: "Markdown files are parsed directly",
    },
  });
}