import { redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";

export const dynamic = "force-dynamic";

export default function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  async function action(formData: FormData) {
    "use server";
    const c = getContainer();
    try {
      const p = await c.createProject.execute({
        key: String(formData.get("key") ?? ""),
        name: String(formData.get("name") ?? ""),
      });
      redirect(`/projects/${p.id.value}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
      const msg = e instanceof Error ? e.message : "error";
      redirect(`/projects/new?error=${encodeURIComponent(msg)}`);
    }
  }

  return (
    <main className="mx-auto mt-16 max-w-md rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="mb-4 text-2xl font-bold">New Project</h1>
      <form action={action} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Key (2-10 letters)</label>
          <input
            name="key"
            required
            placeholder="PJM"
            data-testid="project-key"
            className="w-full rounded border px-3 py-2 uppercase"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            name="name"
            required
            placeholder="My project"
            data-testid="project-name"
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <SearchParamsError searchParams={searchParams} />
        <button
          type="submit"
          data-testid="create-project"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Create
        </button>
      </form>
    </main>
  );
}

async function SearchParamsError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.error) return null;
  return (
    <p data-testid="project-error" className="text-sm text-red-600">
      {sp.error}
    </p>
  );
}
