import { Nav } from "@/components/Nav";
import { requireAuth } from "@/lib/auth/server";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";

/**
 * Every page that shows data lives under this layout, so the session check
 * here is the one that guards them all. The proxy already redirected anyone
 * without a session; this is the check that does not depend on the proxy.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ d }, auth, devicesEnabled] = await Promise.all([
    getI18n(),
    requireAuth(),
    // The dashboard explains a missing settings row itself; the header must
    // not be the thing that breaks first. Hiding the Devices link is the right
    // fallback, but it looks identical to the owner having switched per-device
    // tracking off, so the reason is logged: a database outage that quietly
    // removes a navigation item is otherwise indistinguishable from a setting.
    getSettings().then(
      (s) => s.devices_enabled,
      (err) => {
        console.warn("[layout] could not read settings; hiding the Devices link", err);
        return false;
      },
    ),
  ]);

  return (
    <>
      <Nav username={auth.user.username} devicesEnabled={devicesEnabled} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-500 sm:px-6">
        <Interpolate template={d.footer.ingest} values={{ path: <code>/api/ingest</code> }} />
      </footer>
    </>
  );
}
