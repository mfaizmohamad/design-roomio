<div align="center">

# 🏠 Roomio

### Design a room in your browser — author it, furnish it, light it, render it *photoreal*, then *walk through it*.

Sketch a room in a clean wizard, furnish it from a **109-piece parametric catalog** that
**won't clip through walls**, lay out a whole house, tune the **lighting & time of day**, flip on
**photorealistic rendering** (PBR + image-based lighting + filmic tone mapping), then **walk it in
first person** or **direct a cinematic camera flythrough and export an MP4**. Browse **real scraped
rental listings** and step into flats **rebuilt in 3D from their photos** — all client-side,
all real-time Three.js.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Three.js](https://img.shields.io/badge/React_Three_Fiber-Three.js-000000?logo=three.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Rendering](https://img.shields.io/badge/Render-PBR%20%2B%20IBL%20%2B%20ACES-8A2BE2)
![WebCodecs](https://img.shields.io/badge/Video-WebCodecs-FF5A5F)
![Postgres](https://img.shields.io/badge/Sessions-Postgres-4169E1?logo=postgresql&logoColor=white)

<br/>

![Roomio — furnish a styled room in 3D](docs/screenshots/uc-hero.png)

</div>

---

## ✨ What you can do

### 🛋️ Furnish from a 103-piece catalog — with real collision

Drag in furniture from a parametric catalog spanning sofas, beds, tables, chairs, storage,
décor, kitchen & bath fixtures. Every piece is **resizable, recolorable, and lockable** — and a
bespoke 2D-footprint solver means furniture **clamps and *slides* along walls, snaps flush, and
never clips through them**. No physics engine.

![A furnished living room in 3D](docs/screenshots/uc-hero-3d.png)

### 🎭 Start from a persona room — 10 research-grounded styles

Don't start from a blank box. Load a pre-furnished **persona** — Bachelor, Family, Gamer,
Neo-Deco / Glam, Biophilic, Celestial-Calm, Afrohemian, and more — then make it yours.

| Biophilic | Gamer Setup |
| :---: | :---: |
| <img src="docs/screenshots/uc-persona-biophilic.png" width="430" alt="Biophilic persona room"/> | <img src="docs/screenshots/uc-persona-gamer.png" width="430" alt="Gamer persona room"/> |

### 🍳 Every room type has its own vibe

Pick a room's function and it furnishes itself accordingly — **kitchens** get a counter run with a
**polished black-granite top**, sink, range & refrigerator; **bathrooms** get a toilet, vanity &
walk-in shower.

| Kitchen | Bathroom |
| :---: | :---: |
| <img src="docs/screenshots/uc-kitchen.png" width="430" alt="Kitchen with counter, black-granite top, range and fridge"/> | <img src="docs/screenshots/uc-bathroom.png" width="430" alt="Bathroom with toilet, vanity and walk-in shower"/> |

### 🏘️ Lay out a whole house

Add rooms one at a time — or drop in a standard **1, 2 or 3BHK flat** — and Roomio stitches them
into a connected floor plan, **cutting doorways through shared walls automatically**.

![Whole-house overview of a 3BHK floor plan](docs/screenshots/uc-house.png)

### 🏙️ Browse real listings — and walk their flats in 3D

Roomio scrapes **real no-broker rental listings** (photos, rent, locality, phone) into a browsable,
filterable feed. The best part: listings get **hand-authored 3D replicas rebuilt from their actual
photos** — matching floor plans, finishes (glossy vitrified marble, black-granite kitchen platforms,
grille windows, balcony decks), and furniture. A **"3D renders"** tab shows photo-matched renders of
each replica; **click one to walk the flat** before you ever call the broker. A generic data-driven
pipeline (`npm run replicas`) shoots every replica from its listing-photo camera angles and writes a
per-listing QA sheet — adding a new flat is one data entry.

![Real listing photos side-by-side with their Roomio 3D replicas](docs/screenshots/uc-listing-replica.png)

### 💡 Light it, and set the time of day

**Light Mode** turns the room into a presentation: drag the **time-of-day** slider, spin the
**sun & compass**, dial in per-room **warmth**, and add accent lights. (Furniture locks while you
focus on the light.)

![Lighting and time-of-day controls](docs/screenshots/uc-lighting.png)

### 🎥 Render it photorealistically — one toggle

Flip on the realism layer and the flat preview becomes photographic: **physically-based materials**,
**image-based lighting** (procedural HDR environment — reflections + soft ambient bounce), **ACES
filmic tone mapping**, **ambient occlusion**, and **emissive bulbs that glow with selective bloom** —
layered on top of the lighting rig, no scene rebuild. A **quality** switch (high / medium / low)
scales the GPU cost, an **exposure** and **reflections** dial fine-tune the look, and a one-click
**"beauty shot"** renders a **real path-traced still** (true global illumination + ray-traced
reflections) you can download as a PNG.

![Photorealistic rendering of a furnished room — PBR, IBL, soft shadows, glowing lamps](docs/screenshots/uc-rendering.png)

### 🚶 Walk it in first person

Drop into the room at eye height and explore — **WASD + mouse-look**, colliding with walls and
furniture just like the real thing.

![First-person walk through a furnished room](docs/screenshots/uc-flythrough-walk.png)

### 🎬 Direct a camera flythrough → export an MP4

A top-down **director** view: click to drop waypoints, and a smooth **Catmull-Rom spline**
threads them. Preview the glide in first-person POV, then export a **deterministic, frame-by-frame
MP4** (hardware-accelerated WebCodecs — no dropped frames).

![Camera flythrough director with a drawn path](docs/screenshots/uc-flythrough-director.png)

### 📷 Scan a photo → furniture suggestions

Upload a room photo (or try a sample) and a local **vision-model** pipeline proposes furniture
from the catalog — suggestion-only, nothing is auto-placed.

![Scan a room photo for furniture suggestions](docs/screenshots/uc-scan.png)

---

## 🧭 Authoring flow — a 4-step wizard

Structure first, with a live 3D preview the whole way:

| 1 · Shape | 2 · Dimensions | 3 · Doors & windows | 4 · Style |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/02-step1-shape.png" width="210" alt="Pick a room shape"/> | <img src="docs/screenshots/03-step2-dims.png" width="210" alt="Set wall dimensions"/> | <img src="docs/screenshots/04-step3-openings.png" width="210" alt="Place doors and windows"/> | <img src="docs/screenshots/05-step4-style.png" width="210" alt="Choose wall colour and floor"/> |

Pick a shape (Rect / L / T / U / Cut / Beveled) → drag or type wall lengths (ft ⇄ cm) → place
doors & windows that cut **real openings** and resize → choose a wall colour and floor texture.

---

## 🚀 Features

- **4-step authoring wizard** with a persistent live 3D preview, **6 room shapes** (incl. concave
  L/T/U), draggable/typed wall dimensions (ft ⇄ cm), and **doors & windows** that cut real openings.
- **109 parametric furniture archetypes** across sofas, beds, tables, chairs, storage, décor,
  **kitchen / bathroom fixtures**, and household staples — ceiling fans, split ACs, curtains,
  geysers, washing machines — all in-house primitives (zero external 3D assets). Move, rotate,
  **clamped resize**, recolor, **lock in place**.
- **Bespoke collision & snapping**: a 2D footprint constraint — furniture slides along walls
  instead of stopping dead, snaps flush, and flags soft overlaps.
- **10 persona presets** + a live **suggestion engine** (no light? nowhere to sit? no focal point?).
- **Multi-room "whole house"**: add rooms, drag them on a plan, or load a standard **1/2/3BHK
  flat**; shared walls become doorways automatically.
- **Real-listing replicas**: a scraped **no-broker listings feed** with hand-authored **3D flats
  rebuilt from listing photos** — photo-matched finishes (reflective vitrified floors, wall
  cladding, plank ceilings, black-granite platforms, grille/slider openings), a "3D renders"
  browse tab, `?listing=<id>` deep links, and a one-command render pipeline with per-listing
  QA sheets.
- **Lighting & time-of-day** (Light Mode): sun direction, hour-of-day, per-room warmth, accent
  lights, soft shadows.
- **Photorealistic rendering** (one toggle): runtime PBR + procedural HDR **image-based lighting** +
  **ACES filmic tone mapping** + ambient occlusion + emissive bloom, with a high/medium/low quality
  switch — plus a one-click **path-traced "beauty shot"** (real GI + ray-traced reflections → PNG).
- **First-person walk** (PointerLockControls + WASD) with wall/furniture collision at eye height.
- **Camera flythrough**: top-down director → Catmull-Rom waypoint path → smooth playback → a
  **frame-by-frame MP4 export** via WebCodecs.
- **Scan-a-photo capture-suggestor**: a local VLM proposes furniture from a room photo.
- **Material editor** (12 wall colours + 27 procedural floor/wall textures incl. glossy veined
  marble, speckled tile, teak decking), **undo / redo** (⌘Z / ⌘⇧Z),
  and **accounts** — httpOnly **Postgres sessions** with per-user saved designs (guest fallback to
  `localStorage`). Save & reopen the full scene graph, including the exact camera viewpoint.

## 🏗️ Architecture

A serializable **scene graph** is the contract between every layer:

| Layer | Role |
| --- | --- |
| Room builder (wizard) | Deterministic structure: shape, dimensions, openings, materials. |
| Furnish & edit | Place / move / rotate / resize / recolor with collision + snapping. |
| Multi-room & lighting | A house of rooms, connectors cut between them, plus the lighting rig. |
| Rendering (realism) | A drop-in layer over the lighting: PBR + IBL + ACES tone mapping + AO + bloom, and an optional path-traced still. |
| Flythrough (camera) | First-person walk + director waypoint path + deterministic MP4 capture. |
| Capture suggestor (optional) | A scan/photo that *pre-fills* suggestions — pure convenience. |

Everything the user edits is a cheap data op on addressable nodes
(`walls / floor / openings / furniture`), so a design serializes straight to JSON for save/load,
sharing, and replaying a camera path.

## 🛠️ Getting started

```bash
# Front-end — Vite dev server on http://localhost:5180
npm install
npm run dev

# Optional: auth / saved-designs backend (Express + Postgres on :5181, needs a local `roomio` db)
cd server && npm install && npm run migrate && npm start
```

The front-end proxies `/api` → `:5181`. With the backend down, the app still runs fully as a guest.
The camera flythrough's MP4 export uses **WebCodecs**, which requires a secure context — `localhost`
qualifies.

## 🧪 Testing

```bash
npm test               # 640 vitest tests — one workspace run across every module (collision, geometry,
                       # lighting, multi-room, personas, persistence, rendering, texturing, flythrough, replicas)
npm run test:server    # 43 API tests (vitest + supertest vs a throwaway Postgres db): auth cookie flags,
                       # cross-user 403s, login rate limits, the designs upsert race
npm run test:py        # 29 detection-pipeline unit tests (offline, synthetic images)
npm run verify:smoke   # puppeteer: boots an ephemeral server, renders 5 core routes, asserts non-blank frames
npm run check:auth     # puppeteer: signup → save → logout → login → reopen from Postgres
```

CI gates all of the above on every PR. The client ships hardened: error boundaries with branded
fallbacks (a render error can't white-screen the app), WebGL context-loss recovery, session-expiry
re-auth, designed error/empty states, and a code-split first load — the login screen and listings
browser download **~90 KB gzip** of JS (the 3D engine streams in only when a room mounts, the video
encoder only when an export starts). Listing photos are mirrored locally at scrape time, so cards
never depend on expiring CDN links. On phones, the 3D studio gates gracefully to a
"best on a larger screen" card while listings stay fully browsable.

## 🧩 Tech stack

React 18 · React Three Fiber / Three.js · **@react-three/postprocessing** (N8AO · bloom · ACES) ·
**three-gpu-pathtracer** · TypeScript · Zustand · Vite · canvas-record (WebCodecs) · Express ·
node-postgres · vitest · puppeteer-core.
