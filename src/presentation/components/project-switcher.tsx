"use client";

import { useRouter } from "next/navigation";

interface ProjectOption {
  id: string;
  key: string;
}

export function ProjectSwitcher({
  current,
  projects,
}: {
  current: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  return (
    <select
      defaultValue={current}
      data-testid="project-switcher"
      className="rounded border border-slate-300 px-2 py-1 text-sm"
      onChange={(e) => {
        const next = e.target.value;
        if (next && next !== current) router.push(`/projects/${next}`);
      }}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.key}
        </option>
      ))}
    </select>
  );
}
