import { redirect } from "next/navigation";
import { getContainer } from "@/infrastructure/container";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const c = getContainer();
  const user = await c.auth.getCurrentUser();
  if (user) redirect(sp.redirect ?? "/");

  async function loginAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const redirectTo = String(formData.get("redirect") ?? "/");
    try {
      await getContainer().auth.signIn(email, password);
    } catch {
      redirect(`/login?error=invalid&redirect=${encodeURIComponent(redirectTo)}`);
    }
    redirect(redirectTo);
  }

  return (
    <main className="mx-auto mt-24 max-w-sm rounded-lg border bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold">Sign in</h1>
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="redirect" value={sp.redirect ?? "/"} />
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={process.env.STUB_AUTH_EMAIL ?? "demo@example.com"}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        {sp.error && (
          <p data-testid="login-error" className="text-sm text-red-600">
            Invalid email or password
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-blue-600 py-2 font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </button>
        <p className="text-xs text-slate-500">
          Default demo: <code>demo@example.com</code> / <code>demo1234</code>
        </p>
      </form>
    </main>
  );
}
