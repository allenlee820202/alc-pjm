import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

/**
 * Patch validates all mutable fields on one aggregate, then saves once with
 * optimistic conflict detection. `epicId: null` clears the epic.
 */
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  priority: z.enum(["p0", "p1", "p2"]).optional(),
  epicId: z.string().uuid().nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  archived: z.boolean().optional(),
  tags: z.unknown().optional(),
  annotations: z.unknown().optional(),
  // Unlike other unknown legacy fields, provenance must never be silently stripped.
  origin: z.never().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const { Id } = await import("@/domain/shared/id");
    const container = getContainer();
    const ticket = await container.tickets.findById(Id.of<"Ticket">(ticketId));
    if (!ticket) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    const snapshot = ticket.toSnapshot();
    const deps = await container.ticketDependencies.listByTicket(ticketId);
    snapshot.dependencyIds = deps.map((d) => d.dependsOnTicketId);
    return NextResponse.json({ ticket: snapshot });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const body = patchSchema.parse(await req.json());
    const c = getContainer();
    const final = await c.updateTicket.execute({
      ticketId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      epicId: body.epicId,
      tags: body.tags,
      annotations: body.annotations,
      status: body.status,
      archived: body.archived,
    });
    const snapshot = final.toSnapshot();
    const deps = await c.ticketDependencies.listByTicket(ticketId);
    snapshot.dependencyIds = deps.map((d) => d.dependsOnTicketId);
    return NextResponse.json({ ticket: snapshot });
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
  _req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const t = await getContainer().archiveTicket.execute({ ticketId });
    return NextResponse.json({ ticket: t.toSnapshot() });
  } catch (e) {
    return toErrorResponse(e);
  }
}
