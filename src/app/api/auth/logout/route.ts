import { NextResponse } from "next/server";
import { getContainer } from "@/infrastructure/container";

export async function POST() {
  await getContainer().auth.signOut();
  return NextResponse.json({ ok: true });
}
