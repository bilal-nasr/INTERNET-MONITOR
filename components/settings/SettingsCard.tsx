import type { ReactNode } from "react";

/**
 * One card of related settings: a titled header, then the controls. No hooks,
 * so the server-rendered cards (the router script) and the client ones share it.
 */
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}
