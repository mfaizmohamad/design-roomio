# Product recommendation and paid-pilot design

Research date: 2026-09-29. User-confirmed market: India, starting with Embercrest.
User-confirmed outcome: sell homes through an interactive duplex. Commercial
figures and success thresholds below are hypotheses to test, not market evidence.

## The product to sell

**A developer's branded, shareable model home that helps buyers understand the
layout, try approved furniture, and request a site visit with their preferences.**

The developer supplies approved plans and sales content. Roomio turns those into
a versioned experience the sales team can send through its existing channels.
The recurring service keeps it available, current and measurable across campaigns
and reusable unit types. Furniture improves spatial understanding; it is not the
initial marketplace, procurement system, or primary revenue stream.

Start with a developer running a small number of residential projects and repeated
unit layouts, an accountable sales lead, and access to the architect's plans.
Repeated layouts make content reusable. One unique luxury house with constant
bespoke changes may be a valuable service project, but does not prove SaaS economics.

| Person | Job Roomio should make easier | Evidence to collect |
| --- | --- | --- |
| Marketing head / project owner | Publish credible branded sales material and justify spending | Current content costs, approval delays, campaign baseline, willingness to pay |
| Site sales team | Explain a duplex and remember what a buyer wanted | Observed sales walkthrough, recurring questions, CRM handoff |
| Architect / content reviewer | Approve layout, dimensions and promised inclusions | Source revisions and recorded approval of a publication |
| Content operator / visualization agency | Prepare, revise and reuse models efficiently | Minutes per approved asset/unit type and revision |
| Home buyer | Understand both floors, furniture scale and the next step | Unassisted task completion on a real phone |

## What competing products establish

This is an existing category; interactive 3D alone is not a defensible claim.

