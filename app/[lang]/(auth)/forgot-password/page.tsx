import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.auth.forgot.title} - ${d.meta.appName}` };
}

export default async function ForgotPasswordPage() {
  const { d } = await getI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.auth.forgot.title}</h1>
        <p className="text-sm text-muted">{d.auth.forgot.subtitle}</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
