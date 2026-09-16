# Networking

Serverless WebRTC, the same shape as the 2D project: no backend, no
accounts, one browser tab hosts and everyone else joins with copy-pasted
codes. `rtc.js` has two layers.

## Transport (`Rtc`)

Identical in spirit to the 2D `src/rtc.js`: `Rtc.invite()` creates an
offer, waits for ICE gathering (STUN only, Google's public servers, 4s
cap), and returns a base64 code plus an `accept(replyCode)`;
`Rtc.join(code)` produces the answer code and a promise of the data
channel. Codes travel by hand — chat, mail, pigeon. No TURN relay, so
symmetric-NAT pairs may fail to connect; both sides then simply stay
offline. Channels are JSON message pipes with open/close hooks.

## Session

Unlike the 2D table there is **no rules engine and no authoritative
state**: the world is built deterministically from the URL parameters, so
every peer already has an identical town, terrain, and cast. The session
only carries what players change:

| op | payload | meaning |
|---|---|---|
| `pose` | `id, x, y, z, w(yaw), m(moving)` | a peer's feet + heading, ~8Hz |
| `door` | `i, open` | door `i` (index in build order) toggled |
| `env`  | `weather, int, night, autumn` | the P/O/N/I switches |

Roles:

- **HostSession** — creates invites (one per guest, click "create invite"
  again for the next), stamps every guest op with its sender id, applies it
  locally and relays it to every other guest. The host tab is the relay: if
  it closes, guests lose each other. On connect the host sends `welcome`
  with its `location.search`; a guest whose own params differ shows a
  warning, because the deterministic worlds would not match.
- **GuestSession** — pastes the invite, returns an answer code, then
  exchanges ops with the host only.

Remote peers appear as generative people (seeded from their peer id),
walking with the standard gait when their `m` flag is set, position-lerped
between 8Hz updates. Up to 8 avatars per session.

## How ambient life stays identical with zero traffic

The whole simulation — herds, wandering people, riders, butterflies, fish,
clouds, the arena show — runs on a **fixed 50ms tick indexed from world
time zero**, and every random decision comes from a **per-wanderer seeded
RNG stream**. Life is therefore a pure function of the world clock: two
clients with the same URL compute byte-identical worlds without exchanging
a single byte about them. The host's `welcome` carries its current world
clock; a joining guest fast-forwards its own ticks to that instant and
stays in lockstep from then on. (Only shooting stars remain local — pure
cosmetics.)

What is DRAWN is not the tick itself: everything a tick moves (wanderers,
tour riders, cart teams' gait, dock hands) registers a *track* in
index.html, and every frame draws the blend between the state before and
after the latest tick, one tick (50ms) behind, so walkers and their legs
move fluidly instead of holding each pose for three frames and jumping.
Before the next tick the sim's own state is written back, so the blend never
feeds into the simulation (verified: the sim state is byte-identical with
and without blended frames between ticks). Carts, the barge and the boat
place themselves every frame from their tick state as before. `?smooth=0`
draws the raw ticks, for comparison. Anything new that a tick moves must
register a track, or it will stutter.

Player state rides in the `pose` op: position, heading, moving flag,
resting kind (sit/lie), and mount index. Remote peers render as person
avatars whose pose rebuilds on change — walking, seated on the bench they
actually sat on, or in riding pose lifted onto their mount — and a mounted
animal is frozen out of the shared simulation on every client and driven by
its rider's poses, resuming its deterministic wandering for everyone when
dismounted. Doors/windows (`door`) and the environment switches (`env`)
are broadcast as before.

## UI

Press **M** for the panel (bottom right). Host: *create invite* → send the
code → paste the reply → *apply*. Guest: paste the invite → *apply* → send
back the reply code. The status line shows `hosting/joined · N online`.
Everything works in the single-file `dist/bannerfield.html` too — WebRTC
needs no server, only a way to exchange the codes.
