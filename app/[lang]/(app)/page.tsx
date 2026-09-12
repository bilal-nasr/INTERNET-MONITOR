import { connection } from "next/server";
import { AnomalyList } from "@/components/AnomalyList";
import { AutoRefresh } from "@/components/AutoRefresh";
import { HistoryChart } from "@/components/HistoryChart";
import { SetupChecklist } from "@/components/SetupChecklist";
import { CycleGauge } from "@/components/stats/CycleGauge";
import { StatusCard } from "@/components/StatusCard";
import { ThroughputCard } from "@/components/ThroughputCard";
import { UsageProgress } from "@/components/UsageProgress";
import { latestAlert } from "@/lib/alerts/log";
import { flagAnomalies } from "@/lib/anomaly";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import { getLatestSessionSummary } from "@/lib/sessions";
import { getSettings, type SettingsRow } from "@/lib/settings";
import { setupStatus } from "@/lib/setup-status";
import { getCycleUsage } from "@/lib/stats";
import { ratesFromReadings } from "@/lib/throughput";
import { getDailyHistory, getLatestReading, getRecentReadings, getTodayUsage } from "@/lib/usage";

/** Span of the throughput sparkline. Sixty pushes at the router's 30-second interval. */
const THROUGHPUT_MINUTES = 30;

export default async function DashboardPage() {
  await connection();

  const { d } = await getI18n();

  let settings: SettingsRow;
  try {
    settings = await getSettings();
  } catch (err) {
    return <SetupError message={err instanceof Error ? err.message : String(err)} />;
  }

  const [usage, history, session, cycle, staleAlert, latest, recent] = await Promise.all([
    getTodayUsage(settings),
    getDailyHistory(30, settings.timezone),
    getLatestSessionSummary(),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone),
    latestAlert("link_stale", "link").catch(() => null),
    getLatestReading(),
    getRecentReadings(THROUGHPUT_MINUTES),
  ]);
  const rates = ratesFromReadings(recent);
  const anomalies = flagAnomalies(history);

  if (!latest) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{d.dashboard.title}</h1>
            <p className="text-sm text-muted">{usage.date}</p>
          </div>
          <AutoRefresh seconds={15} />
        </div>
        <SetupChecklist status={setupStatus(settings, process.env)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.dashboard.title}</h1>
          <p className="text-sm text-muted">{usage.date}</p>
        </div>
        <AutoRefresh seconds={15} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <UsageProgress usage={usage} />
        <StatusCard
          usage={usage}
          pollingEnabled={settings.polling_enabled}
          interfaceName={settings.wan_interface_name}
          session={session}
          staleAfterMinutes={settings.stale_after_minutes}
          // Only a mail that actually went out. latestAlert returns the newest
          // row whatever its status, and a "failed" (mail misconfigured) or
          // "skipped" (no recipient) row would otherwise make the card claim
          // the user was emailed when nobody was.
          staleAlertAt={staleAlert?.status === "sent" ? staleAlert.created_at.toISOString() : null}
        />
      </div>

      <ThroughputCard rates={rates} minutes={THROUGHPUT_MINUTES} timezone={settings.timezone} />

      <CycleGauge cycle={cycle} timezone={settings.timezone} />

      <HistoryChart
        history={history}
        quotaGb={settings.quota_gb}
        today={usage.date}
        anomalies={anomalies.map((a) => a.day)}
      />
      <AnomalyList flags={anomalies} />
    </div>
  );
}

async function SetupError({ message }: { message: string }) {
  const { d } = await getI18n();
  return (
    <div className="rounded-xl border border-status-critical/40 bg-status-critical/5 p-5">
      <h1 className="font-semibold text-status-critical">{d.setupError.title}</h1>
      <p className="mt-2 text-sm">
        <Interpolate
          template={d.setupError.body}
          values={{
            table: <code>settings</code>,
            variable: <code>DATABASE_URL</code>,
            file: <code>schema.sql</code>,
          }}
        />
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-3 text-xs text-muted">{message}</pre>
    </div>
  );
}
