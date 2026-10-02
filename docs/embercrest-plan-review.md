# Embercrest reference review

Reference: user-supplied `Duplex.pptx`, slide 1, screenshots of A&B Building
Floor Plans pages 4–5, flat 504. Reviewed 28 September 2026.

The model uses the printed metric labels. Room placement is inferred from the
plan images. The model is a visualization, not a construction drawing.

| Model feature | Previous footprint | Printed footprint now used |
| --- | --- | --- |
| Living & Dining | 6.50 × 3.55 m | 6.50 × 3.65 m |
| Main open balcony | 6.50 × 1.50 m | 6.67 × 1.60 m |
| Side balconies | 1.47 × 3.60 m | 1.48 × 3.60 m |
| Study Nook | 2.50 × 1.35 m | 2.97 × 1.35 m |
| Upper Entry (previously Store) | 1.80 × 1.80 m | 1.67 × 1.80 m |

The remaining printed bedroom, toilet, kitchen, family-room and lobby sizes
already matched. Regression tests pin all 17 named spaces with printed sizes;
other tests check overlaps and paired opening alignment across storeys.

The source's area statement lists 83.27 m² lower carpet, 65.30 m² upper carpet,
18.71 m² lower balconies and 6.14 m² upper balconies. Thus 148.57 m² is carpet
and 173.42 m² includes balconies. The marketing image's “1867 sq ft carpet”
conflicts with this table: 1866.69 sq ft is the table's balcony-inclusive total.
The app now follows the area statement and does not call that total carpet.

## Limits of the model

The renderer measures room polygons at wall centre lines. These footprints
match the labels, but clear internal dimensions differ by wall thickness.
The source does not establish the model's assumed 12 cm walls or 3 m storeys.
Stair and corridor sizes, openings, furniture and finishes are inferred.
Curved balconies are rectangular approximations; small wall recesses are
simplified. The source notes 50 mm sunken toilets/balconies, which the flat
floor renderer does not reproduce. Computed model areas must not be presented
as certified carpet, saleable or regulatory areas.

These limits remain visible in the room schedule. Customer sign-off needs
architect-reviewed clear dimensions, wall sections and floor elevations.
