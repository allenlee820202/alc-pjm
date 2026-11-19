import type { createClient } from "./http.js";
import { printError } from "./output.js";

interface ProjectSnapshot {
  id: string;
  key: string;
  name: string;
  [k: string]: unknown;
}

let projectCache: ProjectSnapshot[] | null = null;

async function fetchProjects(
  client: ReturnType<typeof createClient>,
): Promise<ProjectSnapshot[]> {
  if (projectCache) return projectCache;
  const result = await client.request("GET", "/api/projects");
  if (!result.ok) {
    printError("Failed to fetch projects", result.data);
  }
  const data = result.data as { projects: ProjectSnapshot[] };
  projectCache = data.projects;
  return projectCache;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function resolveProjectId(
  client: ReturnType<typeof createClient>,
  keyOrId: string,
): Promise<string> {
  if (isUuid(keyOrId)) return keyOrId;
  const projects = await fetchProjects(client);
  const match = projects.find(
    (p) => p.key.toLowerCase() === keyOrId.toLowerCase(),
  );
  if (!match) {
    return printError(`Project not found by key: ${keyOrId}`);
  }
  return match.id;
}
