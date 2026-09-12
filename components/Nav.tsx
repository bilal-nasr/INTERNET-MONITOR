"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/components/I18nProvider";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { fill, type Dictionary } from "@/lib/i18n";

/**
 * Paths are stored without a language and prefixed at render time, so a link
 * always points at the page the reader is already reading in.
 */
const LINKS = [
  { path: "", label: (d: Dictionary) => d.nav.dashboard },
  { path: "/stats", label: (d: Dictionary) => d.nav.statistics },
  { path: "/sessions", label: (d: Dictionary) => d.nav.sessions },
  { path: "/settings", label: (d: Dictionary) => d.nav.settings },
  { path: "/export", label: (d: Dictionary) => d.nav.export },
] as const;

export function Nav({ username }: { username: string }) {
  const { locale, d } = useI18n();
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={`/${locale}`} className="text-sm font-semibold tracking-tight">
          {d.meta.appName}
        </Link>

        {/* Five destinations no longer fit across a phone in one row. Wrapping
            keeps them all reachable instead of pushing some off the edge. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <nav className="flex flex-wrap gap-1 text-sm">
            {LINKS.map((link) => {
              const href = `/${locale}${link.path}`;
              const active = pathname === href;
              return (
                <Link
                  key={link.path}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-foreground text-background"
                      : "text-muted hover:bg-border/60 hover:text-foreground"
                  }`}
                >
                  {link.label(d)}
                </Link>
              );
            })}
          </nav>
          {/* The switcher reads the query string so a range survives the
              change of language, and reading it is what makes this subtree
              depend on the request. The boundary keeps that dependency off
              the rest of the header. */}
          <Suspense fallback={null}>
            <LanguageSwitcher />
          </Suspense>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline" title={fill(d.auth.signedInAs, { username })}>
              {username}
            </span>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
