# quota-push: report the WAN interface counters and link sessions to the app.
#
# The router pushes; the app never connects back, so nothing has to be exposed
# on the router and CGNAT is not a problem.
#
# WinBox setup:
#   1. System > Scripts > "+" : Name = quota-push, paste everything below the
#      dashed line into Source, keep the default policies ticked, OK.
#      Policies needed: read, write, test.
#   2. Edit the three values at the top (interface name, app URL, secret).
#   3. System > Scheduler > "+" : Name = quota-push, Start Time = startup,
#      Interval = 00:01:00, On Event = /system script run quota-push, OK.
#      A shorter interval narrows the traffic lost when the link drops.
#   4. Test once: select the script and click "Run Script", then check
#      Log for a "quota-push:" line and the dashboard for a new reading.
#
# Terminal equivalent for the scheduler:
#   /system scheduler add name=quota-push start-time=startup interval=1m \
#       on-event="/system script run quota-push" policy=read,write,test
#
# The script keeps a little state in global variables so it can tell the app
# when a session starts and ends. Globals are cleared on reboot, which simply
# looks like a new session to the app.
#
# ----------------------------------------------------------------------------
:local iface  "pppoe-out1"
:local url    "http://192.168.88.254:3000/api/ingest"
:local secret "PASTE-YOUR-CRON_SECRET-HERE"

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
    :local body "{\"iface\":\"$iface\",\"event\":\"$event\",\"session_id\":\"$sid\",\"link_up\":\"$linkUp\",\"running\":$running,\"tx_bytes\":$outTx,\"rx_bytes\":$outRx,\"router_time\":\"$stamp\"}"

    :do {
        /tool fetch url=$url http-method=post http-data=$body \
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \
            output=none

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
}
