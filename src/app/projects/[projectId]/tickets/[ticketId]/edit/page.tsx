import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";
import { Id } from "@/domain/shared/id";
import { ConflictError } from "@/domain/shared/errors";
import { DbHeader } from "@/presentation/components/db-header";
import { TicketMetadataEditor } from "@/presentation/components/ticket-metadata-editor";
import { TicketMetadataDisplay } from "@/presentation/components/ticket-metadata-display";
import { ticketMetadataFromForm } from "@/presentation/ticket-metadata-form";
import { requirePageUser } from "@/presentation/page-auth";

export const dynamic = "force-dynamic";

export default async function EditTicketPage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string; ticketId: string }>;
  searchParams?: Promise<{ conflict?: string }>;
}) {
  await requirePageUser();
  const { projectId, ticketId } = await params;
  const c = getContainer();

  const ticket = await c.tickets.findById(Id.of<"Ticket">(ticketId));
  if (!ticket) notFound();
  if (!ticket.projectId.equals(Id.of<"Project">(projectId))) notFound();

  const epics = await c.listEpics.execute({ projectId });
  const snap = ticket.toSnapshot();
  const renderedVersion = ticket.persistenceVersion;
  const showConflict = (await searchParams)?.conflict === "1";

  async function save(formData: FormData) {
    "use server";
    await requirePageUser();
    const c = getContainer();
    const epicValue = String(formData.get("epicId") ?? "");
    try {
      await c.updateTicket.execute({
        ticketId,
        expectedVersion: renderedVersion,
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? ""),
        priority: formData.get("priority") as "p0" | "p1" | "p2",
        // empty string in select means "clear epic"
        epicId: epicValue === "" ? null : epicValue,
        ...ticketMetadataFromForm(formData),
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        redirect(`/projects/${projectId}/tickets/${ticketId}/edit?conflict=1`);
      }
      throw error;
    }
    redirect(`/projects/${projectId}`);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-slate-600 hover:underline"
        >
          ← Back to board
        </Link>
        <DbHeader />
      </div>
      <h1 className="mb-4 text-2xl font-bold">Edit ticket</h1>
      {showConflict && <p role="alert" data-testid="edit-conflict" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        Ticket changed since this form was opened. Your changes were not saved. Review the latest values and retry.
      </p>}
      <TicketMetadataDisplay tags={snap.tags} annotations={snap.annotations} origin={snap.origin} />
      <form key={renderedVersion ?? "unpersisted"} action={save} className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={snap.title}
            data-testid="edit-title"
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            defaultValue={snap.description}
            data-testid="edit-description"
            rows={4}
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              defaultValue={snap.priority}
              data-testid="edit-priority"
              className="w-full rounded border px-2 py-2"
            >
              <option value="p0">p0</option>
              <option value="p1">p1</option>
              <option value="p2">p2</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="epicId">
              Epic
            </label>
            <select
              id="epicId"
              name="epicId"
              defaultValue={snap.epicId ?? ""}
              data-testid="edit-epic"
              className="w-full rounded border px-2 py-2"
            >
              <option value="">No epic</option>
              {epics.map((e) => (
                <option key={e.id.value} value={e.id.value}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TicketMetadataEditor tags={snap.tags} annotations={snap.annotations} origin={snap.origin} />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="save-edit"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Save
          </button>
          <Link
            href={`/projects/${projectId}`}
            className="text-sm text-slate-600 hover:underline"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
