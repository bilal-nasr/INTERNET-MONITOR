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
    <header className="bg-cabinet text-cabinet-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
        {/* Allowed to shrink (and truncate on the narrowest phones) so the
            name and the account controls share the first row. */}
        <Link
          href={`/${locale}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-semibold lg:flex-none"
        >
          <MeterMark />
          <span className="truncate">{d.meta.appName}</span>
        </Link>

        {/* One row on a desktop. Below that the links take a row of their own
            under the name and the account controls, and scroll sideways
            instead of wrapping, so the header stays two rows tall on a phone. */}
        <nav className="order-last -mx-4 flex basis-[calc(100%+2rem)] gap-0.5 overflow-x-auto px-4 pb-0.5 text-sm [scrollbar-width:none] sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 lg:order-none lg:mx-0 lg:ms-auto lg:basis-auto lg:px-0">
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
                    ? "bg-cabinet-ink font-medium text-cabinet"
                    : "text-cabinet-muted hover:bg-cabinet-hover hover:text-cabinet-ink"
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
            <LanguageSwitcher onCabinet />
          </Suspense>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-cabinet-muted sm:inline" title={fill(d.auth.signedInAs, { username })}>
              {username}
            </span>
            <LogoutButton onCabinet />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The app's mark: the meter's disc seen through its window, the black mark on
 * its rim at the top. Drawn rather than an icon font, in the cabinet's inks.
 */
function MeterMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="1.5" fill="none" stroke="currentColor" strokeOpacity="0.45" />
      <circle cx="12" cy="12" r="7" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="5" width="2" height="4" fill="var(--drum-tenths)" />
    </svg>
  );
}
