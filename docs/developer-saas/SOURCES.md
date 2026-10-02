# Source ledger

Accessed 2026-09-29 UTC. URLs are durable handoff references; browser-internal
reference IDs are intentionally omitted. Vendor claims are not independent
performance evidence. Pricing, model versions, licenses, and regulations must be
rechecked at procurement or launch. Summaries are intentionally brief.

## Market and alternatives

| ID | Primary source | Finding and limit |
| --- | --- | --- |
| M01 | [Shapespark pricing](https://www.shapespark.com/pricing) | Hosted scenes, embedding, branding, and higher-tier viewer API/custom-domain features already exist. Pricing page has monthly/yearly toggles; compare actual checkout terms. |
| M02 | [PropVR](https://propvr.ai/) | Offers real-estate walkthroughs, experience centres, and content production in India and other markets. Customer/outcome statements are vendor marketing. |
| M03 | [Enviz browser capabilities](https://help.enviz.co/en/articles/11772369-viewing-enviz-in-browser) | Browser supports clickable and dollhouse viewing/embedding; article dated July 14, 2025 distinguishes app-only features. Recheck current parity during a trial. |

## Furniture capture and generation

| ID | Primary source | Finding and limit |
| --- | --- | --- |
| F01 | [Meshy API pricing](https://docs.meshy.ai/en/api/pricing) | Per-operation API credits vary by model and texture options; API budget is distinct from a website subscription. No quality comparison established. |
| F02 | [Tripo generation API](https://platform.tripo3d.ai/docs/generation) | Image and multiview generation; documented multiview input ordering matters. Pin model versions rather than relying on defaults. |
| F03 | [Tripo billing](https://platform.tripo3d.ai/docs/billing) | Model-dependent generation and processing credit charges; advanced settings can add charges. |
| F04 | [Apple Object Capture photography guidance](https://developer.apple.com/documentation/realitykit/capturing-photographs-for-realitykit-object-capture/) | Explains capture constraints including reflective, transparent, thin, smooth, and deformable objects. Capture quality must be evaluated per furniture class. |
| F05 | [Hyper3D API capabilities](https://docs.hyper3d.ai/en/get-started/features) | Asynchronous task/status/download workflow, concurrency limits, generation families, and changing credit charges. |
| F06 | [Hyper3D pricing](https://hyper3d.ai/pricing) | Standard API access is associated with Business; contractual rights and per-asset costs need confirmation. |
| F07 | [Meshy image API](https://docs.meshy.ai/en/api/image-to-3d) | Asynchronous image generation, PBR and processing controls; observed model/default changes make version pinning necessary. |
| F08 | [Meshy multiview API](https://docs.meshy.ai/en/api/multi-image-to-3d) | Accepts 1–4 input images; supports generation and texture options with model-specific constraints. |
| F09 | [Meshy API product FAQ](https://www.meshy.ai/api) | Says API inputs/outputs are not used for training and non-enterprise API assets last three days. Training claim conflicts with broader terms below. |
| F10 | [Meshy terms, updated September 19, 2026](https://www.meshy.ai/terms-of-use) | Section 2.9 permits non-enterprise input/output training unless otherwise agreed; use/competitive-analysis restrictions also require review for an embedded SaaS/evaluation. |
| F11 | [Tripo terms](https://www.tripo3d.ai/terms) | Distinguishes free and paid rights; paid-user clause addresses training. Read the applicable API agreement and data terms before uploading customer assets. |
| F12 | [Microsoft TRELLIS.2 repository](https://github.com/microsoft/TRELLIS.2) | Upstream says model/code MIT, dependencies separately licensed, Linux/NVIDIA and at least 24 GB GPU memory. Repository license alone does not clear a deployed pipeline. |

## Web 3D and security

| ID | Primary source | Finding and limit |
| --- | --- | --- |
| T01 | [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) | Meter units, coordinate conventions, PBR and resource rules; a GLB can still contain external references. |
| T02 | [glTF Transform CLI](https://gltf-transform.dev/cli) | Asset-processing/optimization tooling. Pin tooling and evaluate visual quality after compression; no universal preset is assumed. |
| T03 | [Web Vitals](https://web.dev/articles/vitals) | User-facing loading, responsiveness and stability metrics complement 3D-specific readiness/FPS measurements. |
| T04 | [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Bounded, validated, isolated upload processing; file extension/MIME alone is insufficient. |
| T05 | [Postgres row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | Policy behavior and owner/bypass-role caveats; application membership checks remain necessary. |

## India launch requirements

| ID | Primary source | Finding and limit |
| --- | --- | --- |
| L01 | [RERA Act, India Code](https://www.indiacode.nic.in/indiacode/bitstream/123456789/2158/1/A201616.pdf) | Authoritative starting point for carpet area, project advertising, and accuracy obligations. State/project applicability needs review. |
| L02 | [MeitY DPDP Rules and timeline index](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B) | Links final rules, commencement timeline, and December 2025 corrigendum; do not cite draft rules as current final law. |
| L03 | [DPDP Rules Gazette](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) | November 13, 2025 notification uses staged commencement, including one-year and eighteen-month groups. Not every provision was immediately effective. |
| L04 | [MahaRERA enforcement order 80/2025](https://maharera.maharashtra.gov.in/sites/default/files/final_order_document/PUNE_ORD_80OF2025_0.pdf) | Describes QR/registration/website visibility directions and cites April 8, 2025 order. Maharashtra is conditional; Embercrest jurisdiction is not established by its name. |

## Local evidence

- `CLAUDE.md`, `docs/agent-orientation.md`, `docs/LAUNCH_PLAN.md`.
- `docs/embercrest-plan-review.md`, `src/data/homes/embercrest.ts`, and
  `src/data/homes/types.ts` (working-tree code, including pre-existing edits).
- `src/types.ts`, `src/persistence.ts`, `src/repository.ts`,
  `src/three/houseSession.ts`, `src/three/Furniture3D.tsx`, `src/three/mount.ts`.
- `detection-pipeline/README.md`, `server/app.js`, `server/.env.example`,
  `server/migrations/001_initial_schema.sql`.

Original `Duplex.pptx` has not been recovered or independently checked in this
research pass. Local code/review references to it are secondary evidence.
