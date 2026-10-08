# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner, who runs the home MikroTik router and is the only person who signs in. They check the app for two jobs, equally often:

- **Quick glance, usually on a phone:** how much of today's window quota and this month's cap is left, and is the link up right now.
- **Deep dive, usually on a desktop:** reading statistics, WAN sessions, outages, per-device usage and the alert history to understand what happened and why.

The read-only share link exists, but no other audience was confirmed as a design target.

## Product Purpose

Tracks home internet usage from a MikroTik router, keeps the history in Postgres, and emails the owner when usage inside a daily time window crosses a quota mark, or when the monthly cap is approaching or reached. It also records every WAN link session (how long it lasted, how much it carried) and the outages between them.

Success: the owner never runs out of quota by surprise, and can explain any spike, drop or outage from the app alone.

## Positioning

The router pushes its counters to the app every 30 seconds; the app never connects to the router. That is what makes it work behind carrier-grade NAT, where the router has no reachable public address. The quota rules match a real local ISP plan: a daily time window with its own quota, a monthly cap that rolls over on a billing day, and optional free hours that don't count against the quota.

## Operating Context

- Hardware: MikroTik hEX lite, dual WAN (PPPoE primary plus a hotspot backup, PCC 2:1), DNS ad blocking on the router. A router script (`router/quota-push.rsc`) does the push; setup scripts live in `router/`.
- Hosting: production at netmonitor.bilalnasr.com on Vercel, Postgres on Supabase (eu-west-1). Timezone in use: Asia/Beirut.
- Alerts arrive by email (Resend), in the language chosen in Settings.
- Home Assistant can read the JSON feed behind the share link.

## Capabilities and Constraints

- Pages in scope for redesign: Dashboard, Statistics, Sessions, Devices (only when per-device tracking is on), Alerts, Settings, Export/Import. Login, password reset and the public share page were not included in this redesign.
- Dashboard content: today's window usage against the daily quota, the monthly cycle gauge, live throughput (last 30 minutes), link/session status, the router's public address, free-hours state, a 30-day history with anomaly flags, and a first-run setup checklist when nothing has arrived yet. It refreshes itself.
- Two languages, English and Arabic; Arabic is right-to-left (`dir` set per locale). Every surface must work mirrored.
- Light and dark themes: follow the device, or an explicit override in Settings.
- Quotas are decimal gigabytes (8 GB = 8,000,000,000 bytes).
- Optional features change what is shown: the daily quota can be off (no compliance chart), free hours can be off, per-device tracking can be off (no Devices page).
- Stack is fixed: Next.js 16 App Router, React 19, Tailwind 4, Recharts. Chart colours already use a validated colourblind-safe categorical palette (download = slot 1, upload = slot 2).
- Production code: the owner's live home monitor runs from this repo. Multi-tenant, ISP or subscription features belong in the separate Baqati repo, not here.

## Brand Commitments

No logo or brand identity beyond the app name in the dictionaries. No binding visual commitments were stated.

## Evidence on Hand

Real data only: the owner's own readings, sessions, outages, devices and alerts in the database. There are no testimonials, customers or marketing claims, and none should be invented.

## Product Principles

1. **The answer first.** "How much is left" and "is it up" must be readable in a couple of seconds on a phone, before any detail.
2. **Explainable numbers.** Every figure should trace back to how it was measured (window, cycle, free hours, baseline), so the owner can trust an alert.
3. **Gaps are information.** Missing readings, outages and stale links are shown honestly, never smoothed over.
4. **Equal in both languages.** Arabic is a full citizen, not a translated afterthought; layouts mirror correctly and numbers stay legible.

## Accessibility & Inclusion

Charts never rely on colour alone (legends or direct labels), and the palette is checked for colourblind separation and contrast on both themes. Right-to-left reading must be fully supported.
