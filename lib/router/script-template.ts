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

# How many pushes in a row may fail before the throttle is lifted anyway.
# 6 x 30s = 3 minutes: long enough to ride out a redeploy or a blip, short
# enough that an app which stays down cannot hold the house at 2M/2M.
:local failLimit 6

# state carried between runs (cleared on reboot, which is handled below)
:global qpUp
:global qpSid
:global qpTx
:global qpRx
:global qpFail
:if ([:typeof $qpFail] != "num") do={ :set qpFail 0 }

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

    :local pushed false
    :local data ""

    :do {
        :local result [/tool fetch url=$url http-method=post http-data=$body \\
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \\
            output=user as-value]
        :set pushed true
        :set data ($result->"data")

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
    } on-error={
        :log warning "quota-push: POST to $url failed"
    }

    # ---- decide the policy ----
    # Deliberately outside the fetch above: were it inside, a failed push would
    # skip it and leave the queue enabled and fasttrack disabled for as long as
    # the app stayed unreachable, with nothing able to undo it. Instead the
    # failures are counted and the throttle is lifted after failLimit of them.
    :local decided false
    :local throttle false
    :if ($pushed) do={
        :set qpFail 0
        # :find returns nothing (nil) when the needle is absent, so the type of
        # the result is the test, not its value. The needle keeps the "policy":
        # prefix so that a "throttle":true appearing anywhere else in the reply
        # cannot throttle the house.
        :set throttle ([:typeof [:find $data "\\"policy\\":{\\"throttle\\":true"]] = "num")
        :set decided true
    } else={
        :set qpFail ($qpFail + 1)
        :if ($qpFail >= $failLimit) do={
            # unreachable for failLimit pushes in a row: fail open, throttle off
            :set decided true
        }
    }

    # ---- apply it ----
    :if ($decided) do={
        :do {
            :local qid [/queue simple find name=$throttleQueue]
            :if ([:len $qid] > 0) do={
                # find always returns an array; get wants one id
                :local q ($qid->0)
                :local qOff [/queue simple get $q disabled]
                :if ($throttle && $qOff) do={
                    # This only stops NEW connections being fasttracked.
                    # Connections already fasttracked keep bypassing the queue
                    # until their conntrack entry expires (up to a day for an
                    # established TCP transfer). To cut them now, run by hand:
                    #   /ip firewall connection remove [find]
                    # which drops every tracked connection, not only those.
                    /ip firewall filter set [find comment="defconf: fasttrack"] disabled=yes
                    /queue simple set $q disabled=no
                    :log warning "quota-push: throttle ON ($throttleQueue)"
                }
                :if ((!$throttle) && (!$qOff)) do={
                    /queue simple set $q disabled=yes
                    /ip firewall filter set [find comment="defconf: fasttrack"] disabled=no
                    :log info "quota-push: throttle OFF ($throttleQueue)"
                }
            }
        } on-error={
            :log error "quota-push: could not apply throttle policy"
        }
    }
}
`;
