# Plan → 3D home: authoring pipeline

How to turn a floor plan (CAD screenshot, brochure, phone photo) into a home in
`src/data/homes/`. Follow the steps **in order** — each one exists because
skipping it shipped a wrong home.

The failure this pipeline is built around: the Pandaul puja (2026-10-02) was
first built with its door on the passage side and a solid wall to the hall —
the opposite of the plan. Every automated check passed, because both sides of
the wrong wall agreed with each other. Geometry tests prove a home is
*consistent*; only steps 0, 2, 3 and 8 prove it is *the plan*.

The same day it happened again with Bedroom 4 (door put in a wall that is
unbroken on the plan) and Kitchen 2 (door at the wrong end of the right wall):
doors were placed by where they "usually" go instead of by reading the gap.

> **THE DOOR RULE.** A door is where a room's outline has **no wall line** for a
> door's width (≈ 2'6"–3'6"). Most residential CAD plans draw no swing arc at
> all — the gap *is* the door. Never place a door anywhere the outline is
> unbroken, and never leave a door-width gap without an opening. A gap much
> wider than a door, or a side with no wall line at all, is an open passage.

---

> **THE OPEN-DOORWAY RULE.** A gap into a **kitchen** or the **hall** (the main
> living room on the entry floor) is an **open doorway** — style `'passage'`, a
> frame at most, no leaf — unless the plan clearly draws a door there. Doors with
> leaves belong to private rooms (bedrooms, bathrooms, a study), balconies and
> the main entrance. The Pandaul kitchen 2 was first built with a hinged wooden
> door onto the hall. `homes.test.ts` enforces this for every home; an upstairs
> family lounge is semi-private and exempt.

## 0. Get a readable image — zoom before you trace

A phone photo of a monitor is too coarse to see a 3' gap at full size. Crop and
upscale each region (rows of rooms) **3×** and read the walls off the crops,
not off the whole photo. If a wall still cannot be read at 3×, that side is a
`?` for step 4 — do not guess it.

## 1. Read the legend before reading rooms

Write down what each line style and colour means on **this** plan before
tracing anything. Typical Indian CAD conventions, but confirm per plan:

| Mark | Usually means |
| --- | --- |
| thick double line | wall |
| **gap in a room outline, door-width** | **door** — whether or not a swing arc is drawn (THE DOOR RULE) |
| gap much wider than a door / side with no wall line | open passage |
| door-width gap into a kitchen or the hall | open doorway, no leaf (THE OPEN-DOORWAY RULE) |
| single thin line beside stair treads | stair edge / rail — **not** a wall; that side is open |
| blue / hatched band in a wall | window |
| pink / magenta outline | counter, platform, mandir ledge — **not** a wall |
| green | plot boundary / setback — outside the house |
| arrow + "UP" | stair direction |

A coloured line you cannot explain is an open question (step 4), not a wall.

## 2. Build the adjacency table — before any coordinates

For **every room, every side** (N/E/S/W), record exactly one of:
`solid` · `door → <room>` · `open → <room>` · `window` · `exterior`.

| Room | N | E | S | W |
| --- | --- | --- | --- | --- |
| Puja | open → Hall | window | solid (mandir) | **solid** (passage) |

Rules:
- Walk each room's outline **wall by wall** on the zoomed crop and write down
  where the wall line stops. Every gap is an opening; every unbroken wall is
  solid. Do not infer from what "usually" happens — a puja, store, bedroom or
  kitchen is often entered from an unexpected side or end.
- Record **which end** of the wall the gap is at (top/bottom, left/right). A
  door at the wrong end of the right wall opens into a different room.
- An alcove with no wall across its front is `open`, not `door`.
- If a side cannot be read, mark it `?` and carry it to step 4.

This table is the source of truth for steps 5 and 6.

## 3. Reconcile the printed numbers

- Every room's printed size gets used, and any deviation is recorded in the
  home's `planNote` (e.g. "Hall 13'6" vs label 13'1"").
- The printed **total area** must reconcile with the outline you trace (within
  ~1 %). This is also how you settle whether a doubtful space is inside the
  house: the Pandaul stair is in the built-up area because
  14'9" × 51'6" + 11'3" × 55'4" = 1382.1 ≈ 1382.84 sq ft printed.

## 4. Ask about the ambiguities — once, up front

