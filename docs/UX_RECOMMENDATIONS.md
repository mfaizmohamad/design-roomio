# Roomio — UI/UX recommendations (research-grounded)

Compiled by Agent E from web research on UI/UX best practices for 3D room/home‑design
web apps (2026). Each point is tied to a source and mapped to Roomio's actual UI. Ordered
roughly by impact / effort.

## ✅ Implemented
- **Progressive disclosure (1).** Collapsible **Suggestions** panel, **catalog categories**
  (Sofas/Beds/…), and the **lighting** panel — all default OPEN, click the header to collapse.
  *(NN/g progressive disclosure & desktop accordions.)*
- **Empty‑state onboarding (2, 8).** A brand‑new room shows a friendly "🛋️ Your room is empty —
  let's furnish it!" card with a Scan CTA, alongside the necessity Suggestions. *(UserOnboard / Smashing.)*
- **Consolidated viewport toolbar (3).** Plan view · Whole‑house · Colliders are now one coherent
  top‑centre pill group (was scattered chips). *(minimum‑code / uxplaybook — consistency = trust.)*
- **2D plan view (4).** A "⬓ Plan view" button snaps the camera to a top‑down floor‑plan view —
  the lightweight 2D side of the 2D↔3D pattern. *(Planner 5D / Witmodel.)*
- **Accessibility (5).** Toggle buttons carry `aria-label` / `aria-expanded` / `aria-pressed` + titles.
  *(uxplaybook 2026 — WCAG 2.2.)* (A fuller contrast/keyboard audit remains.)
- **Already satisfied (6, 7, 9).** Fast 3D — sun is the only shadow caster, lights capped (lighting
  pass). Data‑seeding — persona presets pre‑furnish rooms. Direct‑manipulation clarity — rotate knob,
  lock badge, move‑hint already present and consistent across edit modes.

## High impact
1. **Progressive disclosure everywhere dense.** Apply the same collapse pattern to other heavy
   panels: the per‑item editor (Rotation/Size/Colour as collapsible sections), catalog categories
   (collapse "Sofas/Beds/…"), and the lighting panel sections. Show the most relevant thing first,
   hide the rest behind a tap. *(NN/g; IxDF; UXPin — progressive disclosure lowers cognitive load.)*
2. **Empty state = onboarding.** A brand‑new room is the first thing users see — make it a guided
   empty state, not a blank box: a friendly one‑liner + the 2–3 highest‑value next steps
   ("Pick a style", "Scan a room photo", "Add a bed"). Roomio already seeds value via persona
   presets + the suggestion engine; surface a clear **single first CTA** for true first‑timers.
   *(UserOnboard empty‑state patterns; Smashing "empty states in onboarding"; Appcues — clear CTA.)*
3. **Consolidate the floating controls.** The viewport now has several independent floating chips
   (Light Mode, View whole house, Colliders, Flythrough, view toolbar). Group them into one
   coherent control system (a single toolbar / consistent placement + iconography) so it reads as
   "professional and trustworthy," not ad‑hoc. *(minimum‑code 2026; uxplaybook — consistency = trust.)*
4. **2D ↔ 3D toggle.** The whole‑house overview is a step toward a plan view; a true top‑down **2D
   floor‑plan mode** (with instant switch to 3D) is the single most requested pattern in leading
   planners (Planner 5D). Great for arranging rooms/furniture precisely. *(Witmodel; Live Home 3D.)*

## Medium
5. **Accessibility pass (WCAG 2.2).** Ensure all the new icon/emoji toggles have text labels or
   `aria-label`, visible focus rings, adequate contrast, and keyboard operability. (The new collapse
   buttons set `aria-expanded`; extend this across the floating chips + flythrough HUD.)
   *(uxplaybook 2026 — accessibility is no longer optional.)*
6. **3D for value, not novelty — keep it fast.** Users expect lightning‑fast loads and intuitive
   first‑click interaction. Cap shadow casters (already done in lighting), lazy‑load heavy assets,
   and keep the default view immediately interactive. *(minimum‑code 2026.)*
7. **Data‑seeding / sample content.** Presets already pre‑populate furnished rooms — lean into it:
   offer a "start from a furnished example" path so users see a working result before doing work.
   *(UserOnboard — data seeding shows the product working before effort.)*

## Lower / polish
8. **Personality in copy + empty states.** Friendly, purposeful microcopy on empty/added‑room states
   eases the "blank start" hesitation. *(Smashing; Dropbox example.)*
9. **Direct‑manipulation clarity in 3D.** Keep gizmos/affordances obvious (the rotate knob, lock
   badge, move‑hint) and consistent across edit modes; never leave the user guessing what's draggable.

## Sources
- NN/g — [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) ·
  [Accordions on Desktop](https://www.nngroup.com/articles/accordions-on-desktop/)
- IxDF — [Progressive Disclosure](https://ixdf.org/literature/topics/progressive-disclosure)
- UXPin — [Progressive Disclosure (2026)](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- uxplaybook — [11 UI Best Practices (2026)](https://uxplaybook.org/articles/ui-fundamentals-best-practices-for-ux-designers)
- minimum‑code — [8 UI/UX Best Practices for Web Apps (2026)](https://www.minimum-code.com/blog/ui-ux-best-practises-web-app-design-2026)
- UserOnboard — [Empty States patterns](https://www.useronboard.com/onboarding-ux-patterns/empty-states/)
- Smashing — [Empty States in Onboarding](https://www.smashingmagazine.com/2017/02/user-onboarding-empty-states-mobile-apps/)
- Appcues — [Onboarding UX patterns](https://www.appcues.com/blog/user-onboarding-ui-ux-patterns)
- Witmodel — [Best 3D Room Planners 2026](https://witmodel.com/blog/best-3d-room-planners-in-2026-an-honest-comparison)
- Live Home 3D — [Top Interior Design Apps](https://www.livehome3d.com/useful-articles/top-best-interior-design-apps)
