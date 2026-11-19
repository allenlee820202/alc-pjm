import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { requireUser } from "@/presentation/api/helpers";
import { maintenanceErrorResponse, ticketMaintenanceQuery } from "@/presentation/api/ticket-maintenance-request";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const inventory = await getContainer().listMaintenanceTickets.execute(ticketMaintenanceQuery(request.nextUrl.searchParams));
    return NextResponse.json(inventory, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return maintenanceErrorResponse(error);}
}
