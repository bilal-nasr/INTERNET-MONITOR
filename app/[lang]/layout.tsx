import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cairo } from "next/font/google";
import { I18nProvider } from "@/components/I18nProvider";
import { DIRECTION, LOCALES } from "@/lib/i18n/config";
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

/**
 * The document itself: language, direction, fonts and the dictionary. The
 * chrome around a page belongs to the route groups below, because a signed-in
 * page and the login page do not share one.
 */
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
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
