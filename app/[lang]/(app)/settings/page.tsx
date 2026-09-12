import type { Metadata } from "next";
import { AccountForm } from "@/components/AccountForm";
import { SessionsList } from "@/components/SessionsList";
import { SettingsForm } from "@/components/SettingsForm";
import { ShareCard } from "@/components/ShareCard";
import { requireAuth } from "@/lib/auth/server";
import { listSessions, toPublicSession } from "@/lib/auth/sessions";
import { getI18n } from "@/lib/i18n/server";
import { getSettings, toPublicSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.settings.title} - ${d.meta.appName}` };
}

export default async function SettingsPage() {
  const [{ d, locale }, auth, settings] = await Promise.all([getI18n(), requireAuth(), getSettings()]);
  const sessions = await listSessions(auth.user.id, auth.sessionId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.settings.title}</h1>
        <p className="text-sm text-muted">{d.settings.subtitle}</p>
      </div>
      <SettingsForm initial={toPublicSettings(settings)} />
      <AccountForm user={auth.user} />
      <ShareCard initialToken={settings.share_token} locale={locale} />
      <SessionsList initial={sessions.map(toPublicSession)} timezone={settings.timezone} />
    </div>
  );
}
