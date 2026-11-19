import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";
import { requireUser, toErrorResponse } from "@/presentation/api/helpers";
import { ticketDiscoveryQuery } from "@/presentation/api/ticket-discovery-query";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;
    const response = await getContainer().listTicketAnnotationFacets.execute(ticketDiscoveryQuery(req.nextUrl.searchParams));
    return NextResponse.json(response, {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {
    return toErrorResponse(error);
  }
}
