import Link from "next/link";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import type { SetupStatus } from "@/lib/setup-status";

type State = "done" | "missing" | "waiting";

function Row({
  state,
  label,
  hint,
  words,
}: {
  state: State;
  label: string;
  hint?: React.ReactNode;
  words: Record<State, string>;
}) {
  const tone =
    state === "done"
      ? "text-green-700 dark:text-status-good"
      : state === "waiting"
        ? "text-amber-700 dark:text-status-warning"
        : "text-status-critical";
  const mark = state === "done" ? "✓" : state === "waiting" ? "…" : "✗";
  return (
    <li className="flex gap-3 py-3">
      <span className={`w-5 shrink-0 text-center font-semibold ${tone}`} aria-hidden>
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <span className={`text-xs ${tone}`}>{words[state]}</span>
    </li>
  );
}

export async function SetupChecklist({ status }: { status: SetupStatus }) {
  const { locale, d } = await getI18n();
  const s = d.setup;
  const words: Record<State, string> = { done: s.done, missing: s.missing, waiting: s.waiting };
  const flag = (ok: boolean): State => (ok ? "done" : "missing");

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{s.title}</h2>
      <p className="mt-1 text-sm text-muted">{s.subtitle}</p>
      <ol className="mt-4 divide-y divide-border">
        <Row state="done" label={s.database} words={words} />
        <Row state={flag(status.secret)} label={s.secret} hint={s.secretHint} words={words} />
        <Row state={flag(status.emailKey)} label={s.emailKey} hint={s.emailKeyHint} words={words} />
        <Row state={flag(status.alertAddress)} label={s.alertAddress} words={words} />
        <Row
          state="waiting"
          label={s.router}
          words={words}
          hint={
            <Interpolate
              template={s.routerHint}
              values={{
                link: (
                  <Link href={`/${locale}/settings`} className="underline">
                    {s.settingsLink}
                  </Link>
                ),
                iface: <code>{status.interfaceName}</code>,
              }}
            />
          }
        />
      </ol>
    </section>
  );
}
