# devices-setup.rsc: one-time router preparation for per-device accounting.
#
# Paste into System > Scripts as "devices-setup", run it once, then delete it.
# What it does, and why:
#   1. Adds a kid-control entry with no limits. RouterOS only tracks per-device
#      byte counters (/ip kid-control device) once at least one kid exists; the
#      entry restricts nothing. This is the only step it always takes.
#   2. It can also disable the default fasttrack rule - but only if you tell it
#      to, with the switch at the top of the script. It does NOT do this by
#      default. See below.
#
# About fasttrack, and why this is your decision and not the script's:
#   Fasttracked packets skip the firewall. Kid-control accounting happens
#   inside the firewall path, so IF kid-control cannot see fasttracked traffic
#   the per-device counters stay near zero while the WAN counters climb. That
#   is the common report, but it was not verified on this hardware, and
#   turning fasttrack off unnecessarily costs real CPU on a hEX lite (every
#   packet then takes the full firewall path) for no benefit at all.
#   So: check, then choose.
#
# How to check, in about five minutes:
#   1. Run this script once with disableFasttrack left at "no".
#   2. Use the internet normally for a few minutes (stream something).
#   3. WinBox: IP > Kid Control > Devices, look at the Bytes Up / Bytes Down
#      columns. Terminal equivalent: /ip kid-control device print detail
#   4. If those numbers are rising, kid-control counts fasttracked traffic on
#      your build: leave disableFasttrack at "no" and keep fasttrack's speed.
#      If they are stuck at 0 (or barely move) while Interfaces shows real WAN
#      traffic, set disableFasttrack to "yes" below, run the script again, and
#      repeat step 2-3: the numbers should now rise.
#
# ----------------------------------------------------------------------------
# "no" (default) leaves the firewall alone. "yes" disables the rule commented
# "defconf: fasttrack". Change this only after the check described above.
:local disableFasttrack "no"

:if ([:len [/ip kid-control find name="all-devices"]] = 0) do={
    /ip kid-control add name="all-devices" comment="placeholder: makes RouterOS track per-device counters"
    :log info "devices-setup: added kid-control placeholder"
} else={
    :log info "devices-setup: kid-control placeholder already present"
}

:local ft [/ip firewall filter find comment="defconf: fasttrack"]
:if ($disableFasttrack = "yes") do={
    :if ([:len $ft] > 0) do={
        /ip firewall filter disable $ft
        :log warning "devices-setup: fasttrack DISABLED because disableFasttrack=yes - CPU load will rise; undo lines are at the bottom of this script"
    } else={
        :log warning "devices-setup: disableFasttrack=yes but no rule with comment 'defconf: fasttrack' exists - nothing was changed"
    }
} else={
    :log info "devices-setup: fasttrack left ON (disableFasttrack=no). Check IP > Kid Control > Devices after a few minutes of traffic: if Bytes Up/Down stay at 0, set disableFasttrack=yes and run again."
}

# ---- undo (run these two lines to go back) ---------------------------------
# /ip firewall filter enable [find comment="defconf: fasttrack"]
# /ip kid-control remove [find name="all-devices"]
