# Real furniture in the Embercrest duplex

Decision: support imported, reviewed product assets first. Use photo generation to
accelerate content production after a bounded evaluation; do not make an exact-copy
promise from a single image. No provider was called, purchased or benchmarked here.

## Choose the acquisition route by evidence available

| Available input | Recommended route | What the result can establish |
| --- | --- | --- |
| Manufacturer model + SKU/specification + rights | Convert/clean to a reviewed GLB | Strongest starting point for an identifiable product; still verify scale and current variant |
| Several real product photos + measured width/depth/height | Assisted modeling or multiview generation, followed by artist review | Plausible product representation; hidden details remain uncertain until checked |
| Physical furniture with access around it | Photogrammetry plus dimensions and mesh/material cleanup | Reconstructs observed surfaces; effort depends on capture and material |
| One product photo + dimensions | Single-image generation as a draft, or choose a matching existing model | Approximate shape/appearance, never proof of unseen geometry |
| One room photo with several objects | Detect/select an object, crop/mask it, then use the above routes | Detection locates candidates; the photo does not provide a measured room or complete objects |
| No dimensions and no reliable product match | Illustrative catalog substitute, explicitly labeled | Useful staging; no measured-fit claim |

The existing Python pipeline already proposes catalog archetypes. Its category
confidence is not reconstruction quality or measurement confidence. An uploaded
image can instead be retained as a private visual reference without generating a
mesh at all. Matching an existing approved catalog entry is often the cheapest path.

