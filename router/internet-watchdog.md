# Reconnecting when the ISP stops carrying traffic

A PPPoE session can stay `running` while the ISP has an outage behind it, so
interface state alone never reports it and no new session would start. RouterOS
solves this with **netwatch**, which probes a public address and runs a script
when it stops answering.

Do not do this with a `/ping` in a scheduled script. On RouterOS 7.24 `/ping`
returns nothing usable from a script, with or without `as-value`, so a check
like `:if ([/ping 1.1.1.1 count=3] = 0)` never becomes true and the watchdog
silently does nothing. Verified on a hEX lite running 7.24.2.

## Setup

Add [`pppoe-reconnect.rsc`](pppoe-reconnect.rsc) as a script first, then one
command in **New Terminal**:

```
/tool netwatch add name=internet-probe host=1.1.1.1 type=icmp interval=1m \
    packet-count=3 packet-interval=1s thr-loss-percent=100 startup-delay=2m \
    down-script="/system script run pppoe-reconnect" \
    up-script=":log info \"internet-probe: connectivity restored\"" \
    comment="no internet for 3 consecutive pings -> fresh WAN session"
```

`thr-loss-percent=100` with `packet-count=3` means all three packets must be
lost before it acts, so a single dropped packet does nothing. `startup-delay`
stops it firing while the router is still booting.

## Checking it

```
/tool netwatch print
```

`status` should read `up`. When it flips to `down` the reconnect runs, which
ends the current session and starts a new one on the app's Sessions page.

To prove the down path works without touching the real WAN, point a throwaway
probe at an unroutable address and watch the log:

```
/tool netwatch add name=probe-test host=192.0.2.1 type=icmp interval=20s \
    packet-count=2 thr-loss-percent=100 startup-delay=0s \
    down-script=":log warning \"probe-test: down-script fired\""
# wait ~40s, check Log, then:
/tool netwatch remove [find name=probe-test]
```

## What the app learns from it

`quota-push` reads this probe's `status` on every run, by the name
`internet-probe`, so keep that name. While the probe is down, the pushes fail.
The push that finally gets through carries the moment quota-push first saw the
probe down, and the outage is labelled **No internet from the ISP** on the
Sessions page, even though the watchdog was cycling PPPoE the whole time.
Without the probe, those outages show as **ISP dropped PPPoE** or as a
monitoring gap.
