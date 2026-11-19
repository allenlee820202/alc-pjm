import type { Client, Flags } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";
import { resolveProjectId } from "../_shared/project-resolver.js";

export async function cmdEpicList(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  if (!project || typeof project !== "string") printError("--project is required");
  const projectId = await resolveProjectId(client, project);
  const result = await client.request("GET", `/api/epics?projectId=${projectId}`);
  if (!result.ok) printError("Failed to list epics", result.data);
  return (result.data as { epics: unknown[] }).epics;
}

export async function cmdEpicCreate(client: Client, flags: Flags): Promise<unknown> {
  const project = flags["project"];
  const name = flags["name"];
  if (!project || typeof project !== "string") printError("--project is required");
  if (!name || typeof name !== "string") printError("--name is required");
  const projectId = await resolveProjectId(client, project);
  const body: Record<string, unknown> = { projectId, name };
  if (typeof flags["description"] === "string") body.description = flags["description"];
  const result = await client.request("POST", "/api/epics", body);
  if (!result.ok) printError("Failed to create epic", result.data);
  return (result.data as { epic: unknown }).epic;
}