For physical capture, use consistent diffuse lighting, many overlapping real views
at several heights, a stable object and measured dimensions. Do not move cushions
between shots or mistake a generated rear view for capture evidence. Reflective,
transparent, thin, smooth and deformable objects can be difficult to reconstruct;
route glass tables, mirrors and delicate fixtures to modeling/material work when
capture is unsuitable. [Apple capture guidance](https://developer.apple.com/documentation/realitykit/capturing-photographs-for-realitykit-object-capture/)

## Provider shortlist and current evidence

| Option | Why evaluate it | Limit / decision |
| --- | --- | --- |
| Meshy API | Documented image and multiview tasks, PBR and mesh controls; multiview accepts 1–4 images | Pin the model and settings. Current image docs expose newer defaults than older pricing/model references; obtain actual account costs. [Image API](https://docs.meshy.ai/en/api/image-to-3d), [multiview API](https://docs.meshy.ai/en/api/multi-image-to-3d) |
| Tripo API | Image and multiview model generation with documented version selection | Multiview contract uses four ordered slots front/left/back/right, front required, at least two actual images. The adapter must enforce provider-specific input rules. [Generation API](https://platform.tripo3d.ai/docs/generation) |
| Hyper3D/Rodin | Another image-generation candidate with asynchronous task/status/download flow | Reserve as a third challenger if the first two fail the difficult classes; do not build three integrations immediately. [API features](https://docs.hyper3d.ai/en/get-started/features), [API-access plans](https://hyper3d.ai/pricing) |
| TRELLIS.2 self-hosted | Open model/code and more operational control | Upstream specifies Linux/NVIDIA and ≥24 GB GPU memory; dependencies have separate licenses. Defer until measured volume or privacy requirements justify GPU operation and a complete license review. [Upstream](https://github.com/microsoft/TRELLIS.2) |
| Artist/manual model | Controllable product detail, efficient correction of difficult objects | Keep as benchmark and production fallback; record time and rights, not only invoice cost. |

Select one provider only after measuring accepted output. API credits are not
comparable between vendors; include texturing, remeshing, retries and failed
submissions in the cost model. [Meshy API costs](https://docs.meshy.ai/en/api/pricing),
[Tripo billing](https://platform.tripo3d.ai/docs/billing)

### Contract finding that affects the choice

Meshy's API page says API inputs/outputs are not used for training, but its terms
updated September 19, 2026, section 2.9 permit non-enterprise user-content training
unless otherwise agreed. Its terms also restrict certain competitive analysis and
service redistribution. Obtain written terms covering Roomio's embedded workflow,
evaluation and confidential assets; do not resolve the conflict by trusting the
more reassuring page. [API FAQ](https://www.meshy.ai/api),
[current terms](https://www.meshy.ai/terms-of-use)

Tripo's terms distinguish free versus paid rights and state a no-training provision
in the paid-user section; verify the actual API agreement, retention, processing
locations and allowed downstream use. Neither provider can grant rights to a
furniture photograph or product design the customer does not own or license.
[Tripo terms](https://www.tripo3d.ai/terms)

## Intake and review workflow

1. **Identify the object.** Staff choose product/SKU, custom furniture, or
   illustrative substitute. Obtain permission to process images and publish the
   resulting model. Record brand, variant, input owner and rights evidence.
2. **Collect physical information.** Width/depth/height in cm, measurement source,
   front direction, floor/wall/ceiling/support mounting, and any moving/clearance
   envelope. Distinguish manufacturer specification from a buyer's measurement.
3. **Prepare images privately.** Crop the selected furniture, remove unrelated
   people/address details and metadata, validate file type/decoded size, then
   retain only necessary source material. A product URL is a reference; do not
   build an unrestricted URL-fetching or scraping service.
4. **Choose existing/import/capture/generate.** Deduplicate by product and variant
   within authorized scope. Do not reuse another developer's private asset because
   its bytes or appearance match.
5. **Produce a draft.** Execute a durable job in the backend. Show progress and a
   meaningful failure/retry state. Browser refresh must not lose the job or trigger
   a second paid generation.
6. **Normalize and optimize.** Quarantine source outputs; create a safe, versioned
   GLB, thumbnail, material metadata and a simple placement/collision proxy.
7. **Review.** Compare the object from front, sides, rear and top under neutral
   light. Check distinctive geometry, material response, dimensions, bounding box,
   pivot, orientation, mount point and placement in the actual duplex.
8. **Approve a version.** Store reviewer/time, supported use, evidence, asset hash
   and limitations. Publish only that immutable version. A regenerated asset starts
   a new review and cannot silently replace furniture in a shared configuration.

Represent review dimensions separately: `visualStatus`, `dimensionsStatus`,
`rightsStatus`, and `publicationStatus`. One boolean named `verified` would hide
different kinds of uncertainty. Buyer-supplied measurements are useful but should
not be labeled manufacturer-certified.

## Asset contract and integration

Proposed logical fields, not code implemented in this assignment:

```text
Asset: id, organizationId, product/SKU?, category, sourceKind
AssetVersion: id, assetId, contentHash, normalizedObjectKey, thumbnailKey
  sourceUnits, orientationTransform, dimensionsCm{w,d,h}, dimensionEvidence
  mountKind, supportAnchor?, footprintCm, clearanceEnvelope?
  materialSlots, triangleCount, textureBytes, decodedResourceEstimate
  visualStatus, dimensionsStatus, rightsStatus, reviewerId, reviewedAt
  sourceReferences, provider/model/settings?, rightsRecordId
FurnitureItem addition: assetRef? { assetVersionId, allowedMaterialVariantId? }
```

Keep the procedural `archetype` and placement fields for fallback and migration.
Derive render and collider dimensions from the same approved asset version; do not
accept arbitrary client dimensions that disagree with it. Explicitly bridge mount
semantics to `mount.ts`; start with floor-standing objects. Keep existing authored
stairs and void/rail geometry under architectural control.

For exact products, disable unconstrained resizing and arbitrary material recoloring
in buyer mode. A 220 cm branded sofa stretched to 180 cm is a different product.
Select another approved size/SKU instead. Custom/illustrative items may allow
resizing with the changed status shown clearly.

Use glTF/GLB for browser delivery. glTF uses meters and Y-up; GLB packaging alone
does not guarantee that resources are embedded. Validate external resource references
and supported extensions before loading. [Khronos specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

After applying source node transforms, align the model's front, center its X/Z
footprint and place its base at local Y=0. Apply one unit conversion at the domain/
renderer boundary. Fit a **uniform** scale from trusted measurements, then compare
all three resulting extents. If ratios disagree, request correction; independently
stretching each axis can conceal a wrong generated shape. Bake and record accepted
normalization into the published asset version.

For a hypothetical sofa measured **220 × 90 × 85 cm**, its normalized extents are
**2.20 × 0.90 × 0.85 m**. Place it in Embercrest's Living & Dining room using the
existing room-local x/z and rotation conventions. Ground it at the room's storey
elevation and check against clear wall faces, opening swings and approved circulation
zones. Reload the home and confirm the same geometry, collider and asset version.
This is a worked integration example, not a measurement of a real uploaded sofa.

An object fitting its final footprint does **not** establish that it can pass
through a door, lift or stair during delivery. Describe placement feedback as
layout clearance. Do not promise access, code compliance or ergonomic suitability
without the relevant reviewed measurements and rules.

## Delivery and rendering quality

Optimize offline with a pinned asset-processing toolchain; glTF Transform is a
candidate for simplification, deduplication and compression. Inspect the result
after each material/geometry transformation. [Tool documentation](https://gltf-transform.dev/cli)

Proposed starting budgets for the pilot, to tune with device evidence:

- Typical furniture: 10–40k triangles; mobile derivative 2–10k when needed.
- Typical compressed asset: ≤2 MB; ≥5 MB requires explicit scene-budget review.
- Default textures: 1K, 2K only for justified hero surfaces; count decoded memory,
  not just compressed file size. A 2048² RGBA texture is about 16 MiB before mipmaps.
- First interactive room: target ≤6 MB transferred 3D assets. Load other rooms and
  the upper floor progressively; reuse instances/materials where appropriate.
- Test the whole visible scene and transitions. Per-asset budgets alone do not
  establish acceptable FPS or memory use in a 20-room model.

Evaluate Meshopt/Draco and KTX2 with the installed renderer/loader versions. Do not
ship both geometry codecs without need. Keep decoder work lazy, bound cache/VRAM,
clone mutable materials per variant, dispose safely, and test WebGL recovery.
Use standard neutral-lit PBR materials without photographic shadows baked into
albedo where possible. Human review should catch overly glossy fabric, opaque
glass, thin/missing legs and floating contact shadows. A lightmap for fixed building
geometry must not bake furniture shadows that remain after a buyer moves the sofa.

Gaussian splats and 2D cutouts may support reference viewing or a fixed marketing
shot, but do not automatically provide editable mesh geometry, reliable collision,
material variants or relighting. They are not the initial furniture contract.

## Bounded provider evaluation

Start with four rights-cleared cases: upholstered sofa, thin-legged chair,
wooden cabinet and glass table. Compare Meshy and Tripo with identical real
single-view and multiview inputs: **16 initial tasks**. Only run this after the
evaluation/usage terms and an explicit spend limit are accepted. No customer image
is required for the first synthetic/owned test set.

If either candidate is viable, expand to 12 objects covering sofa, accent chair,
dining chair, bed, wardrobe, dining table, coffee table, rug, plant, glass side
table, mirror and pendant. At two providers × two input modes, the complete set
is **48 tasks including the first 16**. Permit at most one recorded retry per case,
with a global money cap. Do not shop through unlimited providers after failures.

Use two reviewers blinded to provider, a measured or manufacturer-approved
reference, fixed views/light and the same mobile budgets. Score appearance 25%,
geometry/proportions 25%, material quality 15%, placement correctness 15%,
production effort/cost 10% and reliability/latency 10%. Report each component and
failure class; a weighted average must not hide a critical failure.

Hard gates: processing/publication rights established; valid safe asset; no missing
major parts; correct orientation/pivot; measured dimensions supported. Suggested
post-normalization extent tolerance is max(2 cm, 1% of the axis), subject to reviewer
agreement. That is an engineering QA target, not a measurement guarantee. Verify
shape landmarks too: forcing the bounding box alone does not prove fidelity.

Record provider/model/settings, task/retry cost, elapsed latency, operator minutes,
optimization time, manual correction time, bytes, triangles, target-device behavior,
dimension deviations and rejection reasons. Calculate:

```text
cost_per_approved_asset =
  (all generation + retries + processing + artist/operator labor) / approved_count
```

Promote a provider only if it reduces that cost or time at acceptable quality
against manual/import production. A practical proposed pilot threshold is at
least 80% of ordinary opaque objects accepted after ≤15 minutes of correction;
report difficult glass/mirror classes separately. If it fails, keep manual/import
production and ship the sales pilot. That outcome is useful evidence, not a reason
to compromise the assets.
