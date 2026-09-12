import Link from "next/link";
import { lang } from "next/root-params";
import { getDictionaryFor } from "@/lib/i18n";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";

/**
 * The 404, inside the application's own chrome and language.
 *
 * It sits at the language level rather than at the root because everything
 * below it is already under a language, and the most common way to arrive
 * here is a share link that was replaced or turned off: `notFound()` in
 * app/[lang]/share/[token]/page.tsx. Without this file that visitor gets
 * Next's built-in English page, in a typeface the rest of the site never uses.
 *
 * The link goes to the dashboard, which the proxy redirects to the login page
 * for a visitor with no session, so it is useful to owner and viewer alike.
 * Nothing here says whether a token exists, was revoked, or never did: the
 * share page's 404 is deliberately silent on that and this page keeps it so.
 */
export default async function NotFound() {
  // The language is read here rather than through getI18n(), whose getLocale()
  // answers an unknown language with notFound() -- which is this page, and a
  // page that can 404 itself is a loop. An unreadable language falls back to
  // the default instead.
  const raw = await lang();
  const locale = typeof raw === "string" && isLocale(raw) ? raw : DEFAULT_LOCALE;
  const d = getDictionaryFor(locale);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-start justify-center px-4 py-12 sm:px-6 sm:py-20">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-muted">404</p>
        <h1 className="mt-3 text-base font-semibold">{d.notFound.title}</h1>
        <p className="mt-2 text-sm text-muted">{d.notFound.body}</p>
        <Link
          href={`/${locale}`}
          className="mt-5 inline-block rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-background"
        >
          {d.notFound.home}
        </Link>
      </div>
    </main>
  );
}
