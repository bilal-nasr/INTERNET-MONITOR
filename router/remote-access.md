# Reaching the router from another network

The PPPoE line sits behind the ISP's carrier-grade NAT. The router's WAN
address is `100.107.154.46`, in the shared `100.64.0.0/10` range, and the
public address the outside world sees (`5.57.6.202` when this was written)
is shared with other customers. A connection to that public address stops at
the ISP and never reaches the router. `/ip cloud` says the same thing:
"Router is behind a NAT. Remote connection might not work." The dashboard's
Router card shows both addresses and flags this.

So publishing the public IP is not enough on its own, and opening ports on the
router (or making WinBox or WebFig reachable from the WAN) would do nothing
except add risk if the ISP ever handed out a real address. What works behind
CGNAT is a connection the home side opens **outwards**, which you then ride
back in. Checked on this router (hEX lite, mipsbe, RouterOS 7.24.4):

| Option | Works behind CGNAT | Available here | Cost |
| --- | --- | --- | --- |
| Tailscale on an always-on LAN device, as a subnet router | yes | yes, needs a device that stays on | free |
| WireGuard from the router to a small VPS | yes | yes (`/interface wireguard` exists) | a few dollars a month |
| A public IP from the ISP | n/a, removes CGNAT | ask the ISP | usually a monthly fee |
| MikroTik Back To Home | yes | **no**, the `back-to-home` commands are absent on this router | - |
| ZeroTier or Tailscale on the router itself | yes | **no**, neither the zerotier package nor containers exist for MIPS | - |

## Recommended: Tailscale subnet router on a LAN device

This needs no change on the MikroTik at all. Any machine on the LAN that stays
on (the quota-monitor host at `192.168.88.254`, a Raspberry Pi, an old phone or
laptop) runs Tailscale and advertises the LAN:

1. Install Tailscale on that machine and sign in.
2. Advertise the LAN. On Linux:
   `sudo tailscale up --advertise-routes=192.168.88.0/24`
   On Windows: `tailscale up --advertise-routes=192.168.88.0/24`, run from an
   elevated prompt.
3. In the Tailscale admin console, open that machine, choose
   **Edit route settings** and approve `192.168.88.0/24`.
4. Install Tailscale on your phone or laptop and sign in to the same account.
   From any network, `http://192.168.88.1` (WebFig), WinBox to `192.168.88.1`
   and `ssh admin@192.168.88.1` work as if you were at home.

The router sees the connection arrive from the LAN device, so its default
firewall (drop everything not from the LAN) needs no exception. The weak point
is that machine: when it is off or asleep, so is the way in.

## Without an always-on device: WireGuard to a VPS

The router dials a WireGuard peer on a VPS with a public address and keeps the
tunnel open with `persistent-keepalive=25s`. Your phone or laptop connects to
the same VPS, which forwards between the two. Outline:

1. On the VPS: install WireGuard, give it a tunnel subnet such as
   `10.99.0.0/24` (VPS `.1`, router `.2`, phone `.3`), enable IP forwarding,
   and add the router as a peer with `AllowedIPs = 10.99.0.2/32, 192.168.88.0/24`.
2. On the router:

   ```
   /interface wireguard add name=wg-remote listen-port=13231
   /interface wireguard peers add interface=wg-remote public-key="VPS-PUBLIC-KEY" \
       endpoint-address=VPS-ADDRESS endpoint-port=51820 \
       allowed-address=10.99.0.0/24 persistent-keepalive=25s
   /ip address add address=10.99.0.2/24 interface=wg-remote
   /interface list member add list=LAN interface=wg-remote
   ```

   Adding `wg-remote` to the LAN list is what lets the default firewall accept
   management traffic from the tunnel. Read the router's public key with
   `/interface wireguard print` and add it on the VPS.
3. The dual-WAN mangle rules send router-originated connections by the main
   table, so the tunnel leaves by the ISP line and fails over to the backup
   line with the default routes. Replies from the LAN to `10.99.0.0/24` are
   not load-balanced, because the `dual-wan: skip local` rule accepts anything
   bound for `local_nets`, which already holds `10.0.0.0/8`. Pick a tunnel
   subnet inside one of the `local_nets` ranges for the same reason.
4. On the phone: a WireGuard client with `AllowedIPs = 10.99.0.0/24,
   192.168.88.0/24` and the VPS as endpoint.

This is a router configuration change; try it with a backup taken first
(`/system backup save name=pre-wg dont-encrypt=yes`).

## If the ISP gives you a public IP

The dashboard will show the WAN and public addresses matching, and the card
will say the address is the router's own. Even then, do not expose WinBox,
WebFig or SSH to the internet. Open one UDP port for WireGuard instead and
connect through it, as above but with the phone peering with the router
directly and no VPS.
