# devices-setup.rsc: one-time router preparation for per-device accounting.
#
# Paste into System > Scripts as "devices-setup", run it once, then delete it.
# What it does, and why:
#   1. Adds a kid-control entry with no limits. RouterOS only tracks per-device
#      byte counters (/ip kid-control device) once at least one kid exists; the
#      entry restricts nothing.
#   2. Disables the default fasttrack rule. Fasttracked packets skip the
#      firewall, and kid-control counts inside it, so with fasttrack on the
#      counters stay near zero. This costs CPU on a hEX lite: every packet now
#      takes the full firewall path. Re-enable it with the undo block below when
#      per-device tracking is switched off.
#
# ----------------------------------------------------------------------------
:if ([:len [/ip kid-control find name="all-devices"]] = 0) do={
    /ip kid-control add name="all-devices" comment="placeholder: makes RouterOS track per-device counters"
    :log info "devices-setup: added kid-control placeholder"
}
:local ft [/ip firewall filter find comment="defconf: fasttrack"]
:if ([:len $ft] > 0) do={
    /ip firewall filter disable $ft
    :log info "devices-setup: fasttrack disabled so kid-control sees all traffic"
}

# ---- undo (run these two lines to go back) ---------------------------------
# /ip firewall filter enable [find comment="defconf: fasttrack"]
# /ip kid-control remove [find name="all-devices"]
