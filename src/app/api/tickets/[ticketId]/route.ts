import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

/**
 * Patch payload accepts any subset of mutable fields. `status` triggers a
 * workflow transition (validated by the domain), other fields go through the
 * UpdateTicket use case. `epicId: null` clears the epic.
 */
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  priority: z.enum(["p0", "p1", "p2"]).optional(),
  epicId: z.string().uuid().nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  archived: z.boolean().optional(),
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

    if (body.archived === true) {
      await c.archiveTicket.execute({ ticketId });
    } else if (body.archived === false) {
      await c.unarchiveTicket.execute({ ticketId });
    }

    if (body.status) {
      await c.transitionTicket.execute({ ticketId, status: body.status });
    }

    const hasFieldEdits =
      body.title !== undefined ||
      body.description !== undefined ||
      body.priority !== undefined ||
      body.epicId !== undefined;
    if (hasFieldEdits) {
      await c.updateTicket.execute({
        ticketId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        epicId: body.epicId,
      });
    }

    const final = await c.tickets.findById(
      (await import("@/domain/shared/id")).Id.of<"Ticket">(ticketId),
    );
    if (!final) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
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
