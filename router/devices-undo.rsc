# devices-undo.rsc: take the router back to how it was before devices-setup.
#
# Turning per-device tracking off in the app stops it STORING per-device
# counters. It does not reach the router: the kid-control user devices-setup
# created is still there, RouterOS is still tracking every LAN device, and the
# devices-push scheduler is still posting every minute to an endpoint that now
# answers "paused". This script is the other half of that switch.
#
# WinBox:
#   1. System > Scripts > "+" : Name = devices-undo, paste everything below the
#      dashed line into Source. Policies needed: read, write, policy, test.
#   2. Run it once, check the Log, then delete the script.
#
# Terminal equivalent:
#   /system script add name=devices-undo policy=read,write,policy,test source=[...]
#   /system script run devices-undo
#
# What it removes:
#   * the devices-push scheduler and script, so the router stops posting;
#   * the "all-devices" kid-control user, which is what makes RouterOS track
#     per-device counters at all. Every dynamic entry under
#     /ip kid-control device disappears with it, within about 45 seconds, and
#     the per-MAC bytes-up / bytes-down counters go with them.
#
# What it does NOT touch, and why:
#   * THE FASTTRACK RULE. devices-setup leaves "defconf: fasttrack" alone, so
#     there is nothing to restore. Measured on this hardware - hEX lite,
#     RouterOS 7.24.2 - kid-control counts fasttracked traffic correctly: with
#     the rule enabled and untouched, a ~20 MB download raised that device's
#     bytes-down by 22,596,238 bytes. An older version of devices-setup used to
#     disable the rule; if you ran that one and it is still disabled, this
#     script re-enables it, which is the only fasttrack change it will make.
#   * quota-push and its scheduler, the WAN readings, and everything already
#     stored in the app. Per-device history stays in the database until the
#     retention job ages it out; nothing here deletes data.
#
# Running it twice is harmless: each step checks first and logs what it found.
# ----------------------------------------------------------------------------
:local userName "all-devices"

# ---- stop pushing ----------------------------------------------------------
:local sched [/system scheduler find name="devices-push"]
:if ([:len $sched] > 0) do={
    /system scheduler remove $sched
    :log info "devices-undo: removed the devices-push scheduler"
} else={
    :log info "devices-undo: no devices-push scheduler found"
}

:local script [/system script find name="devices-push"]
:if ([:len $script] > 0) do={
    /system script remove $script
    :log info "devices-undo: removed the devices-push script"
} else={
    :log info "devices-undo: no devices-push script found"
}

# ---- stop counting ---------------------------------------------------------
# Removing the user is what actually ends per-device accounting. Only the
# placeholder this project creates is removed; a kid-control user someone added
# for real parental control is left alone, and is reported instead.
:local kid [/ip kid-control find name=$userName]
:if ([:len $kid] > 0) do={
    /ip kid-control remove $kid
    :log info ("devices-undo: removed kid-control user " . $userName . \
        " - dynamic device entries and their counters disappear within about 45 seconds")
} else={
    :log info ("devices-undo: no kid-control user named " . $userName . " - nothing to remove")
}

:local others [/ip kid-control find]
:if ([:len $others] > 0) do={
    :log warning ("devices-undo: " . [:len $others] . " other kid-control user(s) remain, so RouterOS " . \
        "keeps tracking devices. They were not created by this project and have been left alone.")
}

# ---- fasttrack: only ever put back, never taken away -----------------------
:local ft [/ip firewall filter find comment="defconf: fasttrack" disabled=yes]
:if ([:len $ft] > 0) do={
    /ip firewall filter enable $ft
    :log warning "devices-undo: re-enabled the disabled defconf: fasttrack rule (an old devices-setup turned it off; it is not needed for counting)"
} else={
    :log info "devices-undo: defconf: fasttrack left exactly as it was"
}

:log info "devices-undo: done. Turn per-device tracking off in the app's Settings as well, if it is still on."
