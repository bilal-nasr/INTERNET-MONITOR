import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
import { RouterScriptCard } from "@/components/RouterScriptCard";
import { SettingsForm } from "@/components/SettingsForm";
import { requireAuth } from "@/lib/auth/server";
import { getI18n } from "@/lib/i18n/server";
import { getSettings, toPublicSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.settings.title} - ${d.meta.appName}` };
}

export default async function SettingsPage() {
  const [{ d }, auth, settings] = await Promise.all([getI18n(), requireAuth(), getSettings()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.settings.title}</h1>
        <p className="text-sm text-muted">{d.settings.subtitle}</p>
      </div>
      <SettingsForm initial={toPublicSettings(settings)} />
      <RouterScriptCard interfaceName={settings.wan_interface_name} />
      <AccountForm user={auth.user} />
    </div>
  );
}
