# Embercrest source evidence and review gate

Updated 2026-09-29 UTC. This is a private prototype evidence ledger, not developer or architect approval. The typed ledger is [`src/data/homes/embercrestEvidence.ts`](../../src/data/homes/embercrestEvidence.ts); it does not change the current rendered home. `publicationEvidenceIssues()` must return no blockers before a release pipeline may treat these claims as approved. That function is a first gate, not a substitute for legal, architectural or developer review.

The existing [`Embercrest reference review`](../embercrest-plan-review.md) says a user-supplied `Duplex.pptx` slide 1 showed A&B Building floor plans, pages 4–5, flat 504. It records a 2026-09-28 transcription of 17 metric room footprints. The original presentation and furnished walkthrough are not in this workspace, so the source revision, document authenticity, customer ownership and publication rights cannot be checked here. The code labels the footprints **reported printed**, not verified or approved. Three modeled corridor/stair footprints are **inferred**. Positions, 12 cm walls, 300 cm storeys, openings and most detailed geometry are inferred; furniture and finishes are illustrative. The supplied video is described as a style reference only, not this flat's measured layout or an inclusion schedule.

The area statement reported in the review is 83.27 + 65.30 = **148.57 m² carpet** and 18.71 + 6.14 = **24.85 m² balconies**, totaling **173.42 m² including balconies**. The reported marketing phrase “1867 sq ft carpet” conflicts with that statement because 173.42 m² converts to approximately 1867 sq ft. The prototype's balcony-inclusive label avoids repeating the carpet claim. Neither figure is certified; room footprints use wall centre lines, and modeled polygon area is not a certified carpet-area calculation.

| Release review item | Evidence needed from the accountable owner | Current state |
| --- | --- | --- |
| Original source and version | Original CAD/PDF/PPTX, file hash, issue date/revision, drawing title, page references, unit identification | Only the secondary review is in this workspace; original/version unverified |
| Unit identity | Confirm whether flat 504 is a specific sale unit or a representative unit type; record differences from as-built and sales inventory | Unconfirmed |
| Area and sales labels | Signed area statement and permitted carpet/balcony/saleable terminology; resolve the 1867 sq ft conflict | Unresolved conflict; current figures are reported only |
| Geometry | Architect-reviewed clear dimensions, wall thickness, elevations, stair/void layout, openings, balcony curves/recesses and 50 mm sunken areas | Footprints transcribed; placement and details inferred/simplified |
| Interior scope | Approved inclusion/optional/illustrative schedule and measured product specifications | Illustrative staging only |
| Brand and source rights | Written rights for plans, brand, photos/video, derivative 3D models and public use; permitted attribution | Unverified |
| Jurisdiction and claims | Project registration/jurisdiction and approved sales copy supplied by the developer's authorized reviewer | Unknown; no registration/developer claims should be invented |
| Approval record | Named architect/developer reviewer, date, exact source revision, disposition per claim and retained sign-off artifact | No claim approved |

To review a revised model, keep the original source private, record its immutable version/hash and exact page, compare every displayed claim against that revision, and attach the accountable reviewer and sign-off artifact. Update the ledger's source custody, rights and individual claim reviews only after the evidence exists. A changed model, plan or marketing label needs a new review bound to the new version. Keep private source files and personal data out of any public release manifest.
