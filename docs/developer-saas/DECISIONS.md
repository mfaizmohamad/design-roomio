# Research decisions and reasoning

Updated 2026-09-29. These are product/engineering recommendations unless explicitly
marked as user-confirmed. Beads remains the implementation status tracker.

## D01 — First customer and outcome (user-confirmed)

Indian residential developers, starting with Embercrest. Prove a branded
interactive duplex helps sell homes. Buyer browsing should work through a link
on a phone; authoring is a separate staff workflow. Avoid requiring a buyer to
learn the existing room-design wizard before seeing the home.

## D02 — Trusted sales content is the core product

The Embercrest code and existing reference review distinguish printed dimensions
from inferred geometry. Preserve that distinction in an approved source schedule,
versioned home releases, area labels, and clearly identified illustrative furniture.
A prettier render alone cannot resolve the current source/measurement uncertainty.

## D03 — Photo detection and product reconstruction are separate capabilities

`detection-pipeline/README.md` describes a closed-set furniture classifier that
emits existing archetypes and colors. `Furniture3D.tsx` renders parametric primitives.
There is no audited end-to-end imported-product asset workflow in those paths.
Retain detection as an assistant; build asset ingestion and review as a distinct
workflow with persistent asset versions, measured dimensions, and provenance.

## D04 — Asset acquisition order

Prefer a rights-cleared manufacturer/SKU model; otherwise commission a model from
photos and dimensions or capture the physical item; evaluate image-to-3D as an
accelerator. Single images cannot establish hidden surfaces or absolute scale.
Generated reverse views are additional guesses, not independent measurements.
An AI output can be approved as an illustrative substitute without claiming an
exact product match. Provider selection requires a representative benchmark.

## D05 — Preserve the working application

Extend React/R3F, the existing placement rules, and Express/Postgres incrementally.
Do not introduce a new build island or rewrite the renderer. Add a complete home
document above the room editor, immutable publication snapshots, and a separate
asset reference alongside the procedural furniture fallback. Centimeters in
domain data and meters at the renderer boundary require explicit tests.

## D06 — Research limitations recorded now

No customer interviews, paid model generations, mobile device benchmarks, vendor
contracts, or legal reviews have been performed. Public vendor pages establish
documented capabilities, not comparative quality or return on investment. Avoid
claiming a best AI provider, guaranteed conversion uplift, or certified geometry.

## D07 — Existing environment limitations

`bd`, `dolt`, `psql`, and `pg_isready` were not found on PATH; common user/tool
directories also did not reveal an existing beads executable. `.beads` is
configured for a Dolt server. Do not reinitialize or replace that database to
make a planning task appear complete. Preserve implementation specifications
and import instructions if the tracker remains unavailable, and state the gap.

## D08 — First milestone is a complete local sales slice

Save/reopen the whole duplex, place one measured and reviewed GLB, and present
both floors through a buyer-facing shell. Reuse the existing persistence envelope
before adding a format. Complete organization security and approved publication
before public customer use. The detailed dependency order is in the implementation
specification, not a separate task-status list here.

## D09 — Keep AI off the pilot's critical path

Compare at most two initial providers using a 16-task screen, expanding to 48 total
only if useful. Review terms and approve a spend cap before evaluation. Measure
cost and operator time per accepted asset. Use manual/imported assets if generation
does not pass. Do not let repeated provider shopping delay the sales workflow.

## D10 — Prove recurring value and affordable operations

Separate setup/content-production charges from recurring hosting, updates and
sales workflow. Pricing and margin assumptions are illustrative; customer renewal
and repeatable second-project delivery are the commercial evidence still needed.
Do not describe engagement as home-sales uplift without comparable sales data.

## Research stopping rule

Further generic browsing is unlikely to change this plan. The next valuable
evidence is the original approved source package, a licensed furniture test asset,
the first complete-home round trip, actual phone measurements and developer/buyer
feedback. Recheck terms/prices/regulations when spending or launching, or investigate
an explicitly recorded unknown; do not restart broad market research by default.
