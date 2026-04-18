import { NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { DomainError } from "@/domain/shared/errors";

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  // eslint-disable-next-line no-console
  console.error("Unhandled API error", err);
  return NextResponse.json(
    { error: "INTERNAL", message: "Internal server error" },
    { status: 500 },
  );
}

/** Confirms the request bears a valid auth session. Returns 401 NextResponse otherwise. */
export async function requireUser(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const c = getContainer();
  const user = await c.auth.getCurrentUser();
  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }
  return { ok: true };
}
