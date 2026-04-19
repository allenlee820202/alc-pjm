import type { ProjectRepository } from "@/application/ports/project-repository";
import type { EpicRepository } from "@/application/ports/epic-repository";
import type { TicketRepository } from "@/application/ports/ticket-repository";
import type { AuthService } from "@/application/ports/auth-service";

import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { SqliteProjectRepository } from "@/infrastructure/repositories/sqlite-project-repository";
import { SqliteEpicRepository } from "@/infrastructure/repositories/sqlite-epic-repository";
import { SqliteTicketRepository } from "@/infrastructure/repositories/sqlite-ticket-repository";
import { openDatabase, type DatabaseType } from "@/infrastructure/sqlite/database";
import { resolveDbPath, persistDbPath } from "@/infrastructure/sqlite/db-path";
import { StubAuthService } from "@/infrastructure/auth/stub-auth-service";

import { CreateProjectUseCase } from "@/application/use-cases/create-project";
import { CreateEpicUseCase } from "@/application/use-cases/create-epic";
import { CreateTicketUseCase } from "@/application/use-cases/create-ticket";
import { ListProjectsUseCase } from "@/application/use-cases/list-projects";
import { ListEpicsUseCase } from "@/application/use-cases/list-epics";
import { ListTicketsUseCase } from "@/application/use-cases/list-tickets";
import { UpdateTicketUseCase } from "@/application/use-cases/update-ticket";
import { TransitionTicketUseCase } from "@/application/use-cases/transition-ticket";
import {
  ArchiveTicketUseCase,
  UnarchiveTicketUseCase,
} from "@/application/use-cases/archive-ticket";

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
  updateTicket: UpdateTicketUseCase;
  transitionTicket: TransitionTicketUseCase;
  archiveTicket: ArchiveTicketUseCase;
  unarchiveTicket: UnarchiveTicketUseCase;
  /** Mode currently in use ("memory" | "sqlite" | "supabase"). */
  repoMode: string;
  /** Absolute path of the SQLite file when repoMode === "sqlite", else null. */
  dbPath: string | null;
  /** Underlying SQLite handle, kept here so we can close it on swap. */
  _db: DatabaseType | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __ALC_PJM_CONTAINER__: Container | undefined;
}

function buildContainer(): Container {
  // Default to sqlite for local development; tests/scripts override with
  // REPO_MODE=memory. Supabase is reserved for the future cloud adapter.
  const repoMode = process.env.REPO_MODE ?? "sqlite";
  const authMode = process.env.AUTH_MODE ?? "stub";

  let projects: ProjectRepository;
  let epics: EpicRepository;
  let tickets: TicketRepository;
  let db: DatabaseType | null = null;
  let dbPath: string | null = null;

  if (repoMode === "sqlite") {
    dbPath = resolveDbPath();
    db = openDatabase(dbPath);
    projects = new SqliteProjectRepository(db);
    epics = new SqliteEpicRepository(db);
    tickets = new SqliteTicketRepository(db);
  } else {
    if (repoMode !== "memory") {
      // eslint-disable-next-line no-console
      console.warn(
        `REPO_MODE=${repoMode} requested but only "sqlite" and "memory" are wired. Falling back to memory.`,
      );
    }
    projects = new InMemoryProjectRepository();
    epics = new InMemoryEpicRepository();
    tickets = new InMemoryTicketRepository();
  }

  let auth: AuthService = new StubAuthService();
  if (authMode === "supabase") {
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
    updateTicket: new UpdateTicketUseCase(tickets, epics),
    transitionTicket: new TransitionTicketUseCase(tickets),
    archiveTicket: new ArchiveTicketUseCase(tickets),
    unarchiveTicket: new UnarchiveTicketUseCase(tickets),
    repoMode,
    dbPath,
    _db: db,
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

/**
 * Switch the active SQLite database file at runtime. Persists the choice so
 * the next process start uses the same file. No-op (and throws) when not in
 * sqlite mode.
 */
export function switchSqliteDatabase(newPath: string): { dbPath: string } {
  const current = getContainer();
  if (current.repoMode !== "sqlite") {
    throw new Error(
      `Cannot switch database file when REPO_MODE="${current.repoMode}". Only "sqlite" is supported.`,
    );
  }
  const abs = persistDbPath(newPath);
  current._db?.close();
  // Drop the cached container so the next getContainer() call rebuilds with
  // the new file. The seed runs again only if the new file is empty.
  globalThis.__ALC_PJM_CONTAINER__ = undefined;
  return { dbPath: abs };
}
