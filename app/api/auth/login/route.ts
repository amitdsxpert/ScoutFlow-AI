import { NextResponse } from "next/server";
import { getAuthManager, setSessionCookie, clearSessionCookie } from "@/lib/auth";
import { isValidEmail, sanitizeEmail } from "@/lib/auth";

export const runtime = "nodejs";

interface LoginRequest {
  email?: string;
  password?: string;
  rememberMe?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
    const { email, password, rememberMe } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = sanitizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const authManager = getAuthManager();
    const metadata: { ip?: string; userAgent?: string } = {};

    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    metadata.ip = forwardedFor?.split(",")[0]?.trim() || realIp || undefined;
    metadata.userAgent = request.headers.get("user-agent") || undefined;

    const result = await authManager.login(normalizedEmail, password, metadata);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.session.user.id,
        email: result.session.user.email,
        name: result.session.user.name,
        role: result.session.user.role,
      },
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.expiresAt,
    });

    response.cookies.set("scoutflow_session", result.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: new Date(result.session.expiresAt),
      path: "/",
      maxAge: rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await import("next/headers").then(m => m.cookies());
    const sessionCookie = cookieStore.get("scoutflow_session");

    if (sessionCookie?.value) {
      const authManager = getAuthManager();
      await authManager.logout(sessionCookie.value);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete("scoutflow_session");

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await import("next/headers").then(m => m.cookies());
    const sessionCookie = cookieStore.get("scoutflow_session");

    if (!sessionCookie?.value) {
      return NextResponse.json({ authenticated: false, user: null });
    }

    const authManager = getAuthManager();
    const session = await authManager.validateSession(sessionCookie.value);

    if (!session) {
      return NextResponse.json({ authenticated: false, user: null });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role,
      },
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json({ authenticated: false, user: null }, { status: 500 });
  }
}