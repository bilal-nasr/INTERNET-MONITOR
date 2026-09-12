import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
import { SettingsForm } from "@/components/SettingsForm";
import { requireAuth } from "@/lib/auth/server";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.settings.title} - ${d.meta.appName}` };
}

export default async function SettingsPage() {
  const [{ d }, auth] = await Promise.all([getI18n(), requireAuth()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.settings.title}</h1>
        <p className="text-sm text-muted">{d.settings.subtitle}</p>
      </div>
      <SettingsForm />
      <AccountForm user={auth.user} />
    </div>
  );
}
