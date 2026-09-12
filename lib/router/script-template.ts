/**
 * The body of router/quota-push.rsc, with the install-specific values as
 * {{placeholders}}. lib/router/script.test.ts reads the .rsc from disk and
 * checks that filling this template with TEMPLATE_DEFAULTS reproduces it, so
 * editing one without the other fails the build.
 *
 * Kept as a plain string rather than read from disk at runtime: the settings
 * page renders it on Vercel, where the repository is not on the filesystem.
 */
import type { ScriptVars } from "@/lib/router/script";

export const TEMPLATE_DEFAULTS: ScriptVars = {
  iface: "pppoe-out1",
  url: "http://APP-HOST:3000/api/ingest",
  secret: "PASTE-YOUR-CRON_SECRET-HERE",
  throttleQueue: "quota-throttle",
};

export const QUOTA_PUSH_TEMPLATE = `:local iface         "{{iface}}"
:local url           "{{url}}"
:local secret        "{{secret}}"
:local throttleQueue "{{throttleQueue}}"

# state carried between runs (cleared on reboot, which is handled below)
:global qpUp
:global qpSid
:global qpTx
:global qpRx

:local id [/interface find name=$iface]
:if ([:len $id] = 0) do={
    :log error "quota-push: interface $iface not found"
    :error "no interface"
}

:local running [/interface get $id running]
:local tx [/interface get $id tx-byte]
:local rx [/interface get $id rx-byte]

:local linkUp ""
:do { :set linkUp [/interface get $id last-link-up-time] } on-error={ :set linkUp "" }

:local stamp ([/system clock get date] . " " . [/system clock get time])

# ---- decide what kind of record this is ----
:local event "sample"
:local sid $linkUp
:local outTx $tx
:local outRx $rx
:local send true

:if ($running) do={
    :if ([:tostr $qpUp] != "true") do={ :set event "session_start" }
    :if ((([:tostr $qpUp] = "true") && ([:len $qpSid] > 0)) && ($sid != $qpSid)) do={
        # reconnected between two polls - old session ended, we missed it
        :set event "session_restart"
    }
} else={
    :if ([:tostr $qpUp] = "true") do={
        # link just dropped: report the LAST known counters, not the dead ones
        :set event "session_end"
        :set sid $qpSid
        :set outTx $qpTx
        :set outRx $qpRx
    } else={
        # still offline and nothing changed - stay quiet
        :set send false
    }
}

:if ($send) do={
    :local body "{\\"iface\\":\\"$iface\\",\\"event\\":\\"$event\\",\\"session_id\\":\\"$sid\\",\\"link_up\\":\\"$linkUp\\",\\"running\\":$running,\\"tx_bytes\\":$outTx,\\"rx_bytes\\":$outRx,\\"router_time\\":\\"$stamp\\"}"

    :do {
        :local result [/tool fetch url=$url http-method=post http-data=$body \\
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \\
            output=user as-value]

        # only commit state AFTER a successful POST, so a failed
        # start/end event is retried on the next run instead of lost
        :set qpUp $running
        :if ($running) do={
            :set qpSid $sid
            :set qpTx $tx
            :set qpRx $rx
        } else={
            :set qpSid ""
        }
        :log info "quota-push: $event tx=$outTx rx=$outRx"

        # ---- apply the policy the app answered with ----
        # :find returns nothing (nil) when the needle is absent, so the type of
        # the result is the test, not its value.
        :local data ($result->"data")
        :local throttle ([:typeof [:find $data "\\"throttle\\":true"]] = "num")
        :do {
            :local qid [/queue simple find name=$throttleQueue]
            :if ([:len $qid] > 0) do={
                :local qOff [/queue simple get $qid disabled]
                :if ($throttle && $qOff) do={
                    /ip firewall filter set [find comment="defconf: fasttrack"] disabled=yes
                    /queue simple set $qid disabled=no
                    :log warning "quota-push: throttle ON ($throttleQueue)"
                }
                :if ((!$throttle) && (!$qOff)) do={
                    /queue simple set $qid disabled=yes
                    /ip firewall filter set [find comment="defconf: fasttrack"] disabled=no
                    :log info "quota-push: throttle OFF ($throttleQueue)"
                }
            }
        } on-error={
            :log error "quota-push: could not apply throttle policy"
        }
    } on-error={
        :log warning "quota-push: POST to $url failed"
    }
}
`;
