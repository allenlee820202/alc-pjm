import type { ProjectRepository } from "@/application/ports/project-repository";
import type { EpicRepository } from "@/application/ports/epic-repository";
import type { TicketRepository } from "@/application/ports/ticket-repository";
import type { AuthService } from "@/application/ports/auth-service";

import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { StubAuthService } from "@/infrastructure/auth/stub-auth-service";

import { CreateProjectUseCase } from "@/application/use-cases/create-project";
import { CreateEpicUseCase } from "@/application/use-cases/create-epic";
import { CreateTicketUseCase } from "@/application/use-cases/create-ticket";
import { ListProjectsUseCase } from "@/application/use-cases/list-projects";
import { ListEpicsUseCase } from "@/application/use-cases/list-epics";
import { ListTicketsUseCase } from "@/application/use-cases/list-tickets";

interface Container {
  projects: ProjectRepository;
  epics: EpicRepository;
  tickets: TicketRepository;
  auth: AuthService;
  createProject: CreateProjectUseCase;
  createEpic: CreateEpicUseCase;
  createTicket: CreateTicketUseCase;
  listProjects: ListProjectsUseCase;
  listEpics: ListEpicsUseCase;
  listTickets: ListTicketsUseCase;
}

declare global {
  // eslint-disable-next-line no-var
  var __ALC_PJM_CONTAINER__: Container | undefined;
}

function buildContainer(): Container {
  const repoMode = process.env.REPO_MODE ?? "memory";
  const authMode = process.env.AUTH_MODE ?? "stub";

  // For now only the in-memory repository is wired; a Supabase adapter can be
  // dropped in here once the cloud project is provisioned.
  if (repoMode !== "memory") {
    // eslint-disable-next-line no-console
    console.warn(
      `REPO_MODE=${repoMode} requested but only "memory" is wired. Falling back to in-memory.`,
    );
  }

  const projects = new InMemoryProjectRepository();
  const epics = new InMemoryEpicRepository();
  const tickets = new InMemoryTicketRepository();

  // Auth wiring. The supabase adapter is loaded lazily via dynamic import so
  // it never gets bundled when AUTH_MODE=stub.
  let auth: AuthService = new StubAuthService();
  if (authMode === "supabase") {
    // Loaded synchronously by side-effect after first request; until then the
    // stub auth fronts the request lifecycle. In practice in production we set
    // the env at boot and import eagerly.
    import("@/infrastructure/auth/supabase-auth-service").then((mod) => {
      auth = new mod.SupabaseAuthService();
      if (globalThis.__ALC_PJM_CONTAINER__) {
        globalThis.__ALC_PJM_CONTAINER__.auth = auth;
      }
    });
  }

  // Seed a demo project so the UI is not empty on first run.
  void (async () => {
    if ((await projects.list()).length === 0) {
      const { Project } = await import("@/domain/project/project");
      await projects.save(Project.create({ key: "DEMO", name: "Demo Project" }));
    }
  })();

  return {
    projects,
    epics,
    tickets,
    auth,
    createProject: new CreateProjectUseCase(projects),
    createEpic: new CreateEpicUseCase(projects, epics),
    createTicket: new CreateTicketUseCase(projects, epics, tickets),
    listProjects: new ListProjectsUseCase(projects),
    listEpics: new ListEpicsUseCase(epics),
    listTickets: new ListTicketsUseCase(tickets),
  };
}

/**
 * The container is cached on globalThis so dev-mode HMR and the in-memory
 * stores survive across hot reloads. In production this is also fine because
 * the module is initialized once per server instance.
 */
export function getContainer(): Container {
  if (!globalThis.__ALC_PJM_CONTAINER__) {
    globalThis.__ALC_PJM_CONTAINER__ = buildContainer();
  }
  return globalThis.__ALC_PJM_CONTAINER__;
}
