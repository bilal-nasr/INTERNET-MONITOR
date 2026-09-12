import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ShareGate } from "@/components/ShareGate";
import { CycleGauge } from "@/components/stats/CycleGauge";
import { StatusCard } from "@/components/StatusCard";
import { UsageProgress } from "@/components/UsageProgress";
import { getI18n } from "@/lib/i18n/server";
import { getLatestSessionSummary } from "@/lib/sessions";
import { getSettings, getShareToken } from "@/lib/settings";
import { tokensMatch } from "@/lib/share";
import { getCycleUsage } from "@/lib/stats";
import { SHARE_PASS_COOKIE, getTurnstileSiteKey, sharePassValid } from "@/lib/turnstile";
import { getTodayUsage } from "@/lib/usage";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.share.pageTitle} - ${d.meta.appName}`, robots: { index: false, follow: false } };
}

/**
 * The dashboard's three cards, behind the share token instead of a sign-in.
 * A wrong token is a 404: the page neither confirms that sharing is on nor
 * offers a place to try again.
 *
 * The token is read from the database, not from the cached settings row: a
 * link that was replaced or turned off has to stop working now, on every
 * instance, not when this one's memo happens to lapse.
 *
 * With Turnstile on, a browser without a live share pass gets the check in
 * place of the figures. The token is confirmed first, so a wrong link is still
 * a plain 404 and never shows the widget.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const shareToken = await getShareToken();
  if (!shareToken || !tokensMatch(token, shareToken)) notFound();

  const [siteKey, cookieStore] = await Promise.all([getTurnstileSiteKey(), cookies()]);
  if (siteKey && !sharePassValid(cookieStore.get(SHARE_PASS_COOKIE)?.value, shareToken)) {
    return <ShareGate shareToken={shareToken} siteKey={siteKey} />;
  }

  const settings = await getSettings();
  const { d } = await getI18n();
  const [usage, session, cycle] = await Promise.all([
    getTodayUsage(settings),
    getLatestSessionSummary(),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.share.pageTitle}</h1>
          <p className="text-sm text-muted">{usage.date}</p>
        </div>
        <AutoRefresh seconds={30} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <UsageProgress usage={usage} />
        <StatusCard
          usage={usage}
          pollingEnabled={settings.polling_enabled}
          interfaceName={settings.wan_interface_name}
          session={session}
          // The owner's setting, so a viewer sees "No contact" at the same
          // moment the owner does rather than at the card's own fallback.
          // staleAfterMinutes is a threshold; staleAlertAt is withheld on
          // purpose, since when the owner was emailed is none of this page's
          // business.
          staleAfterMinutes={settings.stale_after_minutes}
        />
      </div>

      <CycleGauge cycle={cycle} timezone={settings.timezone} />
    </div>
  );
}
