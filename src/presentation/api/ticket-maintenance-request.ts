import { NextResponse } from "next/server";
import { DomainError, ValidationError } from "@/domain/shared/errors";
import { toErrorResponse } from "./helpers";

/** Strict query parsing is additive: normal list/discovery semantics are unchanged. */
export function ticketMaintenanceQuery(params: URLSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = Object.create(null);
  for (const [key, value] of params) {
    if (!["automationIds", "limit", "archived", "cursor"].includes(key) || Object.hasOwn(input, key)) throw new ValidationError("Unknown or duplicate maintenance parameter");
    if (key === "automationIds") input[key] = value.split(",");
    else if (key === "limit") {
      if (!/^[0-9]+$/.test(value)) throw new ValidationError("Invalid maintenance limit");
      input[key] = Number(value);
    } else if (key === "archived") {
      if (value !== "true" && value !== "false") throw new ValidationError("archived must be true or false");
      input[key] = value === "true";
    } else input[key] = value;
  }
  return input;
}

export function ticketMaintenanceReceiptQuery(params: URLSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = Object.create(null);
  for (const [key, value] of params) {
    if (!["requestId", "automationIds"].includes(key) || Object.hasOwn(input, key)) throw new ValidationError("Unknown or duplicate maintenance receipt parameter");
    input[key] = key === "automationIds" ? value.split(",") : value;
  }
  return input;
}

/** Bound actual streamed bytes, not only a caller-supplied Content-Length. */
export async function readMaintenanceJson(request: Request): Promise<unknown> {
  const max = 512 * 1024;
  if (Number(request.headers.get("content-length")) > max || !request.body) throw new ValidationError("Invalid maintenance body size");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", {fatal: true});
  let bytes = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) {await reader.cancel(); throw new ValidationError("Invalid maintenance body size");}
      text += decoder.decode(chunk.value, {stream: true});
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {throw new ValidationError("Invalid maintenance JSON body");}
  finally {reader.releaseLock();}
}

/** Do not log raw source/evidence bodies, parser snippets or authentication/configuration causes. */
export function maintenanceErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) return toErrorResponse(error);
  return NextResponse.json({error: "INTERNAL", message: "Internal server error"}, {status: 500});
}
