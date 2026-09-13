import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
import { RouterScriptCard } from "@/components/RouterScriptCard";
import { SessionsList } from "@/components/SessionsList";
import { SettingsForm } from "@/components/SettingsForm";
import { ShareCard } from "@/components/ShareCard";
import { isSettingsTab } from "@/components/settings/tabs";
import { requireAuth } from "@/lib/auth/server";
import { getI18n } from "@/lib/i18n/server";
import { getSettings, toPublicSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.settings.title} - ${d.meta.appName}` };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ d, locale }, auth, settings, { tab }] = await Promise.all([
    getI18n(),
    requireAuth(),
    getSettings(),
    searchParams,
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.settings.title}</h1>
        <p className="text-sm text-muted">{d.settings.subtitle}</p>
      </div>
      <SettingsForm
        initial={toPublicSettings(settings)}
        initialTab={isSettingsTab(tab) ? tab : "limits"}
        routerScript={<RouterScriptCard interfaceName={settings.wan_interface_name} />}
        sharing={<ShareCard initialToken={settings.share_token} locale={locale} />}
        account={
          <>
            <AccountForm user={auth.user} />
            {/* Reads its rows itself, once the account tab is first opened. */}
            <SessionsList timezone={settings.timezone} />
          </>
        }
      />
    </div>
  );
}
