import { connection } from "next/server";
import { HistoryChart } from "@/components/HistoryChart";
import { StatusCard, type RouterStatus } from "@/components/StatusCard";
import { UsageProgress } from "@/components/UsageProgress";
import { fetchWanCounters } from "@/lib/router";
import { getSettings, type SettingsRow } from "@/lib/settings";
import { getDailyHistory, getTodayUsage } from "@/lib/usage";

async function liveRouterStatus(settings: SettingsRow): Promise<RouterStatus> {
  if (!settings.polling_enabled) return { state: "paused" };
  // No router host means push mode: the router posts readings to /api/ingest.
  if (!settings.router_host) return { state: "push" };
  if (!settings.router_user || !settings.router_pass) {
    return { state: "not_configured", message: "Set router user and password in Settings" };
  }
  try {
    const c = await fetchWanCounters(
      {
        host: settings.router_host,
        user: settings.router_user,
        pass: settings.router_pass,
        wanInterfaceName: settings.wan_interface_name,
      },
      5_000,
    );
    if (c.disabled) return { state: "disabled", name: c.name };
    return c.running ? { state: "running", name: c.name } : { state: "down", name: c.name };
  } catch (err) {
    return { state: "unreachable", message: err instanceof Error ? err.message : String(err) };
  }
}

export default async function DashboardPage() {
  await connection();

  let settings: SettingsRow;
  try {
    settings = await getSettings();
  } catch (err) {
    return <SetupError message={err instanceof Error ? err.message : String(err)} />;
  }

  const [usage, history, router] = await Promise.all([
    getTodayUsage(settings),
    getDailyHistory(30, settings.timezone),
    liveRouterStatus(settings),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted">{usage.date}, updated on every page load</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <UsageProgress usage={usage} />
        <StatusCard usage={usage} router={router} pollingEnabled={settings.polling_enabled} />
      </div>

      <HistoryChart history={history} quotaGb={settings.quota_gb} />
    </div>
  );
}

function SetupError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-status-critical/40 bg-status-critical/5 p-5">
      <h1 className="font-semibold text-status-critical">Database not ready</h1>
      <p className="mt-2 text-sm">
        The dashboard could not read the <code>settings</code> table. Check <code>DATABASE_URL</code> and run{" "}
        <code>schema.sql</code> against the database (see README).
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-3 text-xs text-muted">{message}</pre>
    </div>
  );
}
