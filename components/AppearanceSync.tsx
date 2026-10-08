"use client";

import { useLayoutEffect } from "react";
import { applyAppearance, readAppearance } from "@/lib/appearance";

/**
 * Puts the stored theme back on `<html>` whenever the root layout mounts.
 *
 * The head script sets `data-theme` on the first load only. Switching language
 * changes the `[lang]` segment the root layout belongs to, so React mounts the
 * layout afresh, and React treats `<html>` as a singleton: taking it over again
 * clears every attribute it does not render itself, `data-theme` included. The
 * page then fell back to the system theme while Settings still showed the
 * stored choice. A layout effect runs after that commit and before paint, so
 * the theme is restored without a flash of the other one.
 */
export function AppearanceSync() {
  useLayoutEffect(() => {
    applyAppearance(readAppearance());
  }, []);
  return null;
}
