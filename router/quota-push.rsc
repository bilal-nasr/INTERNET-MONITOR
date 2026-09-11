# quota-push: send the WAN interface counters to the quota monitor.
#
# Use this when the router is behind CGNAT (no public IP) so the app cannot
# poll it. The router pushes instead; no ports need to be opened.
#
# WinBox setup:
#   1. System > Scripts > "+" : Name = quota-push, paste everything below the
#      dashed line into Source, keep the default policies ticked, OK.
#   2. Edit the three values at the top (interface name, app URL, secret).
#   3. System > Scheduler > "+" : Name = quota-push, Start Time = startup,
#      Interval = 00:05:00, On Event = /system script run quota-push, OK.
#   4. Test once: select the script and click "Run Script", then check
#      Log for a "quota-push:" line and the dashboard for a new reading.
#
# Terminal equivalent for the scheduler:
#   /system scheduler add name=quota-push start-time=startup interval=5m \
#       on-event="/system script run quota-push" policy=read,write,test
#
# ----------------------------------------------------------------------------
:local iface "ether1"
:local url "https://YOUR-APP.vercel.app/api/ingest"
:local secret "PASTE-YOUR-CRON_SECRET-HERE"

:local id [/interface find name=$iface]
:if ([:len $id] = 0) do={
  :log error "quota-push: interface $iface not found"
  :error "quota-push: interface not found"
}

:local tx [/interface get $id tx-byte]
:local rx [/interface get $id rx-byte]
:local running [/interface get $id running]
:local body "{\"interface\":\"$iface\",\"tx_bytes\":$tx,\"rx_bytes\":$rx,\"running\":$running}"

:do {
  /tool fetch url=$url http-method=post http-data=$body \
    http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \
    output=none
  :log info "quota-push: sent tx=$tx rx=$rx"
} on-error={
  :log warning "quota-push: request to $url failed"
}
