import { test as base, expect, type APIRequestContext } from "@playwright/test";

/**
 * Production stub cookies stay Secure. Chromium accepts loopback as trustworthy,
 * but Playwright's API cookie jar does not send Secure cookies over HTTP 127.0.0.1.
 * Explicitly forward only the existing signed test cookie to the exact disposable
 * loopback origin. No authentication bypass and no changes to production code.
 */
function loopbackCookieClient(api: APIRequestContext, baseURL: string | undefined): () => void {
  if (!baseURL) return () => {};
  const origin = new URL(baseURL);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") return () => {};
  if (!origin.port || origin.port === "3000") throw new Error("Loopback E2E requires an explicit disposable non-3000 port");
  const fetch = api.fetch.bind(api);
  api.fetch = async (input, options = {}) => {
    const target = new URL(typeof input === "string" ? input : input.url(), baseURL);
    if (target.origin !== origin.origin) throw new Error("E2E API client refused a different origin");
    const state = await api.storageState();
    const cookie = state.cookies.find(cookie => cookie.name === "alc_pjm_session" && cookie.domain === "127.0.0.1" && cookie.path === "/" &&
      (cookie.expires === -1 || cookie.expires > Date.now() / 1000));
    const headers = {...options.headers};
    if (cookie && !Object.keys(headers).some(name => name.toLowerCase() === "cookie")) headers.Cookie = cookie.name + "=" + cookie.value;
    return fetch(input, {...options, headers, maxRedirects: 0});
  };
  return () => {api.fetch = fetch;};
}

export const test = base.extend({
  request: async ({request, baseURL}, use) => {
    const restore = loopbackCookieClient(request, baseURL);
    try {await use(request);} finally {restore();}
  },
  context: async ({context, baseURL}, use) => {
    const restore = loopbackCookieClient(context.request, baseURL);
    try {await use(context);} finally {restore();}
  },
});
export { expect };
export type { Page } from "@playwright/test";
