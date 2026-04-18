import { NextResponse, type NextRequest } from "next/server";
import { STUB_COOKIE_NAME, decodeStubSession } from "@/infrastructure/auth/stub-session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/_next", "/favicon.ico"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const authMode = process.env.AUTH_MODE ?? "stub";

  if (authMode === "stub") {
    const cookie = req.cookies.get(STUB_COOKIE_NAME)?.value;
    const user = await decodeStubSession(cookie);
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // For Supabase, defer to server-side auth checks in route handlers / pages.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
