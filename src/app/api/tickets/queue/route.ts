import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";
import type { TicketSnapshot } from "@/domain/ticket/ticket";

const queueSchema = z.object({
  mode: z.enum(["mine", "next"]),
  limit: z.coerce.number().int().positive().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const query = queueSchema.parse(params);
    const container = getContainer();

    if (query.mode === "next") {
      const ticket = await container.getNextQueueTicket.execute();
      const snapshots = ticket ? await withDependencies([ticket.toSnapshot()]) : [];
      return NextResponse.json({ ticket: snapshots[0] ?? null });
    }

    const tickets = await container.listMineQueueTickets.execute({
      limit: query.limit,
    });
    return NextResponse.json({
      tickets: await withDependencies(tickets.map((t) => t.toSnapshot())),
    });
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

async function withDependencies(
  snapshots: TicketSnapshot[],
): Promise<TicketSnapshot[]> {
  const ticketIds = snapshots.map((s) => s.id);
  const deps = await getContainer().ticketDependencies.listByTicketIds(ticketIds);
  const depsByTicket = new Map<string, string[]>();

  for (const dep of deps) {
    const list = depsByTicket.get(dep.ticketId) ?? [];
    list.push(dep.dependsOnTicketId);
    depsByTicket.set(dep.ticketId, list);
  }

  return snapshots.map((snap) => ({
    ...snap,
    dependencyIds: depsByTicket.get(snap.id) ?? [],
  }));
}
