import type { Metadata, Viewport } from "next";
import { Geist_Mono, Readex_Pro } from "next/font/google";
import { AppearanceSync } from "@/components/AppearanceSync";
import { I18nProvider } from "@/components/I18nProvider";
import { InlineScript } from "@/components/InlineScript";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";
import { DIRECTION, LOCALES } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import "../globals.css";

/**
 * One family for both scripts. Readex Pro was drawn for Arabic and Latin
 * together, in the squared, engineered register of a maker's plate, so a page
 * that mixes Arabic prose with Latin units (GB, pppoe-out1) keeps one voice.
 */
const readex = Readex_Pro({
  variable: "--font-readex",
  subsets: ["arabic", "latin"],
});

/** Code only: the router script, paths, environment variables. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Both languages are known ahead of time, so both can be prerendered. */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

/** The browser chrome colour once installed, the same ink as the manifest. */
export const viewport: Viewport = {
  themeColor: "#24402f",
};

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return {
    title: d.meta.appName,
    description: d.meta.appDescription,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/icon.svg",
      apple: "/icon-192.png",
    },
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

  // suppressHydrationWarning: the appearance script sets data-theme on <html>
  // before React hydrates, and the DOM is meant to win.
  return (
    <html
      lang={locale}
      dir={dir}
      className={`${readex.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <InlineScript html={APPEARANCE_SCRIPT} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <AppearanceSync />
        <I18nProvider locale={locale} dictionary={d}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
