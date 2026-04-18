export interface AuthUser {
  id: string;
  email: string;
}

/**
 * Application-facing authentication port. Both the stub (in-memory) and the
 * Supabase adapter implement this so the rest of the app stays decoupled from
 * the auth provider.
 */
export interface AuthService {
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
}
