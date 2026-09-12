# throttle-setup: create the queue quota-push enables when the app says so.
#
# Run ONCE, from WinBox New Terminal or by pasting into a script and running it.
# It is idempotent: a second run finds the queue and does nothing.
#
# What it creates: a simple queue over the whole LAN, disabled. quota-push
# enables it while the app's reply carries "throttle":true and disables it
# again afterwards. Change max-limit to the speed you want the house to drop
# to; 2M/2M keeps messaging and browsing usable and makes video unpleasant.
#
# Why fasttrack is involved: the default configuration fasttracks established
# connections, and fasttracked packets never reach a queue. quota-push
# therefore disables the rule with comment "defconf: fasttrack" while the
# queue is on and re-enables it after. On a hEX lite every packet then goes
# through the full firewall, which costs CPU, but only for as long as the
# throttle is on, and a throttled link carries little traffic anyway.
#
# The name must match the throttleQueue value at the top of quota-push, and
# the quota-push script needs policy read,write,test to toggle either object.
#
# ----------------------------------------------------------------------------
:if ([:len [/queue simple find name="quota-throttle"]] = 0) do={
    /queue simple add name=quota-throttle target=192.168.88.0/24 max-limit=2M/2M \
        disabled=yes comment="enabled by quota-push when over quota"
    :log info "throttle-setup: queue quota-throttle created (disabled)"
} else={
    :log info "throttle-setup: queue quota-throttle already exists"
}
