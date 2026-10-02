# adblock-setup: network-wide ad blocking with RouterOS's DNS adlist.
#
# Run ONCE, from New Terminal (paste) or with /import. It refuses a second run:
# it stops if an adlist entry commented "ad blocker: ..." already exists.
#
# How it works: every LAN device gets the router (192.168.88.1) as its DNS
# server from DHCP. The router downloads hosts-format block lists, keeps them
# in RAM, and answers 0.0.0.0 / :: for any listed name, so ads and trackers
# fail to load in every browser and app with nothing installed on the devices.
# The lists are re-downloaded by RouterOS on its own schedule.
#
# Lists: AdAway (~6.5k names) and Peter Lowe's (~3.5k). Together they took about
# 1.2 MB of RAM on the hEX lite (64 MB, ~23 MB free afterwards). StevenBlack's
# unified list (~80k names) blocks more but needs far more RAM; check
# /system resource free-memory before adding it:
#     /ip dns adlist add url="https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" ssl-verify=yes
#
# Devices that send DNS to another server (8.8.8.8 hard-coded, say) are
# redirected to the router by the two dstnat rules. Two mangle accept rules keep
# that DNS traffic out of the dual-wan PCC: without them, a query to 8.8.8.8 is
# marked for a WAN line in prerouting, before dstnat redirects it to the router,
# and the router's replies then follow the connection's routing mark out to
# the internet instead of back to the device. They are only added when
# dual-wan-setup.rsc has been applied (its PCC rules are the anchor).
#
# Not blocked: YouTube and Facebook/Instagram ads (same domains as the
# content), and devices using encrypted DNS of their own (iCloud Private Relay,
# Android Private DNS set to a hostname, a browser's secure DNS with a chosen
# provider) - those queries never reach port 53.
#
# If a site breaks, allow its domain with a static entry that forwards it to
# the upstream resolvers, for example:
#     /ip dns static add name=example.com type=FWD forward-to=8.8.8.8 match-subdomain=yes
# To switch the blocker off: /ip dns adlist disable [find comment~"ad blocker"]
#
# ----------------------------------------------------------------------------
:if ([:len [/ip dns adlist find comment~"ad blocker"]] > 0) do={
    :error "adblock-setup: already applied (an \"ad blocker\" adlist exists)"
}

/ip dns adlist add url="https://adaway.org/hosts.txt" ssl-verify=yes comment="ad blocker: AdAway"
/ip dns adlist add url="https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext" ssl-verify=yes comment="ad blocker: Peter Lowe"

:local pcc [/ip firewall mangle find comment="dual-wan: PCC 1/3 ISP"]
:if ([:len $pcc] > 0) do={
    /ip firewall mangle add chain=prerouting in-interface=bridge protocol=udp dst-port=53 action=accept place-before=$pcc comment="ad blocker: DNS stays out of PCC (redirected to the router)"
    /ip firewall mangle add chain=prerouting in-interface=bridge protocol=tcp dst-port=53 action=accept place-before=$pcc comment="ad blocker: DNS stays out of PCC (redirected to the router)"
}

/ip firewall nat add chain=dstnat in-interface-list=LAN dst-address=!192.168.88.1 protocol=udp dst-port=53 action=redirect to-ports=53 comment="ad blocker: force LAN DNS through the router"
/ip firewall nat add chain=dstnat in-interface-list=LAN dst-address=!192.168.88.1 protocol=tcp dst-port=53 action=redirect to-ports=53 comment="ad blocker: force LAN DNS through the router"

:log info "adblock-setup: done"
