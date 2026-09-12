import type { Metadata } from "next";
import { SettingsForm } from "@/components/SettingsForm";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.settings.title} - ${d.meta.appName}` };
}

export default async function SettingsPage() {
  const { d } = await getI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.settings.title}</h1>
        <p className="text-sm text-muted">{d.settings.subtitle}</p>
      </div>
      <SettingsForm />
    </div>
  );
}
