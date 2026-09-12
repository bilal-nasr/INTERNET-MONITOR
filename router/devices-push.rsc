# devices-push.rsc: report every LAN device's counters to the app.
#
# WinBox setup:
#   1. Run devices-setup.rsc once (see that file).
#   2. System > Scripts > "+" : Name = devices-push, paste everything below
#      the dashed line into Source. Policies needed: read, test.
#   3. Edit url and secret below (same secret as quota-push).
#   4. System > Scheduler > "+" : Name = devices-push, Start Time = startup,
#      Interval = 00:01:00, On Event = /system script run devices-push.
#
# Terminal equivalent for the scheduler:
#   /system scheduler add name=devices-push start-time=startup interval=1m \
#       on-event="/system script run devices-push" policy=read,test
#
# The counters are cumulative since RouterOS started tracking the device; the
# app takes the difference between pushes, so a reboot that resets them costs
# at most one minute of traffic, never a double count.
#
# Devices are sent in batches of 200 so a large LAN never builds one huge
# string on a router with 64 MB of RAM.
#
# Note on the two functions below: a RouterOS function body ( do={...} ) sees
# only its own arguments and the globals - never the caller's :local
# variables. Everything $flush needs is therefore passed in as a named
# argument, otherwise $url and $secret would be empty inside it and the fetch
# would fail on an empty URL every time.
# ----------------------------------------------------------------------------
:local url    "http://APP-HOST:3000/api/ingest/devices"
:local secret "PASTE-YOUR-CRON_SECRET-HERE"
:local batchSize 200

:local stamp ([/system clock get date] . " " . [/system clock get time])

# Drops the two characters that would break a JSON string. RouterOS has no
# replace, so this walks the string once.
:local clean do={
    :local out ""
    :for i from=0 to=([:len $1] - 1) do={
        :local c [:pick $1 $i ($i + 1)]
        :if (($c != "\"") && ($c != "\\")) do={ :set out ($out . $c) }
    }
    :return $out
}

:local items ""
:local count 0
:local sent 0

# Posts one batch and logs it. Called as:
#   $flush items=... count=... url=... secret=... stamp=...
:local flush do={
    :local body ("{\"router_time\":\"" . $stamp . "\",\"devices\":[" . $items . "]}")
    :do {
        /tool fetch url=$url http-method=post http-data=$body \
            http-header-field="Content-Type: application/json,Authorization: Bearer $secret" \
            output=none
        :log info ("devices-push: sent " . $count . " devices")
    } on-error={
        :log warning ("devices-push: POST to " . $url . " failed")
    }
}

:foreach id in=[/ip kid-control device find] do={
    :local mac [/ip kid-control device get $id mac-address]
    :if ([:len $mac] > 0) do={
        :local ip ""
        :do { :set ip [:tostr [/ip kid-control device get $id ip-address]] } on-error={ :set ip "" }
        :local up 0
        :local down 0
        :do { :set up [/ip kid-control device get $id bytes-up] } on-error={ :set up 0 }
        :do { :set down [/ip kid-control device get $id bytes-down] } on-error={ :set down 0 }

        # Prefer the DHCP hostname; fall back to the kid-control name, if any.
        :local name ""
        :do {
            :local lease [/ip dhcp-server lease find mac-address=$mac]
            :if ([:len $lease] > 0) do={ :set name [/ip dhcp-server lease get ($lease->0) host-name] }
        } on-error={ :set name "" }
        :if ([:len $name] = 0) do={
            :do { :set name [/ip kid-control device get $id name] } on-error={ :set name "" }
        }
        :set name [$clean $name]

        :local item ("{\"mac\":\"" . $mac . "\",\"ip\":\"" . $ip . "\",\"name\":\"" . $name . \
            "\",\"tx_bytes\":" . $up . ",\"rx_bytes\":" . $down . "}")
        :if ($count > 0) do={ :set items ($items . ",") }
        :set items ($items . $item)
        :set count ($count + 1)

        :if ($count >= $batchSize) do={
            $flush items=$items count=$count url=$url secret=$secret stamp=$stamp
            :set sent ($sent + $count)
            :set items ""
            :set count 0
        }
    }
}

:if ($count > 0) do={
    $flush items=$items count=$count url=$url secret=$secret stamp=$stamp
    :set sent ($sent + $count)
}
:if ($sent = 0) do={ :log info "devices-push: no devices tracked yet (is devices-setup done?)" }
