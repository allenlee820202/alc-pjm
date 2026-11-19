import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { ValidationError } from "@/domain/shared/errors";
import { requireUser } from "@/presentation/api/helpers";
import { maintenanceErrorResponse, readMaintenanceJson } from "@/presentation/api/ticket-maintenance-request";

export async function POST(request: NextRequest, {params}: {params: Promise<{ticketId: string}>}) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    if (request.nextUrl.searchParams.size !== 0) throw new ValidationError("Unknown maintenance action parameter");
    const {ticketId} = await params;
    const result = await getContainer().maintainTicket.execute({ticketId, request: await readMaintenanceJson(request)});
    return NextResponse.json(result, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return maintenanceErrorResponse(error);}
}
