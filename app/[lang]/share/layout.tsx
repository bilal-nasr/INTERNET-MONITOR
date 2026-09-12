import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getI18n } from "@/lib/i18n/server";

/**
 * Chrome for the read-only view: the name, the language, and a footer that
 * says what this is. No navigation, since every other page needs a sign-in
 * this visitor does not have, and no link on the name for the same reason.
 */
export default async function ShareLayout({ children }: { children: React.ReactNode }) {
  const { d } = await getI18n();

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">{d.meta.appName}</span>
          <Suspense fallback={null}>
            <LanguageSwitcher />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-500 sm:px-6">{d.share.pageFooter}</footer>
    </>
  );
}
