import type { Client, Flags } from "../_shared/cli-types.js";
import { printError } from "../_shared/output.js";

export async function cmdProjectList(client: Client): Promise<unknown> {
  const result = await client.request("GET", "/api/projects");
  if (!result.ok) printError("Failed to list projects", result.data);
  return (result.data as { projects: unknown[] }).projects;
}

export async function cmdProjectCreate(client: Client, flags: Flags): Promise<unknown> {
  const key = flags["key"];
  const name = flags["name"];
  if (!key || typeof key !== "string") printError("--key is required");
  if (!name || typeof name !== "string") printError("--name is required");
  const result = await client.request("POST", "/api/projects", { key, name });
  if (!result.ok) printError("Failed to create project", result.data);
  return (result.data as { project: unknown }).project;
}
