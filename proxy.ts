import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate: no session cookie → /login. Pages verify the session for real (lib/session.ts).
// /api/auth, /mcp and /.well-known are excluded: Better Auth and OAuth bearer tokens handle those.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request) && request.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon|apple-icon|api/auth|mcp|\\.well-known).*)"],
};
