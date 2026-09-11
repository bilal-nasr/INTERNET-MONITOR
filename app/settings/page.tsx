import { SettingsForm } from "@/components/SettingsForm";

export const metadata = { title: "Settings - MikroTik Quota Monitor" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Changes take effect on the next poll. No redeploy needed.
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
