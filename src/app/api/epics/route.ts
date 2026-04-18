import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

const createSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(150),
  description: z.string().max(10_000).optional(),
});

const listSchema = z.object({ projectId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const { projectId } = listSchema.parse(params);
    const epics = await getContainer().listEpics.execute({ projectId });
    return NextResponse.json({ epics: epics.map((e) => e.toSnapshot()) });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", issues: e.issues },
        { status: 400 },
      );
    }
    return toErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const body = createSchema.parse(await req.json());
    const epic = await getContainer().createEpic.execute(body);
    return NextResponse.json({ epic: epic.toSnapshot() }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", issues: e.issues },
        { status: 400 },
      );
    }
    return toErrorResponse(e);
  }
}
