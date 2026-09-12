# throttle-setup: create the queue quota-push enables when the app says so.
#
# Run ONCE, from WinBox New Terminal or by pasting into a script and running it.
# It is idempotent: a second run finds the queue and does nothing.
#
# What it creates: a simple queue over the whole LAN, disabled. quota-push
# enables it while the app's reply carries "throttle":true and disables it
# again afterwards. Change maxLimit to the speed you want the house to drop
# to; 2M/2M keeps messaging and browsing usable and makes video unpleasant.
#
# CHECK lanTarget BELOW. It defaults to RouterOS's own 192.168.88.0/24. If your
# LAN was renumbered, a queue targeting the wrong subnet matches no traffic and
# throttles nothing - silently, with no error anywhere. Find the right value in
# WinBox under IP > Addresses (the address on the bridge, as a network:
# 192.168.1.1/24 on the bridge means lanTarget "192.168.1.0/24"), or in the
# terminal with: /ip address print
#
# Why fasttrack is involved: the default configuration fasttracks established
# connections, and fasttracked packets never reach a queue. quota-push
# therefore disables the rule with comment "defconf: fasttrack" while the
# queue is on and re-enables it after. On a hEX lite every packet then goes
# through the full firewall, which costs CPU, but only for as long as the
# throttle is on, and a throttled link carries little traffic anyway.
#
# The throttle is not instant for transfers already in progress: disabling the
# fasttrack rule only stops NEW connections being fasttracked. A connection
# already fasttracked keeps bypassing this queue until its connection-tracking
# entry is gone, which for an established TCP download is
# tcp-established-timeout - 1 day by default (/ip firewall connection
# tracking). New connections are limited at once; the download that blew the
# quota may not be. To cut everything in flight, run by hand:
#     /ip firewall connection remove [find]
# which drops EVERY tracked connection, not just the fasttracked ones, so VoIP
# calls and SSH sessions have to re-establish.
#
# The name must match the throttleQueue value at the top of quota-push, and
# the quota-push script needs policy read,write,test to toggle either object.
#
# ----------------------------------------------------------------------------
:local queueName "quota-throttle"
:local lanTarget "192.168.88.0/24"
:local maxLimit  "2M/2M"

:if ([:len [/queue simple find name=$queueName]] = 0) do={
    /queue simple add name=$queueName target=$lanTarget max-limit=$maxLimit \
        disabled=yes comment="enabled by quota-push when over quota"
    :log info "throttle-setup: queue $queueName created (disabled) for $lanTarget at $maxLimit"
} else={
    :log info "throttle-setup: queue $queueName already exists"
}
