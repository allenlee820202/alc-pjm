import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";
import { Id } from "@/domain/shared/id";
import { ProjectSwitcher } from "@/presentation/components/project-switcher";
import { StatusSelect } from "@/presentation/components/status-select";
import { ArchiveButton } from "@/presentation/components/archive-button";

export const dynamic = "force-dynamic";

const PRIORITY_BADGE: Record<string, string> = {
  p0: "bg-red-100 text-red-800 border-red-300",
  p1: "bg-orange-100 text-orange-800 border-orange-300",
  p2: "bg-yellow-100 text-yellow-800 border-yellow-300",
};

const TYPE_BADGE: Record<string, string> = {
  story: "bg-green-100 text-green-800",
  task: "bg-blue-100 text-blue-800",
  subtask: "bg-slate-100 text-slate-800",
  bug: "bg-red-100 text-red-800",
};

const COLUMNS: Array<{ key: "todo" | "in_progress" | "done"; label: string }> = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const c = getContainer();

  let project;
  try {
    project = await c.projects.findById(Id.of<"Project">(projectId));
  } catch {
    notFound();
  }
  if (!project) notFound();

  const [epics, allTickets, allProjects] = await Promise.all([
    c.listEpics.execute({ projectId }),
    c.listTickets.execute({ projectId }),
    c.listProjects.execute(),
  ]);

  async function createEpic(formData: FormData) {
    "use server";
    const c = getContainer();
    await c.createEpic.execute({
      projectId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
    });
    redirect(`/projects/${projectId}`);
  }

  async function createTicket(formData: FormData) {
    "use server";
    const c = getContainer();
    const epicIdRaw = String(formData.get("epicId") ?? "");
    const parentIdRaw = String(formData.get("parentTicketId") ?? "");
    await c.createTicket.execute({
      projectId,
      epicId: epicIdRaw || null,
      parentTicketId: parentIdRaw || null,
      type: String(formData.get("type") ?? "task"),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      priority: String(formData.get("priority") ?? "p2"),
    });
    redirect(`/projects/${projectId}`);
  }

  async function logout() {
    "use server";
    await getContainer().auth.signOut();
    redirect("/login");
  }

  const ticketsByStatus = {
    todo: [] as typeof allTickets,
    in_progress: [] as typeof allTickets,
    done: [] as typeof allTickets,
  };
  for (const t of allTickets) {
    ticketsByStatus[t.status.value].push(t);
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">
            <span className="text-slate-500">{project.key}</span> · {project.name}
          </h1>
          {allProjects.length > 1 && (
            <ProjectSwitcher
              current={projectId}
              projects={allProjects.map((p) => ({ id: p.id.value, key: p.key }))}
            />
          )}
        </div>
        <form action={logout}>
          <button className="text-sm text-slate-600 hover:text-slate-900">Sign out</button>
        </form>
      </header>

      <section className="mb-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Create Epic</h2>
          <form action={createEpic} className="space-y-3">
            <input
              name="name"
              required
              placeholder="Epic name"
              data-testid="epic-name"
              className="w-full rounded border px-3 py-2"
            />
            <textarea
              name="description"
              placeholder="Description (optional)"
              className="w-full rounded border px-3 py-2"
              rows={2}
            />
            <button
              type="submit"
              data-testid="create-epic"
              className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
            >
              Add epic
            </button>
          </form>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Create Ticket</h2>
          <form action={createTicket} className="space-y-3">
            <input
              name="title"
              required
              placeholder="Title"
              data-testid="ticket-title"
              className="w-full rounded border px-3 py-2"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                name="type"
                defaultValue="task"
                data-testid="ticket-type"
                className="rounded border px-2 py-2"
              >
                <option value="story">story</option>
                <option value="task">task</option>
                <option value="subtask">subtask</option>
                <option value="bug">bug</option>
              </select>
              <select
                name="priority"
                defaultValue="p2"
                data-testid="ticket-priority"
                className="rounded border px-2 py-2"
              >
                <option value="p0">p0</option>
                <option value="p1">p1</option>
                <option value="p2">p2</option>
              </select>
              <select name="epicId" defaultValue="" className="rounded border px-2 py-2">
                <option value="">No epic</option>
                {epics.map((e) => (
                  <option key={e.id.value} value={e.id.value}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <select
              name="parentTicketId"
              defaultValue=""
              className="w-full rounded border px-2 py-2 text-sm"
            >
              <option value="">No parent (only required for subtask)</option>
              {allTickets
                .filter((t) => t.type.canBeParent())
                .map((t) => (
                  <option key={t.id.value} value={t.id.value}>
                    {t.type.value}: {t.title}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              data-testid="create-ticket"
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Add ticket
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Epics</h2>
        {epics.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">No epics yet.</p>
        ) : (
          <ul className="mb-6 grid gap-2 md:grid-cols-3">
            {epics.map((e) => (
              <li
                key={e.id.value}
                data-testid="epic-row"
                className="rounded border bg-white p-3 shadow-sm"
              >
                <div className="font-medium">{e.name}</div>
                {e.description && (
                  <div className="text-sm text-slate-600">{e.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-3 text-lg font-semibold">Board ({allTickets.length})</h2>
        {allTickets.length === 0 ? (
          <p className="text-sm text-slate-500">No tickets yet. Create one above.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3" data-testid="kanban">
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                data-testid={`column-${col.key}`}
                className="rounded-lg border bg-slate-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-600">
                  <span>{col.label}</span>
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">
                    {ticketsByStatus[col.key].length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {ticketsByStatus[col.key].map((t) => {
                    const s = t.toSnapshot();
                    const epic = epics.find((e) => e.id.value === s.epicId);
                    return (
                      <li
                        key={s.id}
                        data-testid="ticket-row"
                        data-ticket-id={s.id}
                        className="rounded border bg-white p-3 shadow-sm"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded border px-2 py-0.5 text-xs font-bold uppercase ${PRIORITY_BADGE[s.priority]}`}
                          >
                            {s.priority}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${TYPE_BADGE[s.type]}`}
                          >
                            {s.type}
                          </span>
                          {epic && (
                            <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                              {epic.name}
                            </span>
                          )}
                        </div>
                        <div className="mb-2 font-medium">{s.title}</div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <Link
                              href={`/projects/${projectId}/tickets/${s.id}/edit`}
                              data-testid={`edit-${s.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              Edit
                            </Link>
                            <ArchiveButton ticketId={s.id} />
                          </div>
                          <StatusSelect ticketId={s.id} current={s.status} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
