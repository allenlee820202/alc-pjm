import { readSessionCookie, writeSessionCookie } from "./fs-config.js";

interface ClientConfig {
  server: string;
  auth: { email: string; password: string };
}

interface HttpResult {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Extract the `alc_pjm_session` value from set-cookie headers.
 * Uses `headers.getSetCookie()` when available, falls back to
 * `headers.get("set-cookie")` with regex extraction.
 */
function extractSessionCookie(headers: Headers): string | null {
  const re = /alc_pjm_session=([^;]+)/;

  // Modern Node >= 20 has getSetCookie()
  if (typeof headers.getSetCookie === "function") {
    for (const sc of headers.getSetCookie()) {
      const m = re.exec(sc);
      if (m) return m[1];
    }
  }

  // Fallback
  const raw = headers.get("set-cookie");
  if (raw) {
    const m = re.exec(raw);
    if (m) return m[1];
  }

  return null;
}

export function createClient(config: ClientConfig) {
  const { server, auth } = config;

  async function rawFetch(
    method: string,
    path: string,
    body?: unknown,
    sessionOverride?: string | null,
  ): Promise<{ res: Response; data: unknown }> {
    const url = `${server.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const session = sessionOverride ?? readSessionCookie();
    if (session) {
      headers["Cookie"] = `alc_pjm_session=${session}`;
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    let data: unknown;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    return { res, data };
  }

  async function login(): Promise<string | null> {
    const { res } = await rawFetch("POST", "/api/auth/login", {
      email: auth.email,
      password: auth.password,
    });

    const cookie = extractSessionCookie(res.headers);
    if (cookie) {
      writeSessionCookie(cookie);
      return cookie;
    }
    return null;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResult> {
    const first = await rawFetch(method, path, body);

    // Auto-login on 401 and retry once
    if (first.res.status === 401) {
      const newSession = await login();
      if (newSession) {
        const retry = await rawFetch(method, path, body, newSession);
        return {
          ok: retry.res.ok,
          status: retry.res.status,
          data: retry.data,
        };
      }
    }

    return {
      ok: first.res.ok,
      status: first.res.status,
      data: first.data,
    };
  }

  return { request };
}
