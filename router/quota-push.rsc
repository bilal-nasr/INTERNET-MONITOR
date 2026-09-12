# quota-push: report the WAN interface counters and link sessions to the app,
# and apply the throttle policy the app answers with.
#
# The router pushes; the app never connects back, so nothing has to be exposed
# on the router and CGNAT is not a problem.
#
# WinBox setup:
#   1. System > Scripts > "+" : Name = quota-push, paste everything below the
#      dashed line into Source, keep the default policies ticked, OK.
#      Policies needed: read, write, test.
#   2. Edit the four values at the top (interface name, app URL, secret, queue).
#      The settings page of the app renders this script with them filled in.
#   3. System > Scheduler > "+" : Name = quota-push, Start Time = startup,
#      Interval = 00:00:30, On Event = /system script run quota-push, OK.
#      A shorter interval narrows the traffic lost when the link drops, at
#      the cost of more stored rows. 30s is the balance the README argues for.
#   4. Test once: select the script and click "Run Script", then check
#      Log for a "quota-push:" line and the dashboard for a new reading.
#
# Terminal equivalent for the scheduler:
#   /system scheduler add name=quota-push start-time=startup interval=30s \
#       on-event="/system script run quota-push" policy=read,write,test
#
# Throttling: the app's reply carries {"policy":{"throttle":true|false,...}}.
# When it says true, the script enables the simple queue named below and
# disables the default fasttrack rule, because fasttracked connections bypass
# queues. When it says false it reverses both. The queue must exist first:
# run router/throttle-setup.rsc once. If the queue does not exist, the branch
# does nothing and logs nothing, so the script is safe without it.
#
# Failing open: the policy is applied OUTSIDE the fetch, so a push that fails
# (app down, database down, rotated secret giving 401, changed URL) cannot
# silently leave the house throttled forever. Consecutive failures are counted
# in the $qpFail global and after failLimit of them the throttle is lifted.
# The app can therefore only hold the throttle on while it is reachable, which
# is the safe direction: something that cannot be asked to stop must not be
# able to keep the LAN at 2M/2M indefinitely.
#
# Known limitation - the throttle is not instant for traffic already running.
# Disabling the "defconf: fasttrack" filter rule only stops NEW connections
# being fasttracked. A connection that is already fasttracked keeps skipping
# the queue until its connection-tracking entry is gone, and for an
# established TCP download that is tcp-established-timeout, 1 day by default
# (see /ip firewall connection tracking). So the very download that blew the
# quota can continue at full speed after the throttle engages, while every new
# connection is limited at once. To cut the ones in flight, clear the
# connection table by hand from the router terminal:
#     /ip firewall connection remove [find]
# That drops EVERY tracked connection, not only the fasttracked ones, so VoIP
# calls and SSH sessions have to re-establish; it is not done automatically for
# that reason. A narrower, fasttrack-only selector is deliberately not used
# here because it could not be verified against RouterOS 7.24.2 on hardware.
#
# The script keeps a little state in global variables so it can tell the app
# when a session starts and ends. Globals are cleared on reboot, which simply
# looks like a new session to the app.
#
# Outage evidence: every run also notes, in uptime seconds, when it first found
# the WAN port, the PPPoE link or the netwatch probe "internet-probe" down and
# when it found them up again. The push that ends a silence carries those marks
# and the app labels the outage: router off, roof link down, ISP dropped PPPoE,
# no internet. Uptime is used because the router's clock is wrong after a power
# cut until /ip cloud sets it. The marks are cleared after every successful
# push, and a reboot clears them anyway, which the short uptime reveals.
#
# ----------------------------------------------------------------------------
:local iface         "pppoe-out1"
:local url           "http://APP-HOST:3000/api/ingest"
:local secret        "PASTE-YOUR-CRON_SECRET-HERE"
:local throttleQueue "quota-throttle"

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
:global qpEthDownAt
:global qpEthUpAt
:global qpPppDownAt
:global qpPppUpAt
:global qpNetDownAt
:global qpNetUpAt
:global qpPlanned
:if ([:typeof $qpPlanned] != "num") do={ :set qpPlanned 0 }

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

# ---- outage evidence ----
# Best effort: a missing netwatch entry, or a WAN interface that is not a
# PPPoE client, leaves its field empty and never stops the push.
:local uptime [:tonum [/system resource get uptime]]
:local pppDowns [/interface get $id link-downs]
:local ethRunning ""
:local ethDowns ""
:do {
    :local lower [/interface pppoe-client get [find name=$iface] interface]
    :local eid [/interface find name=$lower]
    :set ethRunning [:tostr [/interface get $eid running]]
    :set ethDowns [/interface get $eid link-downs]
} on-error={ :set ethRunning "" }
:local net "unknown"
:do { :set net [/tool netwatch get [find name="internet-probe"] status] } on-error={ :set net "unknown" }

# The first run that finds a link down keeps its uptime until a push succeeds.
# Finding it up records the uptime; finding it down again forgets that, so the
# span runs from the first down to the last up.
:if ($ethRunning = "false") do={
    :if ([:typeof $qpEthDownAt] != "num") do={ :set qpEthDownAt $uptime }
    :set qpEthUpAt ""
}
:if (($ethRunning = "true") && ([:typeof $qpEthDownAt] = "num") && ([:typeof $qpEthUpAt] != "num")) do={ :set qpEthUpAt $uptime }
:if (!$running) do={
    :if ([:typeof $qpPppDownAt] != "num") do={ :set qpPppDownAt $uptime }
    :set qpPppUpAt ""
}
:if ($running && ([:typeof $qpPppDownAt] = "num") && ([:typeof $qpPppUpAt] != "num")) do={ :set qpPppUpAt $uptime }
:if ($net = "down") do={
    :if ([:typeof $qpNetDownAt] != "num") do={ :set qpNetDownAt $uptime }
    :set qpNetUpAt ""
}
:if (($net = "up") && ([:typeof $qpNetDownAt] = "num") && ([:typeof $qpNetUpAt] != "num")) do={ :set qpNetUpAt $uptime }

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
    :local body "{\"iface\":\"$iface\",\"event\":\"$event\",\"session_id\":\"$sid\",\"link_up\":\"$linkUp\",\"running\":$running,\"tx_bytes\":$outTx,\"rx_bytes\":$outRx,\"router_time\":\"$stamp\",\"uptime_s\":$uptime,\"ether_running\":\"$ethRunning\",\"ether_link_downs\":\"$ethDowns\",\"pppoe_link_downs\":$pppDowns,\"netwatch\":\"$net\",\"planned_reconnects\":$qpPlanned,\"push_failures\":$qpFail,\"eth_down_at\":\"$qpEthDownAt\",\"eth_up_at\":\"$qpEthUpAt\",\"ppp_down_at\":\"$qpPppDownAt\",\"ppp_up_at\":\"$qpPppUpAt\",\"net_down_at\":\"$qpNetDownAt\",\"net_up_at\":\"$qpNetUpAt\"}"

    :local pushed false
    :local data ""

    :do {
        :local result [/tool fetch url=$url http-method=post http-data=$body \
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \
            output=user as-value]
        :set pushed true
        # the app has this silence's marks now; the next one starts clean
        :set qpEthDownAt ""
        :set qpEthUpAt ""
        :set qpPppDownAt ""
        :set qpPppUpAt ""
        :set qpNetDownAt ""
        :set qpNetUpAt ""
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
        :set throttle ([:typeof [:find $data "\"policy\":{\"throttle\":true"]] = "num")
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
