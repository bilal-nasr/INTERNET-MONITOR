# backup-wan-quota: monthly data cap on the second WAN (backup-wan, ether5).
#
# Counts rx+tx on backup-wan once a minute. At 80% it logs a warning; at the
# limit it disables the mangle rule "dual-wan: PCC 3/3 hotspot", so new
# connections stop being balanced onto the hotspot, and drops the connections
# already marked hotspot_conn so they reconnect over the ISP. The recursive
# failover routes are untouched: if the ISP goes down the hotspot still
# carries everything, and that traffic still counts. On the 1st of the month
# (router clock, Asia/Beirut) the count restarts and the rule is re-enabled.
# Needs dual-wan-setup.rsc applied first.
#
# Interface counters restart at 0 on reboot, so the running total is kept in
# the source of a second script, backup-wan-quota-state ("used,yyyymm,warned"),
# saved every 5 runs and on every state change; a reboot loses at most 5
# minutes of counting. Its comment reads "used N MB of M MB this month", which
# is where WinBox shows the usage (System > Scripts). Do not edit it.
#
# The count is a little higher than a carrier's (2-3%: it includes Ethernet
# framing), and it only sees traffic through the MikroTik - the phone itself or
# anything else on the hotspot is not counted.
#
# Do not clear the bwq* globals by hand (System > Scripts > Environment): with
# them gone but the counters not reset, the next run adds everything since boot
# a second time. To match a carrier's figure instead, set the total in bytes
# from New Terminal; it is saved within 5 runs:
#     :global bwqUsed 3500000000
#
# WinBox setup:
#   1. New Terminal:
#        /system script add name=backup-wan-quota-state source="0,0,0" \
#            comment="state for backup-wan-quota, do not edit"
#   2. System > Scripts > "+" : Name = backup-wan-quota, paste everything below
#      the dashed line into Source. Policies needed: read, write, policy, test.
#   3. New Terminal:
#        /system scheduler add name=backup-wan-quota interval=1m \
#            start-time=startup on-event="/system script run backup-wan-quota" \
#            policy=read,write,policy,test comment="10 GB/month quota on backup-wan"
#
# Change limit and warnAt below to change the cap (bytes, decimal: 10 GB is
# 10000000000). Raising the limit above the current usage re-enables the rule
# on the next run. To switch the cap off, disable the scheduler.
#
# ----------------------------------------------------------------------------
:local limit 10000000000
:local warnAt 8000000000
:local stateName "backup-wan-quota-state"
:local pcc "dual-wan: PCC 3/3 hotspot"
:global bwqUsed
:global bwqLast
:global bwqMonth
:global bwqWarned
:global bwqRuns
:local save false

:if ([:typeof $bwqUsed] != "num") do={
    :local s [:toarray [/system script get [find name=$stateName] source]]
    :set bwqUsed [:tonum ($s->0)]
    :set bwqMonth [:tonum ($s->1)]
    :set bwqWarned [:tonum ($s->2)]
    :set bwqRuns 0
}

:local i [/interface find name="backup-wan"]
:local cur ([/interface get $i rx-byte] + [/interface get $i tx-byte])
# Counters restart at 0 on reboot or reset; then everything since is new.
:local delta $cur
:if ([:typeof $bwqLast] = "num") do={
    :if ($cur >= $bwqLast) do={ :set delta ($cur - $bwqLast) }
}
:set bwqLast $cur
:set bwqUsed ($bwqUsed + $delta)

:local d [/system clock get date]
:local month [:tonum ([:pick $d 0 4] . [:pick $d 5 7])]
:if ($month > $bwqMonth) do={
    :log info ("backup-wan-quota: new month, previous month used " . ($bwqUsed / 1000000) . " MB")
    :set bwqUsed 0
    :set bwqMonth $month
    :set bwqWarned 0
    :set save true
}

:if ($bwqUsed >= $warnAt && $bwqWarned = 0) do={
    :log warning ("backup-wan-quota: " . ($bwqUsed / 1000000) . " MB used, 80% of the monthly quota")
    :set bwqWarned 1
    :set save true
}

:local r [/ip firewall mangle find comment=$pcc]
:if ($bwqUsed >= $limit) do={
    :if (![/ip firewall mangle get $r disabled]) do={
        /ip firewall mangle disable $r
        :foreach c in=[/ip firewall connection find connection-mark="hotspot_conn"] do={
            :do { /ip firewall connection remove $c } on-error={}
        }
        :log warning "backup-wan-quota: monthly quota reached, hotspot is backup only until the 1st"
        :set save true
    }
} else={
    :if ([/ip firewall mangle get $r disabled]) do={
        /ip firewall mangle enable $r
        :log info "backup-wan-quota: under quota, hotspot load balancing resumed"
        :set save true
    }
}

:set bwqRuns ($bwqRuns + 1)
:if ($save || $bwqRuns >= 5) do={
    :set bwqRuns 0
    /system script set [find name=$stateName] source=("$bwqUsed,$bwqMonth,$bwqWarned") comment=("used " . ($bwqUsed / 1000000) . " MB of " . ($limit / 1000000) . " MB this month")
}
