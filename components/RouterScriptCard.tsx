import { headers } from "next/headers";
import { RouterScriptView } from "@/components/RouterScriptView";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { getI18n } from "@/lib/i18n/server";
import { publicBaseUrlFromHeaders } from "@/lib/public-url";
import { renderQuotaPushScript } from "@/lib/router/script";
import { TEMPLATE_DEFAULTS } from "@/lib/router/script-template";

/**
 * quota-push with this deployment's values. The URL comes from APP_URL or the
 * address the page was opened on.
 *
 * The secret is NOT kept from the browser. It is passed as a prop to a client
 * component, so it is serialised into the RSC payload and sits in this page's
 * HTML whether or not "Reveal" is ever pressed; the view's mask only keeps it
 * off the screen (someone looking over a shoulder, a screenshot). That is
 * acceptable because the settings page is owner-only and the owner is the one
 * pasting the secret into the router anyway -- but it is a display nicety, not
 * a protection, and nothing here should be read as one. Keeping it out of the
 * page would mean fetching it on demand from an authenticated route.
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
    <SettingsCard title={d.settings.scriptCardTitle} description={d.settings.scriptCardHint}>
      <RouterScriptView script={script} secret={secret} secretMissing={secret === ""} />
      <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
        {d.settings.scriptSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </SettingsCard>
  );
}
