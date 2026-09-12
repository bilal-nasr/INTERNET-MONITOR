import Link from "next/link";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getI18n } from "@/lib/i18n/server";

/**
 * The signed-out pages: sign in, forgot password, reset password. No navigation
 * to pages that would only bounce back here, just the name and the language.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href={`/${locale}/login`} className="text-sm font-semibold tracking-tight">
            {d.meta.appName}
          </Link>
          <Suspense fallback={null}>
            <LanguageSwitcher />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-start justify-center px-4 py-12 sm:px-6 sm:py-20">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">{children}</div>
      </main>
    </>
  );
}
