# dual-wan-setup: ether5 becomes a second, plug-and-play WAN, with failover and
# 2:1 load balancing between the PPPoE line and whatever is plugged into it.
#
# Run ONCE, from New Terminal (paste) or with /import. It refuses a second run:
# it stops if routing table to_isp already exists. Take a backup first:
#     /system backup save name=pre-dualwan dont-encrypt=yes
# Restoring that backup is the undo:
#     /system backup load name=pre-dualwan.backup
#
# What ether5 accepts: any router that hands out an address by DHCP on its LAN
# port (a WISP or 4G router, another ISP's router, a phone hotspot through a
# router such as a Netis). The DHCP client's script points the HOTSPOT-check
# route at whatever gateway it is given, so swapping routers needs no edits.
# Not supported: a router whose LAN is 192.168.88.0/24 (the script disables
# the DHCP client and logs an error rather than break the LAN), a bridge-mode
# modem that needs PPPoE, or a link with a static address only. The backup
# router's admin page is its gateway address (IP > DHCP Client > client1 >
# Status), reachable from the LAN through the WAN masquerade.
#
# Failover: each line has a check host that can only be reached through it
# (1.1.1.1 via pppoe-out1, 8.8.4.4 via backup-wan), with a blackhole behind it
# so the check never leaks onto the other line. Default routes use those hosts
# as recursive gateways with check-gateway=ping, so a line that stays up but
# stops carrying traffic is still dropped. PPPoE's own default route is kept at
# distance 3 as a last resort if both check hosts stop answering ICMP. The
# blackhole also keeps netwatch "internet-probe" (1.1.1.1) honest: during an
# ISP outage it reports down instead of being answered over the hotspot.
#
# Load balancing: PCC on src+dst address, so a device keeps the same line for
# the same site (logins, banking and streaming do not break). Two thirds of
# the classes go to the ISP, one third to backup-wan. backup-wan-quota.rsc
# disables the hotspot class when the monthly cap is reached.
#
# Fasttrack stays on, limited to connection-mark=no-mark: marked connections
# must keep passing mangle or their routing mark is lost and they leave by the
# wrong line. That leaves LAN-to-LAN and router traffic fasttracked. quota-push
# toggles the same rule for its throttle; the restriction survives that. Every
# internet connection now takes the full firewall path, which on the hEX lite
# measured about 20% CPU in normal use.
#
# DNS moves to 8.8.8.8 and 1.0.0.1: the ISP's resolvers may not answer queries
# arriving through the hotspot. Changing the PPPoE client below reconnects the
# session once (a second or so).
#
# ----------------------------------------------------------------------------
:if ([:len [/routing table find name=to_isp]] > 0) do={
    :error "dual-wan-setup: already applied (routing table to_isp exists)"
}

/interface bridge port remove [find interface=ether5]
/interface ethernet set [find default-name=ether5] name=backup-wan
/interface list member add interface=backup-wan list=WAN comment="WAN2: any router on ether5"

/routing table add name=to_isp fib comment=dual-wan
/routing table add name=to_hotspot fib comment=dual-wan

# Check routes. HOTSPOT-check's gateway is a placeholder until DHCP binds.
/ip route add dst-address=1.1.1.1/32 gateway=pppoe-out1 scope=10 comment=ISP-check
/ip route add dst-address=1.1.1.1/32 blackhole distance=20 comment="ISP-check: never via hotspot"
/ip route add dst-address=8.8.4.4/32 gateway=192.168.1.1 scope=10 comment=HOTSPOT-check
/ip route add dst-address=8.8.4.4/32 blackhole distance=20 comment="HOTSPOT-check: never via ISP"

/ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 target-scope=11 check-gateway=ping routing-table=to_isp distance=1 comment="dual-wan: to_isp primary"
/ip route add dst-address=0.0.0.0/0 gateway=8.8.4.4 target-scope=11 check-gateway=ping routing-table=to_isp distance=2 comment="dual-wan: to_isp backup"
/ip route add dst-address=0.0.0.0/0 gateway=8.8.4.4 target-scope=11 check-gateway=ping routing-table=to_hotspot distance=1 comment="dual-wan: to_hotspot primary"
/ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 target-scope=11 check-gateway=ping routing-table=to_hotspot distance=2 comment="dual-wan: to_hotspot backup"
/ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 target-scope=11 check-gateway=ping distance=1 comment="dual-wan: main ISP"
/ip route add dst-address=0.0.0.0/0 gateway=8.8.4.4 target-scope=11 check-gateway=ping distance=2 comment="dual-wan: main hotspot backup"

