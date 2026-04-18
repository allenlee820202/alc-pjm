import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

const createSchema = z.object({
  key: z.string().min(2).max(10),
  name: z.string().min(1).max(100),
});

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const projects = await getContainer().listProjects.execute();
  return NextResponse.json({ projects: projects.map((p) => p.toSnapshot()) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const body = createSchema.parse(await req.json());
    const project = await getContainer().createProject.execute(body);
    return NextResponse.json({ project: project.toSnapshot() }, { status: 201 });
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
