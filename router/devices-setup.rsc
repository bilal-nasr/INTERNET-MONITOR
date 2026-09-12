# devices-setup.rsc: one-time router preparation for per-device accounting.
#
# Paste into System > Scripts as "devices-setup", run it once, then delete it.
#
# All of this was measured on the real hardware - hEX lite, RouterOS 7.24.2 -
# not assumed:
#
#   * One kid-control USER is all that is needed. With a single user present,
#     RouterOS tracks every LAN device by itself: entries appear under
#     /ip kid-control device marked "dynamic" with per-MAC bytes-up and
#     bytes-down. You do NOT add devices by hand, and this script does not.
#     Remove the user and every dynamic device entry disappears within about
#     45 seconds, taking the counters with it.
#
#   * The default "defconf: fasttrack" rule is LEFT ALONE. The belief that
#     fasttracked traffic escapes kid-control accounting is wrong on this
#     build: with fasttrack enabled and untouched, a ~20 MB download raised
#     that device's bytes-down by 22,596,238 bytes. Counting works fine with
#     fasttrack on, so disabling it would cost the hEX lite real CPU - every
#     packet taking the full firewall path - and buy nothing. Earlier versions
#     of this script disabled it; if you ran one of those, put it back with:
#         /ip firewall filter enable [find comment="defconf: fasttrack"]
#     (quota-push still toggles that rule while THROTTLING, which is a
#     different matter: simple queues really are bypassed by fasttrack.)
#
#   * THE HAZARD THIS SCRIPT EXISTS TO AVOID. A kid-control user created with
#     RouterOS defaults comes with a WEEKLY SCHEDULE - working hours only, e.g.
#     mon 7h-21h, sat 6h-22h. Outside those hours kid-control BLOCKS the
#     devices attached to the user. Adding a "harmless placeholder" the naive
#     way therefore knocks the whole LAN offline every night. This script
#     creates the user with every day allowed around the clock, and then logs
#     the schedule it actually set so you can see it for yourself.
#
# ----------------------------------------------------------------------------
:local userName "all-devices"

# Spellings for "allowed all day", tried in order. 0h-24h is the natural one;
# 0s-1d is RouterOS's other way of writing a full day. The exact accepted
# spelling was NOT verified on hardware, so the script tries both, refuses to
# create the user at all if neither is accepted, and prints what it set.
:local candidates {"0h-24h";"0s-1d"}

:local existing [/ip kid-control find name=$userName]
:if ([:len $existing] > 0) do={
    :log info ("devices-setup: kid-control user " . $userName . " already exists - not creating a second one")
} else={
    :local made false
    :foreach a in=$candidates do={
        :if (!$made) do={
            :do {
                /ip kid-control add name=$userName \
                    comment="placeholder: makes RouterOS track per-device counters; must stay allowed 24/7" \
                    mon=$a tue=$a wed=$a thu=$a fri=$a sat=$a sun=$a
                :set made true
                :log info ("devices-setup: created kid-control user " . $userName . " with every day set to " . $a)
            } on-error={
                :log info ("devices-setup: schedule spelling " . $a . " was rejected, trying the next one")
            }
        }
    }
    :if (!$made) do={
        :log error ("devices-setup: could NOT create " . $userName . " with an always-allowed schedule, so nothing was created. Do NOT add it with the defaults: RouterOS would allow working hours only and cut the LAN off outside them. Add it in WinBox under IP > Kid Control and set every day to the full 24 hours by hand.")
    }
}

# ---- show the schedule that is actually in force ---------------------------
# Read it back rather than trust the add. Every day must cover the whole day;
# anything that looks like working hours will block the LAN outside them.
:local kid [/ip kid-control find name=$userName]
:if ([:len $kid] > 0) do={
    :local k ($kid->0)
    :foreach d in={"mon";"tue";"wed";"thu";"fri";"sat";"sun"} do={
        :local v "?"
        :do { :set v [:tostr [/ip kid-control get $k $d]] } on-error={ :set v "?" }
        :log info ("devices-setup: schedule " . $d . " = " . $v)
    }
    :log warning ("devices-setup: check the seven schedule lines above in Log. If any of them is a working-hours range rather than the whole day, fix it in IP > Kid Control before leaving, or the LAN will be blocked outside those hours.")
}

# ---- undo (run this line to go back) ---------------------------------------
# /ip kid-control remove [find name="all-devices"]
