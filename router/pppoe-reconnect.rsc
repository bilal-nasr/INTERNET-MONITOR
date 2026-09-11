# pppoe-reconnect: drop and re-establish the WAN session.
#
# Cycling the PPPoE client ends the current session and starts a new one, which
# the quota monitor records as a new row on its Sessions page.
#
# Called from two places, so the reconnect logic lives in one script:
#   - a scheduler at 00:00 for the daily fresh session
#   - internet-watchdog, when the link is up but the internet is unreachable
#
# WinBox setup:
#   System > Scripts > "+" : Name = pppoe-reconnect, paste everything below the
#   dashed line into Source. Policies needed: read, write, test.
#
# Daily scheduler (New Terminal), replacing any earlier inline version:
#   /system scheduler remove [find name=pppoe-daily-reset]
#   /system scheduler add name=pppoe-daily-reset start-time=00:00:00 interval=1d \
#       on-event="/system script run pppoe-reconnect" policy=read,write,test \
#       comment="daily fresh WAN session at local midnight"
#
# ----------------------------------------------------------------------------
:local iface "pppoe-out1"

:local id [/interface find name=$iface]
:if ([:len $id] = 0) do={
    :log error "pppoe-reconnect: interface $iface not found"
    :error "no interface"
}

:log info "pppoe-reconnect: cycling $iface"
/interface pppoe-client disable [find name=$iface]
# Long enough for the session to tear down before it is re-established.
:delay 10s
/interface pppoe-client enable [find name=$iface]
