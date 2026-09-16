# Plan: the sword, and figures struck down

Status: IMPLEMENTED 2026-09-14 (combat.js, sword.js; archery.js, skeleton.js roll,
faces.js "downed", village-life.js strike, index.html wiring). The analysis below
was written first, as asked; the user's decisions are in section 7.

## 1. What is asked

- A second weapon for the player: a sword, reaching about 1.5 m ahead.
- Anything alive that is hit by either weapon (sword or arrow) falls down:
  onto its side, eyes red, no longer moving. People and animals alike.

## 2. What already exists and can be reused

| Need | Already there |
|---|---|
| Sword model in a hand | tools.js `sword` (the gate guard's), placed at a hand every frame |
| Hands on the player's body | `ensureAvatar("self")` records both hands; the rig's "L" is the figure's right hand |
| Hitting a figure precisely | archery.js: bounding sphere per figure, then each body part as a capsule (`herd.ends`) |
| Stopping a wandering animal or person | `w.frozen` (mounts use it): the 50 ms simulation no longer moves it |
| Eyes that change | faces.js features: animal eyes and people's eyes are both face marks with role "eye" |
| Arrows following a body part | archery.js part frames, rebuilt from the part's ends every frame |
| Telling other players | ops over the multiplayer session (arrow, drink, eat already do this) |

## 3. What is new

### 3.1 The "down" state (shared by both weapons)

A struck figure:

1. **Tips over onto its side**, over about 0.5 s rather than at once. This
   needs one new thing in the engine: a roll angle for the whole figure
   (`an.roll`, a rotation about its own forward axis), added where the
   skeleton places the figure's root (skeleton.js, next to `rotY`). It works
   for both figure engines (composite and instanced) and costs nothing when
   zero. People fall with legs straight (their walk swing stopped); animals
   end with their legs sticking out sideways.
2. **Lies on the ground properly**: when it falls, its lowest point on its
   side is worked out from its own parts (how far they reach sideways), so a
   cow and a cat both end touching the ground rather than floating or sunk.
3. **Stops moving**: the walk and all idle motion stop (animation clock and
   swing frozen); whatever drives it stops (see 3.3).
4. **Red eyes**: a new eye feature in faces.js, "red" (the eye painted dark
   red, no pupil), in a new emotion "downed". Works for people's and
   animals' eyes alike, since both are face marks.
5. **Falls silent**: it no longer talks or makes its animal call, and the
   click actions for it (greet, rouse, ride) stop being offered.
6. Arrows already stuck in it stay stuck and go down with it.

### 3.2 The sword

- **Controls.** Proposal: **1** bow, **2** sword, pressing the same key again
  puts it away; B keeps toggling the bow as now. **[choose]** — or V for the
  sword next to B.
- **In hand.** The existing sword tool in the player's right hand, upright
  and slightly forward.
- **Swing.** Left click swings (about 0.35 s): the sword arm sweeps from right
  to left across the body (a new arm pose on the player's body, driven by
  time). A short cooldown so clicking fast does not chain hits.
- **What it hits.** At the middle of the swing, five short lines fan out from
  the camera across about 100 degrees ahead, each 1.5 m long, at chest
  height and slightly below. They are tested against every figure with the
  **same test the arrows use** — which means moving that test out of
  archery.js into a small shared module (combat.js), not copying it. The
  nearest figure hit is struck down. Walls stop the blade (a clang, no hit).
- **Sounds.** A whoosh for every swing, a thud on a hit, a clang on stone.

### 3.3 Everything that moves figures must respect "down"

This is most of the work, because figures are driven by different systems:

| Figures | Driven by | What "down" needs |
|---|---|---|
| Wandering animals, countryside people, arena fighters | wanderers | `w.frozen = true` — already works |
| Gate guards, church and palace folk | nothing (they stand) | nothing extra |
| Villagers | village-life.js day schedule (4 pose figures, one shown) | a down state: show the walking figure, skip its schedule, give up its bed/seat/job claims |
| Riders on the tour lane | `moveRiders` | skip its lane progress; rider and horse are one fused figure, so both fall together **[choose: acceptable?]** |
| Cart teams and drivers | cart lanes (`placeCarts`) | stop that cart; the team animals fall, the cart stays **[choose]** |
| Flying birds and bats | wanderers with altitude | fall to the ground first, then lie there |
| Fish, shark, dolphin | swimmers | sink to the bed (or float up) instead of lying on the side **[choose]** |
| The mount you ride | player | cannot be struck by you (excluded, as now for arrows) |
| Other players' avatars | multiplayer | **[choose]** exclude, or allow |

### 3.4 Multiplayer

Every figure needs a stable id that is the same on every player's machine.
The world is built deterministically, so an id of the form (herd name,
figure index) works. A strike is sent as an op `down` with that id and the
fall direction; the other side applies the same fall.

### 3.5 How long they stay down **[choose]**

- a) for good (until the page is reloaded) — simplest;
- b) they get up again after some time (e.g. 2 minutes), eyes back to normal,
  and carry on — needs a "get up" transition and the drivers resuming;
- c) they stay until you leave the area and come back.

## 4. Cost

- Frame time: negligible. The sword test runs only when you swing (five
  short lines against the figures near you). Downed figures cost less than
  moving ones (no gait).
- The shared hit test is already proven by the arrows.

## 5. Order of work

1. **Core**: the roll in the skeleton, the down state (fall, ground contact,
   stop, red eyes, silence), the shared hit test (combat.js), arrows striking
   figures down. Wanderers and standing figures first.
2. **Sword**: controls, the sword in hand, the swing pose, the melee test,
   sounds.
3. **Other drivers**: villagers, riders, cart teams, fliers, swimmers.
4. **Multiplayer and the recovery choice** from 3.5.

## 6. Decisions needed before starting

1. Keys: 1 / 2 (proposal) or B / V?
2. How long figures stay down: a), b) or c)?
3. Riders: the horse falls with its rider (one figure) — acceptable?
4. Cart teams: team animals fall and the cart stops — acceptable?
5. Fish and other swimmers: sink, or float up?
6. Other players' avatars: excluded, or can be struck down too?

## 7. Decided (the user, 2026-09-14) and done

1. Keys: **B** bow, **V** sword, the **mouse wheel** runs through none / bow / sword.
2. Struck figures stay down **for good**.
3. Riders: the struck one falls, the other goes on -- a thrown rider falls from the
   saddle and the horse carries on along the tour; a felled horse falls and its rider
   walks on along the tour (the fused figure is swapped for two).
4. Carts stop when their driver or **any** beast of the team is struck.
5. Swimmers **float up** belly-up.
6. Other players are excluded (not among the targets).
7. Blood: a ragged dark-red splat where an arrow or the sword went in, kept in the
   struck part's frame like a stuck arrow.

8. The fisherman in his boat is a target too: struck, he falls into the bottom of the
   boat (its boards are a floor, like a cart's bed -- not the river), and the boat stays
   where it is: no more rowing or fishing, the rod put away.
