import { headers } from "next/headers";
import { RouterScriptView } from "@/components/RouterScriptView";
import { getI18n } from "@/lib/i18n/server";
import { publicBaseUrlFromHeaders } from "@/lib/public-url";
import { renderQuotaPushScript } from "@/lib/router/script";
import { TEMPLATE_DEFAULTS } from "@/lib/router/script-template";

/**
 * quota-push with this deployment's values. The secret is rendered as a
 * placeholder here and filled in by the client view, which masks it until
 * asked; the URL comes from APP_URL or the address the page was opened on.
 */
export async function RouterScriptCard({ interfaceName }: { interfaceName: string }) {
  const [{ d }, h] = await Promise.all([getI18n(), headers()]);
  const base = publicBaseUrlFromHeaders((name) => h.get(name));
  const secret = process.env.CRON_SECRET?.trim() ?? "";

  const script = renderQuotaPushScript({
    iface: interfaceName,
    url: `${base}/api/ingest`,
    // The placeholder survives escaping unchanged; the view swaps it out.
    secret: "{{secret}}",
    throttleQueue: TEMPLATE_DEFAULTS.throttleQueue,
  });

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{d.settings.scriptCardTitle}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">{d.settings.scriptCardHint}</p>
      <RouterScriptView script={script} secret={secret} secretMissing={secret === ""} />
      <ol className="mt-4 list-decimal space-y-1 ps-5 text-sm text-muted">
        {d.settings.scriptSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
