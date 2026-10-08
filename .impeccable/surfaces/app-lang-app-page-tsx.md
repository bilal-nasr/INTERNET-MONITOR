---
version: 1
slug: "app-lang-app-page-tsx"
primary_target: "app/[lang]/(app)/page.tsx"
related_targets: ["app/[lang]/(app)/stats/page.tsx","app/[lang]/(app)/sessions/page.tsx","app/[lang]/(app)/devices/page.tsx","app/[lang]/(app)/alerts/page.tsx","app/[lang]/(app)/settings/page.tsx","app/[lang]/(app)/export/page.tsx"]
---

# Signed-in app (dashboard, analysis pages, settings & export)

Scope: every page under `app/[lang]/(app)/` and the components they render. Login, password reset and the public share page are out of scope for this redesign.

Visitor mode: Operate. One owner, glancing on a phone or digging in on a desktop, equally often.

Task: answer three readings at once (today's window quota left, this billing cycle's cap left, whether the link is up and how hard it is pulling), then explain any spike, drop, outage or alert from the analysis pages.

Constraints: English and Arabic (RTL) equally; light and dark themes (device or override); every number currently shown stays visible; the validated chart series palette stays for data colour; nothing decorative or gamey; must not look like a generic admin kit.

Chosen direction: The Stairwell Meter (assigned by the roll, seed 9aed7a82). Memorable moment: counters that roll like meter drums when a push lands, and the link's disc spinning at the speed of the line.

Unresolved: none recorded.

## Direction contract

THESIS: The line is read like the utility meter on a Beirut stairwell: every byte counter is a row of number drums, and live throughput is the meter's disc turning. Refuses the KPI-tile grid with a blue accent and the dark neon ops wall.

OWN-WORLD: Enamel cabinet green (#24402f) owns the top bar and selected states; a cool brushed-plate ground (#e7eae3 light, deep green-black at night); counters set as black drums with off-white digits in fixed cells, the last cell's wheel red. Readex Pro for both scripts; one tight type scale, rank by weight, case and one reversed plate per screen. Hairline plate rules, small engraved-style labels, square-cornered plates.

STORY: The owner opens the app and in two seconds reads today's window, the cycle and the link from three equal meter windows; then scrolls or switches page to see why: history at one fixed scale, sessions and outages stamped in place, devices as a fixed roster.

FIRST VIEWPORT: Green cabinet bar: app name at the start, page tabs, language and account at the end. Under it, a full-width strip of three equal meter windows: Today's window (drums for used, quota and what is left, progress rule beneath), This cycle (drums, cap, projection), Link (state, WAN, uptime, public address, the spinning disc with down/up rates). Then the 30-day history at full width and the latest session with stamps. On a phone the three windows stack in the same order, still above the fold for the first two.

FORM: The Stairwell Meter, position 4 on the ordered list of seven, seed key 9aed7a82. Signature move: drum counters that roll digit by digit when a new push lands, and a disc whose rotation speed follows live throughput (static with a number under reduced motion). Raises kept: one tight type scale (timetable rack); nothing disappears, it is stamped (ticket wallet); one fixed scale for comparisons (botanical folio); devices as a fixed roster (character catalog).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
