# CAD_GUIDE — conventions for BOTFORGE printed parts

Every printed part in `robots/<id>/parts/*.py` and every helper in
`botforge_engine/cadlib/` follows these rules. The `cad` generator enforces
the QC rules on every build.

## Units, axes, origin

- **Units: millimetres.** Everywhere — scripts, params, QC report.
- **Z-up.** `z = 0` is the print bed; parts are modelled in their print
  orientation, never rotated for printing afterwards.
- **Origin at the part's center bottom**: XY-centered footprint, solid rising
  from `z = 0`. If the part is used in another orientation (e.g. the lid or
  the caster mount are flipped in the assembly), that flip happens in the
  assembly poses — the script still models print-orientation, bed at `z = 0`.

## The script contract

```python
def build(params: dict) -> cq.Workplane: ...
```

- One part per script, exposing exactly this function. `params` comes from
  the manifest's `printed_parts[].params`; scripts keep a module-level
  `DEFAULTS` dict and merge (`params` wins) so a bare `build({})` works.
- Return a single `cq.Workplane` carrying the finished solid. No file I/O, no
  globals mutated, deterministic output for the same params.
- Scripts may import `botforge_engine.cadlib` (they run inside the engine
  process). Keep scripts short (< ~120 lines) and params-driven.

## Fits and walls — `cadlib` constants

- `FIT = 0.20` — clearance added to every press/slide fit. A bore for a 3 mm
  shaft is Ø3.2; a lip for a 92 mm opening is 91.8. Use `FIT` (or `FIT/2` per
  side) instead of inventing clearances.
- `WALL_MIN = 1.6` — minimum wall/feature thickness (about four 0.4 mm
  perimeters). Nothing structural thinner than this.

## Support-free printing (hard rule)

All parts print support-free, flat on the bed:

- **Overhangs ≤ 45°** from vertical. Model downward-facing transitions as 45°
  ramps/gables, not horizontal ceilings.
- **Chamfer, don't fillet, downward-facing features.** A fillet under an
  overhang starts tangent-horizontal and will droop; a ≤45° chamfer prints
  clean. Fillets are fine on vertical edges (`edges("|Z")`) and top edges.
- Small horizontal holes (≤ ~6 mm, e.g. shaft and eye holes) and short wall
  cutouts are allowed — printers bridge them — but they are counted by the
  overhang report, so keep them rare and small.
- Interior cavities need sloped (≤45°... i.e. ≥45° from horizontal) ceilings
  or must open upward/rearward (see `head.py`'s 45° pocket roof).

## QC rules (enforced by the `cad` generator)

Each exported STL is checked with trimesh (loaded with `validate=True`,
which drops zero-area degenerate triangles — an OCC tessellation artifact at
sphere poles — and welds duplicate vertices, exactly as slicers do):

- **Watertight** — hard error if not.
- **Volume > 0** — hard error if not.
- **Bounding box ≤ 200 × 200 × 200 mm** — hard error if not.
- **Overhang report**: % of face area with normal `z < -cos(40°)` (faces
  steeper than 50° facing down), excluding triangles entirely below
  `z = 0.5 mm` (bed contact). More than **2%** ⇒ build warning
  `part <id>: N.N% support-needing overhangs`. Target 0%.

Results are written to `dist/<id>/cad/qc_report.json` as
`{part_id: {watertight, volume_mm3, bbox, overhang_pct}}`, floats rounded to
2 dp, no timestamps or absolute paths (deterministic).

## Exports

Per part id (qty is handled downstream): `cad/stl/<id>.stl` (linear
deflection tolerance 0.05 mm), `cad/step/<id>.step`, `cad/3mf/<id>.3mf`
(CadQuery exports 3MF natively).

## cadlib helpers

| Helper                               | Kind   | Notes                                                                      |
| ------------------------------------ | ------ | -------------------------------------------------------------------------- |
| `plate(l, w, t, corner_r=3)`         | base   | rounded-corner plate, z 0..t                                               |
| `boss_m2_selftap(h)`                 | union  | Ø5 boss, Ø1.7 self-tap pilot through                                       |
| `pocket_sg90(depth=16)`              | cutter | 23.2×12.6 body + flush tab slots + pilots                                  |
| `clamp_n20()`                        | union  | friction walls for the 12×10 N20 body, 10 mm long                          |
| `pocket_pcb(dims, standoff)`         | union  | perimeter wall + 4 corner standoffs (never cut a pocket into a thin floor) |
| `wire_channel(l, path_w=4, depth=3)` | cutter | straight open channel bar                                                  |
| `snapless_lip(l, w, h=2)`            | union  | lid lip ring, outer = opening − FIT, chamfered lead-in                     |

_Positive features_ sit on `z = 0` and are unioned onto a body; _cutters_ are
translated into place and cut. All helpers are XY-centered on their own
origin.
