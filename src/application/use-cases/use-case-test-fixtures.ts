import { CreateProjectUseCase } from "./create-project";
import { CreateEpicUseCase } from "./create-epic";
import { CreateTicketUseCase } from "./create-ticket";
import { ListTicketsUseCase } from "./list-tickets";
import { UpdateTicketUseCase } from "./update-ticket";
import { TransitionTicketUseCase } from "./transition-ticket";
import { ReleaseTicketUseCase, TakeTicketUseCase } from "./take-ticket";
import { ArchiveTicketUseCase, UnarchiveTicketUseCase } from "./archive-ticket";
import { AddTicketDependencyUseCase } from "./add-ticket-dependency";
import { RemoveTicketDependencyUseCase } from "./remove-ticket-dependency";
import { ListTicketDependenciesUseCase } from "./list-ticket-dependencies";
import { GetNextQueueTicketUseCase } from "./get-next-queue-ticket";
import { ListMineQueueTicketsUseCase } from "./list-mine-queue-tickets";
import { InMemoryProjectRepository } from "@/infrastructure/repositories/in-memory-project-repository";
import { InMemoryEpicRepository } from "@/infrastructure/repositories/in-memory-epic-repository";
import { InMemoryTicketRepository } from "@/infrastructure/repositories/in-memory-ticket-repository";
import { InMemoryTicketDependencyRepository } from "@/infrastructure/repositories/in-memory-ticket-dependency-repository";
import { InMemoryTicketQueueRepository } from "@/infrastructure/repositories/in-memory-ticket-queue-repository";

export function createUseCaseFixtures() {
  const projects = new InMemoryProjectRepository();
  const epics = new InMemoryEpicRepository();
  const tickets = new InMemoryTicketRepository();
  const ticketDeps = new InMemoryTicketDependencyRepository(tickets.state);
  const createProject = new CreateProjectUseCase(projects);
  const createEpic = new CreateEpicUseCase(projects, epics);
  const createTicket = new CreateTicketUseCase(projects, epics, tickets);
  const listTickets = new ListTicketsUseCase(tickets);
  const updateTicket = new UpdateTicketUseCase(tickets, epics);
  const transitionTicket = new TransitionTicketUseCase(tickets);
  const takeTicket = new TakeTicketUseCase(tickets);
  const releaseTicket = new ReleaseTicketUseCase(tickets);
  const archiveTicket = new ArchiveTicketUseCase(tickets);
  const unarchiveTicket = new UnarchiveTicketUseCase(tickets);
  const addDep = new AddTicketDependencyUseCase(tickets, ticketDeps);
  const removeDep = new RemoveTicketDependencyUseCase(ticketDeps);
  const listDeps = new ListTicketDependenciesUseCase(tickets, ticketDeps);
  const ticketQueue = new InMemoryTicketQueueRepository(tickets, ticketDeps);
  const getNextQueueTicket = new GetNextQueueTicketUseCase(ticketQueue);
  const listMineQueueTickets = new ListMineQueueTicketsUseCase(ticketQueue);

  async function makeProject() {
    return createProject.execute({ key: "PJM", name: "P" });
  }

  async function makeTicket(projectId: string, title: string) {
    return createTicket.execute({
      projectId,
      type: "task",
      title,
      priority: "p1",
    });
  }

  return {
    projects,
    epics,
    tickets,
    ticketDeps,
    createProject,
    createEpic,
    createTicket,
    listTickets,
    updateTicket,
    transitionTicket,
    takeTicket,
    releaseTicket,
    archiveTicket,
    unarchiveTicket,
    addDep,
    removeDep,
    listDeps,
    getNextQueueTicket,
    listMineQueueTickets,
    makeProject,
    makeTicket,
  };
}
