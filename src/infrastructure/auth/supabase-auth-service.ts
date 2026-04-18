import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { AuthService, AuthUser } from "@/application/ports/auth-service";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

async function getSupabase() {
  const store = await cookies();
  return createServerClient(
    envOrThrow("NEXT_PUBLIC_SUPABASE_URL"),
    envOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return store.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(items: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          for (const { name, value, options } of items) {
            store.set(name, value, options as never);
          }
        },
      },
    },
  );
}

/**
 * Supabase-backed implementation. Activated when AUTH_MODE=supabase.
 * The cookie-based session is managed by @supabase/ssr.
 */
export class SupabaseAuthService implements AuthService {
  async signIn(email: string, password: string): Promise<AuthUser> {
    const supabase = await getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(error?.message ?? "Invalid credentials");
    return { id: data.user.id, email: data.user.email ?? email };
  }

  async signOut(): Promise<void> {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? "" };
  }
}
