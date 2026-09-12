"use client";

import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { useI18n } from "@/components/I18nProvider";
import { secondaryButtonClass } from "@/components/auth/fields";
import { fillScriptSecret } from "@/lib/router/script";

const MASK = "••••••••••••••••";

/**
 * The filled script, folded away until asked for, with the secret masked until
 * asked for too. Copying needs neither: the copy always carries the real
 * secret, otherwise the pasted script would not work. `children` are the
 * install steps, shown between the buttons and the code so they are read first.
 */
export function RouterScriptView({
  script,
  secret,
  secretMissing,
  children,
}: {
  /** The rendered script with the literal `{{secret}}` where the secret goes. */
  script: string;
  secret: string;
  secretMissing: boolean;
  children?: ReactNode;
}) {
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Escaped on the way in, exactly as the other values in the script were, so
  // a secret with a quote, a backslash or a dollar sign still parses on the
  // router -- and so that what is revealed is what is copied.
  const shown = fillScriptSecret(script, revealed ? secret : MASK);
  const real = fillScriptSecret(script, secret);

  return (
    <div className="space-y-4">
      {secretMissing && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm">
          {d.settings.scriptSecretMissing}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <CopyButton
          text={real}
          label={d.settings.scriptCopy}
          copiedLabel={d.settings.scriptCopied}
          failedLabel={d.settings.scriptCopyFailed}
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={secondaryButtonClass}
        >
          {open ? d.settings.scriptHideCode : d.settings.scriptShowCode}
        </button>
        {open && (
          <button type="button" onClick={() => setRevealed((r) => !r)} className={secondaryButtonClass}>
            {revealed ? d.settings.scriptHide : d.settings.scriptReveal}
          </button>
        )}
      </div>
      {children}
      {open && (
        <div className="space-y-2">
          <p className="text-xs text-muted">{d.settings.scriptSecretInPage}</p>
          {/* A script is code: it stays left-to-right in Arabic too. */}
          <pre
            dir="ltr"
            className="max-h-96 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed"
          >
            {shown}
          </pre>
        </div>
      )}
    </div>
  );
}