List every `?` from steps 1–3 and ask the user **before** authoring, each with
your best reading and the alternative. Typical: is a passage inside or outside,
does a stair belong to this unit or a separate entrance, door or open arch.
Record the answers in the home file's header comment.

## 5. Author the home file

`src/data/homes/<id>.ts`, registered in `src/data/homes/index.ts`. Contract:
`src/data/homes/types.ts` and the header of `src/data/listingFlats.ts`.

- Grid first (list the x and z lines in the header comment), then rooms.
- Every shared-wall opening is authored on **both** rooms; exactly one side is
  `bare: true`.
- Each room gets a comment with its plan size and what each side does — copied
  from the adjacency table, so a reviewer can check one against the other.
- No personal data: CAD file names often carry the owner's name. Name the home
  by locality or project (CLAUDE.md §5).
- Foyer: list the **front door first** and the onward passage before other
  passages — `entranceSpawn` uses that order for the walkthrough start.

### Stairs — place the door at the FOOT, not just on the stair room

The Pandaul stair (2026-10-02) had its doorway opposite the **top** of the
U-stair's return flight, with the stair's front edge 12cm off the door wall —
geometrically valid, physically unusable. Before placing a stair:

1. Mark on the plan where the "UP" arrow starts — that is the first tread.
2. Know the model's frame: front = local +z. `stair-u` climbs on its local
   **−x** flight from the front edge and returns on **+x** (landing at the back);
   a straight `stair-floating` climbs from its front edge. Rotation maps local
   to room as `x' = x·cos r + z·sin r`, `z' = −x·sin r + z·cos r` — so at
   `rot: Q` local −x is world **+z**.
3. Put the doorway on the wall facing the first tread, centred on flight A,
   and leave ≥ 30cm of floor in front of it (or let the flight start right at
   an opening into the neighbouring room, as Canary/Embercrest do).
4. Multi-storey: the last tread must land on a room of the storey above.

`homes.test.ts` enforces all of this for every registered home ("every stair
has floor at its foot…"), but get it right from the plan, not from the test.

## 6. Encode the adjacency table as tests

Pin **every room's door — wall and end** — in a test (see "Pandaul doors sit in
the gaps of each room outline" in `homes.test.ts`, which records each door as
`[wallId, start|middle|end]`). Then add a `describe('<Home> circulation matches the plan')` block to
`src/data/homes/homes.test.ts` asserting the table's **surprising** rows —
anything a later agent might "correct" to the usual layout:

```ts
expect(doorsOn(room('Puja'), 'w0')).toHaveLength(1) // open to the hall
expect(doorsOn(room('Puja'), 'w3')).toEqual([])     // solid to the passage
```

Plus the printed sizes. Registry-wide checks run automatically for every home:
overlap, finishes/archetypes resolve, openings fit, shared-wall twins,
reachability from an exterior door (catches a sealed-off room), and stair
usability (a ground-level door reaches the foot of every stair; the top lands
on the storey above).

## 7. Green bar

`npm run typecheck && npm test && npm run lint && npm run build && npm run check:size`

## 8. Visual check against the plan, room by room

Unit tests cannot see a wrong wall. Open the home and compare it to the plan:

- `npm run dev`, then `http://localhost:5180/?home=<id>` — open it in **Arc**
  (`Arc.exe` from WSL, or paste the URL), not a headless Chrome screenshot.
- Plan view first: the room layout must read like the plan when held side by side.
- **Doors and walls get the most attention** — they are what the plan's owner
  checks first. For EVERY room, put the zoomed plan crop next to the 3D view
  and check each wall: the opening is in the same wall, at the same END, about
  the same width, and every wall that is unbroken on the plan is solid in 3D.
  Write the result per room in the hand-off (step 9), e.g. "Bedroom 4: top
  wall, left end ✓". A room not checked this way is not done.
- Then walk the adjacency table row by row in 3D: can you walk from the front
  door into every room through the doors the plan draws, and only those?
- Stairs: stand in the doorway (Flythrough / walk mode) — the first tread must
  be in front of you, and walking up must work.
- Any row that does not match → fix the table or the file, then add a step-6 test.

## 9. Hand-off

Report: the ambiguities and how they were resolved, every `planNote`
deviation, and which rooms were visually checked. File beads for anything left
open (CLAUDE.md §6).
