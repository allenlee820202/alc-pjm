import { NextResponse } from "next/server";
import { requireUser } from "@/presentation/api/helpers";

/** Authenticated feature negotiation: old servers must not silently strip metadata. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  return NextResponse.json({
    ticketMetadata: {version: 1, tags: true, annotations: true, origin: true, immutableOrigin: true},
  });
}
