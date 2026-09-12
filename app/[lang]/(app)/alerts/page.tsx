import type { Metadata } from "next";
import { connection } from "next/server";
import { toPublicAlert } from "@/app/api/alerts/route";
import { AlertsTable } from "@/components/AlertsTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import { listAlerts } from "@/lib/alerts/log";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";

const LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.alerts.title} - ${d.meta.appName}` };
}

export default async function AlertsPage() {
  await connection();
  const { d } = await getI18n();
  const [settings, rows] = await Promise.all([getSettings(), listAlerts(LIMIT)]);
  const alerts = rows.map(toPublicAlert);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.alerts.title}</h1>
          <p className="text-sm text-muted">{fill(d.alerts.subtitle, { timezone: settings.timezone })}</p>
        </div>
        <AutoRefresh seconds={30} />
      </div>

      <AlertsTable alerts={alerts} timezone={settings.timezone} />

      {alerts.length === LIMIT && <p className="text-xs text-muted">{fill(d.alerts.showing, { count: LIMIT })}</p>}
    </div>
  );
}
