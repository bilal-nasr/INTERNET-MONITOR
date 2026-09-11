import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cairo } from "next/font/google";
import { I18nProvider } from "@/components/I18nProvider";
import { Nav } from "@/components/Nav";
import { DIRECTION, LOCALES } from "@/lib/i18n/config";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Geist has no Arabic glyphs, so Arabic text would fall through to whatever the
 * system happens to offer and land inconsistently across machines. Cairo is a
 * sans in the same register and carries both scripts, which keeps a page that
 * mixes Arabic prose with Latin units (GB, pppoe-out1) in one voice.
 */
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

/** Both languages are known ahead of time, so both can be prerendered. */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return {
    title: d.meta.appName,
    description: d.meta.appDescription,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();
  const dir = DIRECTION[locale];

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <I18nProvider locale={locale} dictionary={d}>
          <Nav />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-xs text-zinc-500 sm:px-6">
            <Interpolate template={d.footer.ingest} values={{ path: <code>/api/ingest</code> }} />
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
