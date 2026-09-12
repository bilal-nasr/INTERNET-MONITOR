import { Nav } from "@/components/Nav";
import { requireAuth } from "@/lib/auth/server";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";

/**
 * Every page that shows data lives under this layout, so the session check
 * here is the one that guards them all. The proxy already redirected anyone
 * without a session; this is the check that does not depend on the proxy.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ d }, auth] = await Promise.all([getI18n(), requireAuth()]);

  return (
    <>
      <Nav username={auth.user.username} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-500 sm:px-6">
        <Interpolate template={d.footer.ingest} values={{ path: <code>/api/ingest</code> }} />
      </footer>
    </>
  );
}
