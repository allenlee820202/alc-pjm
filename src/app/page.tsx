import Link from "next/link";
import { redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const c = getContainer();
  const user = await c.auth.getCurrentUser();
  if (!user) redirect("/login");
  const projects = await c.listProjects.execute();
  if (projects.length > 0) redirect(`/projects/${projects[0].id.value}`);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-2xl font-bold">No projects yet</h1>
      <Link
        href="/projects/new"
        className="inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Create your first project
      </Link>
    </main>
  );
}