| Alternative | Verified capability | Implication for Roomio |
| --- | --- | --- |
| Shapespark | Browser scene hosting, embedding, branding, and higher-tier integration features | A developer can already buy a presentation tool. Roomio must add useful project/furniture/lead workflow or cheaper operation. [Pricing/features](https://www.shapespark.com/pricing) |
| PropVR | Real-estate walkthroughs, content services and experience centres, including India | Competing for elaborate sales galleries at launch would spread effort too widely. Test a focused phone/browser experience. [Product site](https://propvr.ai/) |
| Enviz | Browser clickable/dollhouse views and embedding; its help article distinguishes app-only experiences | Validate the entire buyer journey in the browser. Do not infer competitor capabilities beyond the cited documentation. [Browser guide](https://help.enviz.co/en/articles/11772369-viewing-enviz-in-browser) |
| Existing brochure, renders, video and salesperson | Customer-specific substitute, to inspect during discovery | The pilot must improve a real sales task; a beautiful new demo is not sufficient evidence. |

Positioning hypothesis: **approved project information, measured furniture,
repeatable unit types and a useful sales follow-up in one lightweight experience.**
This combination is a proposition to validate, not a claim that competitors lack
it. Reusable approved content and reliable operations are more plausible advantages
than access to an image-generation API. If a configured existing viewer meets the
pilot need at lower total cost, test that before extending every Roomio feature.

## Embercrest buyer experience

1. Open a branded project link. See project/unit-type name, an approved hero
   image, source-backed area labels, a visible site-visit action and a short
   explanation of illustrative staging. Viewing requires no account.
2. Choose **Explore duplex**. Begin in the living area at a useful camera angle;
   offer a short optional guided tour. Provide **Lower floor**, **Upper floor**,
   **Whole home**, **Floor plan** and **Reset view**. Stairs and the living void
   must be intelligible without game controls.
3. Choose **Furnished / Unfurnished**. Explain whether items are included,
   optional upgrades, or illustrative. Keep the approved building geometry fixed.
4. Open a room's furniture panel. Swap among a small approved set; show dimensions
   and fit feedback. Allow movement only in intended editable zones. Start with
   living-room seating, dining and the primary bedroom, not hundreds of products.
5. Save/share the buyer's preferences as a new configuration referencing the
   exact release. The shared result must restore both floors and asset versions.
6. Choose **Request a site visit** or contact the sales team. The lead includes
   the chosen unit type, release and configuration, with contact consent. A
   request is not a confirmed booking; marketing consent is a separate choice.

On a phone, use a persistent bottom action, a collapsible room/floor sheet, large
touch targets, legible text and a small control set. Provide a 2D plan, approved
still images and the contact action when WebGL fails or the user chooses lighter
content. Render diagnostics and room-construction controls belong in staff tools.
Do not invent a logo, registration number, furnishing inclusion, price, surrounding
view, delivery date or availability for Embercrest.

## Pilot scope

One developer, one project, the Embercrest duplex as one unit type, two floors,
one approved default scheme and roughly 8–12 approved furniture assets. Unit
504 is a local source reference; verify whether the public experience represents
that actual unit or a typical layout. Store actual unit availability separately.

Deliver a branded public link, an internal authoring/review flow, complete-home
save/reopen, reviewed furniture placement, anonymous browsing, consented enquiries,
lead export/delivery, simple campaign measurement and a working fallback.
Staff-assisted furniture-photo intake can demonstrate the photo workflow before
exposing paid generation to buyers. Later, a **Try my furniture** feature can let
buyers upload photos and measurements privately; it needs its own quotas, retention
and review experience.

Defer online home booking/payment, furniture checkout, unlimited AI generation,
full CAD/BIM authoring, an AI agent that promises dimensions, multiplayer editing,
VR headsets and broad marketplace integrations. Confirm one CRM workflow before
building multiple connectors; an authenticated CSV export and idempotent webhook
are adequate initial integration surfaces.

## Discovery and measurement

Before production implementation, review the pilot with the budget owner, two
salespeople, the architect and 5–8 representative buyers. Obtain source files and
permissions through the project owner. These activities are proposed; no outreach
or interviews were performed in this research assignment.

Ask how they explain a duplex today, which questions delay a site visit, how
project information changes, who approves it, which phones buyers use, and how
they measure qualified visits. Record the actual alternative and buying process.
Do not ask only whether they like the demo.

Use these proposed decision gates:

| Gate | Initial criterion | Interpretation |
| --- | --- | --- |
| Trust | Approved source schedule; no known incorrect area/inclusion claims; published release traceable to approval | Required before buyer exposure |
| Usability | At least 4 of 5 observed buyers can find both floors, inspect a room and request a visit unaided | Small-sample diagnostic, not statistical market proof |
| Reliability | At least 95% of measured pilot sessions reach usable 3D or a usable fallback; all test leads reach the owned queue | Exclude staff/bots and report numerator/denominator |
| Content operation | A second approved layout and a routine revision can be produced within recorded, commercially affordable labor | Proves repeatability rather than bespoke hero-demo work |
| Commercial | Budget owner accepts the paid scope and renews or orders another layout/project | Stronger evidence than engagement alone |

Track `experience_opened`, `scene_ready`, `fallback_used`, `floor_selected`,
`room_viewed`, `furniture_changed`, `configuration_saved`, `lead_submitted`,
`lead_accepted`, and salesperson-recorded `visit_completed`. Avoid raw contact
details in analytics. Define a qualified lead with the developer before comparing
funnels; clicks and requested visits are not completed visits or home sales.

Where traffic permits, compare the experience against the existing brochure page
within the same campaign and period. Keep source/channel and unit type comparable.
Report sample size and uncertainty; for small pilots use observed buyer comprehension
and sales-team feedback instead of declaring a conversion uplift. Revenue attribution
needs CRM follow-through and a longer window than a UI trial.

## Commercial hypothesis and cost discipline

Test one simple offer: **₹60,000 setup + ₹15,000/month** for one bounded project,
agreed unit types, limited revisions and hosting/lead workflow. This is a research
anchor for interviews, not a validated price or quote. Define taxes, implementation
fees, usage, cancellation, content ownership and support in the actual contract.
Charge separately for extra unique layouts, large catalog digitization and major
source revisions. Repeated units should reuse a layout rather than trigger repeated
model-production charges.

An illustrative recurring model, excluding setup revenue:

| Monthly item | Assumed cost |
| --- | ---: |
| Allocated infrastructure and delivery | ₹2,000 |
| Support: 2 hours × ₹800 | ₹1,600 |
| Routine content care: 1 hour × ₹800 | ₹800 |
| Billing/other variable costs | ₹400 |
| Total / contribution at ₹15,000 revenue | ₹4,800 / ₹10,200 (68%) |

If support grows to 10 hours and content care to 5 hours at the same rates, total
cost becomes ₹14,400 and contribution falls to ₹600 (4%). These assumptions show
why setup labor, revisions and per-accepted-asset cost must be measured. Allocate
shared infrastructure across actual paying customers; do not ignore idle minimums.
Track payment collection, acquisition cost and founder labor separately. A proposed
steady-state contribution target above 70% requires better reuse, scope or pricing.

Treat onboarding as a product workflow: intake → source review → content production
→ approval → publication → campaign → revision. Record hours at each step. If the
second and third projects still require custom code or unlimited artist work, sell
a clearly priced service while improving repeatability rather than claiming SaaS
economics. No market-size or ROI number is asserted without customer evidence.
