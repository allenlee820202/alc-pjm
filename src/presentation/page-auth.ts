import { redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";

/** Middleware is not an auth boundary in Supabase mode. Check reads and EACH action. */
export async function requirePageUser(): Promise<void> {
  const user = await getContainer().auth.getCurrentUser();
  if (!user) redirect("/login");
}
