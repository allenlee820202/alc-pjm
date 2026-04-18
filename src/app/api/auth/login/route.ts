import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContainer } from "@/infrastructure/container";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const user = await getContainer().auth.signIn(body.email, body.password);
    return NextResponse.json({ user });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
    }
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
}
