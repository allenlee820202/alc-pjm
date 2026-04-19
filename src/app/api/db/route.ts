import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer, switchSqliteDatabase } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

const switchSchema = z.object({
  path: z.string().min(1, "path is required"),
});

/** GET /api/db — return current repo mode and SQLite file path. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const c = getContainer();
  return NextResponse.json({ repoMode: c.repoMode, dbPath: c.dbPath });
}

/**
 * POST /api/db — switch the active SQLite file. Persisted across restarts.
 * Body: { "path": "/abs/or/relative/path/to/file.db" }
 *
 * The path is resolved server-side (this is a local tool; users supply paths
 * on their own machine). The file is created if it doesn't exist.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const body = switchSchema.parse(await req.json());
    const { dbPath } = switchSqliteDatabase(body.path);
    return NextResponse.json({ ok: true, dbPath });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", issues: e.issues },
        { status: 400 },
      );
    }
    if (e instanceof Error && e.message.includes("Cannot switch")) {
      return NextResponse.json({ error: "WRONG_MODE", message: e.message }, { status: 400 });
    }
    return toErrorResponse(e);
  }
}
