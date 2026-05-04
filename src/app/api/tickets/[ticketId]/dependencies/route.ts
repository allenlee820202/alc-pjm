import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

const addSchema = z.object({
  dependsOnTicketId: z.string().uuid(),
});

const removeSchema = z.object({
  dependsOnTicketId: z.string().uuid(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const deps = await getContainer().listTicketDependencies.execute({ ticketId });
    return NextResponse.json({
      dependencies: deps.map((d) => d.toSnapshot()),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const body = addSchema.parse(await req.json());
    const dep = await getContainer().addTicketDependency.execute({
      ticketId,
      dependsOnTicketId: body.dependsOnTicketId,
    });
    return NextResponse.json({ dependency: dep.toSnapshot() }, { status: 201 });
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const body = removeSchema.parse(await req.json());
    await getContainer().removeTicketDependency.execute({
      ticketId,
      dependsOnTicketId: body.dependsOnTicketId,
    });
    return NextResponse.json({ ok: true });
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
