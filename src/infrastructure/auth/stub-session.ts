/**
 * Edge-runtime safe cookie codec for the stub auth session. Uses the
 * standard Web Crypto API so it can be imported from Next.js middleware.
 */
export interface AuthUser {
  id: string;
  email: string;
}

export const STUB_COOKIE_NAME = "alc_pjm_session";

const SECRET =
  process.env.STUB_AUTH_SECRET ??
  "dev-only-stub-secret-change-me-in-production-please-32+chars";

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return base64UrlEncode(sig);
}

export async function encodeStubSession(user: AuthUser): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(user)));
  const sig = await hmacSha256(payload);
  return `${payload}.${sig}`;
}

export async function decodeStubSession(value: string | undefined): Promise<AuthUser | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await hmacSha256(payload);
  if (!constantTimeEqual(encoder.encode(expected), encoder.encode(sig))) return null;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payload));
    return JSON.parse(json) as AuthUser;
  } catch {
    return null;
  }
}
