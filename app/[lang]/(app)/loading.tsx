/**
 * Shown in the main area the moment a tab is clicked, while the page's data is
 * still on its way from the database. Next prefetches this shell when a link
 * is hovered, so the switch itself is instant and only the numbers arrive
 * later. The shapes stand in for the heading, a row of tiles and two cards,
 * which is roughly what every page here opens with.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded-md bg-border/60" />
        <div className="h-4 w-64 rounded-md bg-border/40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="h-56 rounded-xl border border-border bg-surface" />
        <div className="h-56 rounded-xl border border-border bg-surface" />
      </div>
      <div className="h-72 rounded-xl border border-border bg-surface" />
    </div>
  );
}
