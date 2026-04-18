import { Ticket } from "@/domain/ticket/ticket";
import { Priority } from "@/domain/ticket/priority";
import { TicketType } from "@/domain/ticket/ticket-type";
import { Id } from "@/domain/shared/id";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { ProjectRepository } from "../ports/project-repository";
import type { EpicRepository } from "../ports/epic-repository";
import type { TicketRepository } from "../ports/ticket-repository";

export interface CreateTicketInput {
  projectId: string;
  epicId?: string | null;
  parentTicketId?: string | null;
  type: string;
  title: string;
  description?: string;
  priority: string;
}

/**
 * Orchestrates ticket creation:
 *   1. Validates the project exists.
 *   2. If epicId is provided, validates the epic exists and belongs to the project.
 *   3. If parentTicketId is provided, fetches it so the domain can enforce the
 *      "subtasks under non-subtask parents only" invariant. Also enforces the
 *      same-project rule (a subtask must belong to the same project as its parent).
 */
export class CreateTicketUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly epics: EpicRepository,
    private readonly tickets: TicketRepository,
  ) {}

  async execute(input: CreateTicketInput): Promise<Ticket> {
    const projectId = Id.of<"Project">(input.projectId);
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundError("Project", projectId.value);

    let epicId = null;
    if (input.epicId) {
      epicId = Id.of<"Epic">(input.epicId);
      const epic = await this.epics.findById(epicId);
      if (!epic) throw new NotFoundError("Epic", epicId.value);
      if (!epic.projectId.equals(projectId)) {
        throw new ValidationError("Epic does not belong to the specified project");
      }
    }

    let parentTicketId = null;
    let parentTicketType = null;
    if (input.parentTicketId) {
      parentTicketId = Id.of<"Ticket">(input.parentTicketId);
      const parent = await this.tickets.findById(parentTicketId);
      if (!parent) throw new NotFoundError("Ticket", parentTicketId.value);
      if (!parent.projectId.equals(projectId)) {
        throw new ValidationError("Parent ticket does not belong to the specified project");
      }
      parentTicketType = parent.type;
    }

    const ticket = Ticket.create({
      projectId,
      epicId,
      parentTicketId,
      parentTicketType,
      type: TicketType.of(input.type),
      title: input.title,
      description: input.description,
      priority: Priority.of(input.priority),
    });

    await this.tickets.save(ticket);
    return ticket;
  }
}
