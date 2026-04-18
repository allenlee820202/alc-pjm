import { cookies } from "next/headers";
import type { AuthService } from "@/application/ports/auth-service";
import {
  STUB_COOKIE_NAME,
  encodeStubSession,
  decodeStubSession,
  type AuthUser,
} from "./stub-session";

/**
 * Stub auth service backed by signed HMAC cookies. Intended for development
 * and CI. A single demo credential pair is read from env vars.
 */
export class StubAuthService implements AuthService {
  private readonly demoEmail = process.env.STUB_AUTH_EMAIL ?? "demo@example.com";
  private readonly demoPassword = process.env.STUB_AUTH_PASSWORD ?? "demo1234";

  async signIn(email: string, password: string): Promise<AuthUser> {
    if (email !== this.demoEmail || password !== this.demoPassword) {
      throw new Error("Invalid credentials");
    }
    const user: AuthUser = { id: "demo-user", email };
    const store = await cookies();
    store.set(STUB_COOKIE_NAME, await encodeStubSession(user), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });
    return user;
  }

  async signOut(): Promise<void> {
    const store = await cookies();
    store.delete(STUB_COOKIE_NAME);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const store = await cookies();
    return decodeStubSession(store.get(STUB_COOKIE_NAME)?.value);
  }
}

export { STUB_COOKIE_NAME } from "./stub-session";
