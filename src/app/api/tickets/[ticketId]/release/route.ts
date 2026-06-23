import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";
import type { Ticket } from "@/domain/ticket/ticket";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const { ticketId } = await params;
    const c = getContainer();
    const ticket = await c.releaseTicket.execute({ ticketId });
    return ticketResponse(ticket, ticketId);
  } catch (e) {
    return toErrorResponse(e);
  }
}

async function ticketResponse(ticket: Ticket, ticketId: string): Promise<NextResponse> {
  const snapshot = ticket.toSnapshot();
  const deps = await getContainer().ticketDependencies.listByTicket(ticketId);
  snapshot.dependencyIds = deps.map((d) => d.dependsOnTicketId);
  return NextResponse.json({ ticket: snapshot });
}
