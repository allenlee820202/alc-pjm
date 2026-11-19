import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { requireUser } from "@/presentation/api/helpers";
import { maintenanceErrorResponse, ticketMaintenanceReceiptQuery } from "@/presentation/api/ticket-maintenance-request";

export async function GET(request: NextRequest, {params}: {params: Promise<{ticketId: string}>}) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const {ticketId} = await params;
    const result = await getContainer().getMaintenanceReceipt.execute({ticketId, query: ticketMaintenanceReceiptQuery(request.nextUrl.searchParams)});
    return NextResponse.json(result, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {return maintenanceErrorResponse(error);}
}