# After the routes, so its script finds HOTSPOT-check on the first bind.
/ip dhcp-client add interface=backup-wan add-default-route=no use-peer-dns=no use-peer-ntp=no comment="WAN2: any router on ether5, sets HOTSPOT-check gateway" script=":if (\$bound = 1) do={\
    \n    :local gw [:toip \$\"gateway-address\"]\
    \n    :local ip [:toip \$\"lease-address\"]\
    \n    :if ((\$gw in 192.168.88.0/24) || (\$ip in 192.168.88.0/24)) do={\
    \n        :log error (\"backup-wan: the router on ether5 uses \" . \$gw . \", the same network as the LAN. backup-wan DHCP is now disabled: change that router's LAN address, then enable IP > DHCP Client on backup-wan again.\")\
    \n        /ip dhcp-client disable [find interface=\"backup-wan\"]\
    \n    } else={\
    \n        /ip route set [find comment=\"HOTSPOT-check\"] gateway=\$gw\
    \n        :log info (\"backup-wan: got \" . \$ip . \", gateway \" . \$gw)\
    \n    }\
    \n}\
    \n"

/ip dns set servers=8.8.8.8,1.0.0.1

/ip firewall address-list add list=local_nets address=10.0.0.0/8 comment=dual-wan
/ip firewall address-list add list=local_nets address=172.16.0.0/12 comment=dual-wan
/ip firewall address-list add list=local_nets address=192.168.0.0/16 comment=dual-wan
/ip firewall address-list add list=local_nets address=100.64.0.0/10 comment=dual-wan

/ip firewall mangle add chain=prerouting dst-address-list=local_nets action=accept comment="dual-wan: skip local"
/ip firewall mangle add chain=prerouting in-interface=pppoe-out1 connection-mark=no-mark action=mark-connection new-connection-mark=isp_conn comment=dual-wan
/ip firewall mangle add chain=prerouting in-interface=backup-wan connection-mark=no-mark action=mark-connection new-connection-mark=hotspot_conn comment=dual-wan
/ip firewall mangle add chain=prerouting in-interface=bridge dst-address-type=!local connection-mark=no-mark per-connection-classifier=both-addresses:3/0 action=mark-connection new-connection-mark=isp_conn comment="dual-wan: PCC 1/3 ISP"
/ip firewall mangle add chain=prerouting in-interface=bridge dst-address-type=!local connection-mark=no-mark per-connection-classifier=both-addresses:3/1 action=mark-connection new-connection-mark=isp_conn comment="dual-wan: PCC 2/3 ISP"
/ip firewall mangle add chain=prerouting in-interface=bridge dst-address-type=!local connection-mark=no-mark per-connection-classifier=both-addresses:3/2 action=mark-connection new-connection-mark=hotspot_conn comment="dual-wan: PCC 3/3 hotspot"
/ip firewall mangle add chain=prerouting in-interface=bridge connection-mark=isp_conn action=mark-routing new-routing-mark=to_isp passthrough=no comment=dual-wan
/ip firewall mangle add chain=prerouting in-interface=bridge connection-mark=hotspot_conn action=mark-routing new-routing-mark=to_hotspot passthrough=no comment=dual-wan
/ip firewall mangle add chain=output connection-mark=isp_conn action=mark-routing new-routing-mark=to_isp passthrough=no comment=dual-wan
/ip firewall mangle add chain=output connection-mark=hotspot_conn action=mark-routing new-routing-mark=to_hotspot passthrough=no comment=dual-wan

/ip firewall filter set [find comment="defconf: fasttrack"] connection-mark=no-mark

# Speed cap on the second WAN. With an interface as target, the first value of
# max-limit is traffic arriving on that interface (downloads) and the second is
# traffic leaving it (uploads) - the reverse of what "upload/download" suggests.
# Verified with Cloudflare speed tests through the hotspot. Placed first: a
# packet only meets the first simple queue that matches, so quota-throttle
# (the ISP quota, whole LAN) does not also catch hotspot traffic.
/queue simple add name=backup-wan-limit target=backup-wan max-limit=10M/5M comment="speed cap on the second WAN: 10M down / 5M up"
:local firstQueue [:pick [/queue simple find] 0]
:if ($firstQueue != [/queue simple find name=backup-wan-limit]) do={
    /queue simple move [find name=backup-wan-limit] destination=$firstQueue
}

# Last: from here PPPoE's own default route is only the fallback.
/interface pppoe-client set [find name=pppoe-out1] default-route-distance=3 use-peer-dns=no

:log info "dual-wan-setup: done"
