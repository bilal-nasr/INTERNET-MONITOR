import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { getI18n } from "@/lib/i18n/server";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.auth.login.title} - ${d.meta.appName}` };
}

export default async function LoginPage() {
  const [{ d }, siteKey] = await Promise.all([getI18n(), getTurnstileSiteKey()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.auth.login.title}</h1>
        <p className="text-sm text-muted">{d.auth.login.subtitle}</p>
      </div>
      {/* The form reads ?next= from the query string, which ties it to the request. */}
      <Suspense fallback={null}>
        <LoginForm siteKey={siteKey} />
      </Suspense>
    </div>
  );
}
