import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";

const createSchema = z.object({
  projectId: z.string().uuid(),
  epicId: z.string().uuid().nullish(),
  parentTicketId: z.string().uuid().nullish(),
  type: z.enum(["story", "task", "subtask", "bug"]),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  priority: z.enum(["p0", "p1", "p2"]),
});

const listSchema = z.object({
  projectId: z.string().uuid().optional(),
  epicId: z.string().uuid().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["p0", "p1", "p2"]).optional(),
  type: z.enum(["story", "task", "subtask", "bug"]).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const filters = listSchema.parse(params);
    const tickets = await getContainer().listTickets.execute(filters);
    return NextResponse.json({ tickets: tickets.map((t) => t.toSnapshot()) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  try {
    const body = createSchema.parse(await req.json());
    const ticket = await getContainer().createTicket.execute(body);
    return NextResponse.json({ ticket: ticket.toSnapshot() }, { status: 201 });
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
