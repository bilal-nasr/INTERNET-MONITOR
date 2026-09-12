import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { looksLikeToken } from "@/lib/auth/tokens";
import { getI18n } from "@/lib/i18n/server";
import { getTurnstileSiteKey } from "@/lib/turnstile";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.auth.reset.title} - ${d.meta.appName}` };
}

type Search = Record<string, string | string[] | undefined>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [{ locale, d }, params, siteKey] = await Promise.all([getI18n(), searchParams, getTurnstileSiteKey()]);
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.auth.reset.title}</h1>
        <p className="text-sm text-muted">{d.auth.reset.subtitle}</p>
      </div>
      {looksLikeToken(token) ? (
        <ResetPasswordForm token={token} siteKey={siteKey} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-status-critical">{d.auth.reset.missingToken}</p>
          <Link href={`/${locale}/forgot-password`} className="text-sm underline">
            {d.auth.forgot.title}
          </Link>
        </div>
      )}
    </div>
  );
}
