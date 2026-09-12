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
 *
 * Export is not here: it is a tool used now and then, not a place to look at,
 * and Settings > Data & sharing links to it.
 */
const LINKS = [
  { path: "", label: (d: Dictionary) => d.nav.dashboard },
  { path: "/stats", label: (d: Dictionary) => d.nav.statistics },
  { path: "/sessions", label: (d: Dictionary) => d.nav.sessions },
  { path: "/devices", label: (d: Dictionary) => d.nav.devices, needsDevices: true },
  { path: "/alerts", label: (d: Dictionary) => d.nav.alerts },
  { path: "/settings", label: (d: Dictionary) => d.nav.settings },
] as const;

export function Nav({ username, devicesEnabled }: { username: string; devicesEnabled: boolean }) {
  const { locale, d } = useI18n();
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {/* Allowed to shrink (and truncate on the narrowest phones) so the
            name and the account controls share the first row. */}
        <Link
          href={`/${locale}`}
          className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight lg:flex-none"
        >
          {d.meta.appName}
        </Link>

        {/* One row on a desktop. Below that the links take a row of their own
            under the name and the account controls, and scroll sideways
            instead of wrapping, so the header stays two rows tall on a phone. */}
        <nav className="order-last -mx-4 flex basis-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 text-sm [scrollbar-width:none] sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 lg:order-none lg:mx-0 lg:ms-auto lg:basis-auto lg:px-0">
          {LINKS.filter((link) => !("needsDevices" in link) || devicesEnabled).map((link) => {
            const href = `/${locale}${link.path}`;
            const active = pathname === href;
            return (
              <Link
                key={link.path}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
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

        <div className="flex shrink-0 items-center gap-x-3">
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
