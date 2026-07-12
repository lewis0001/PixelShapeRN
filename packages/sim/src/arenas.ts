/**
 * Simulator arenas (PLAN.md Phase 3.3): `open_floor`, `line_oval`,
 * `obstacle_pen`.
 *
 * Arenas are pure data + pure functions — no physics or rendering imports —
 * so they work identically headless (vitest) and in the browser:
 *
 * - Static geometry is a list of `StaticBox` (SimWorld turns them into
 *   Rapier colliders; the visual layer turns the same list into meshes).
 * - Seeded random obstacles come from `scatter(rng)` fed by SimWorld's
 *   mulberry32 arena stream.
 * - The ground "texture" is a canvas-independent `Float32Array` darkness
 *   field (0 = light floor, 1 = black line) with a bilinear `sample(x, y)`
 *   used by the virtual line sensors. The three.js visual texture is
 *   derived from the very same data (`SimWorld` builds a DataTexture from
 *   `GroundField.data`), so what the sensor sees is what you see.
 */

import type { Rng } from "./rng.js";
import { randRange } from "./rng.js";

/** Axis-aligned-in-z static box: center, half extents, yaw about +z. */
export interface StaticBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

/** Rasterized ground darkness field. World origin is the arena center. */
export interface GroundField {
  /** Cells along world x. */
  width: number;
  /** Cells along world y. */
  height: number;
  /** Covered world extent (meters), centered on the origin. */
  worldW: number;
  worldH: number;
  /** Row-major darkness values in [0, 1]; row 0 is y = −worldH/2. */
  data: Float32Array;
  /** Bilinear sample at world (x, y); outside the field returns 0. */
  sample(x: number, y: number): number;
}

/** Track parametrization for lap-progress measurement (line_oval). */
export interface TrackInfo {
  /** Total centerline length in meters. */
  lengthM: number;
  /** Arc-length position (meters, in [0, lengthM)) of the nearest track point. */
  progressM(x: number, y: number): number;
}

export interface ArenaDef {
  id: string;
  name: string;
  /** World footprint in meters (for cameras / the visual ground plane). */
  sizeM: { x: number; y: number };
  /** Robot spawn pose. */
  spawn: { x: number; y: number; yaw: number };
  /** Fixed static geometry (walls). */
  walls: StaticBox[];
  /** Seeded random static geometry (obstacle blocks). */
  scatter?: (rng: Rng) => StaticBox[];
  /** Ground darkness field, or null for a plain light floor. */
  ground: GroundField | null;
  /** Present when the arena has a followable track. */
  track?: TrackInfo;
}

/* ------------------------------------------------------------------ */
/* Ground field                                                        */
/* ------------------------------------------------------------------ */

/** Rasterize `darkness(x, y)` into a `GroundField` at `cellM` resolution. */
export function makeGroundField(
  worldW: number,
  worldH: number,
  cellM: number,
  darkness: (x: number, y: number) => number
): GroundField {
  const width = Math.max(2, Math.round(worldW / cellM));
  const height = Math.max(2, Math.round(worldH / cellM));
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const y = ((j + 0.5) / height - 0.5) * worldH;
    for (let i = 0; i < width; i++) {
      const x = ((i + 0.5) / width - 0.5) * worldW;
      data[j * width + i] = darkness(x, y);
    }
  }
  const sample = (x: number, y: number): number => {
    const fx = (x / worldW + 0.5) * width - 0.5;
    const fy = (y / worldH + 0.5) * height - 0.5;
    if (fx < -0.5 || fy < -0.5 || fx > width - 0.5 || fy > height - 0.5) return 0;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const a = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
    const b = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  return { width, height, worldW, worldH, data, sample };
}

/* ------------------------------------------------------------------ */
/* open_floor                                                          */
/* ------------------------------------------------------------------ */

const openFloor: ArenaDef = {
  id: "open_floor",
  name: "Open floor",
  sizeM: { x: 3, y: 3 },
  spawn: { x: 0, y: 0, yaw: 0 },
  walls: [],
  ground: null,
};

/* ------------------------------------------------------------------ */
/* line_oval                                                           */
/* ------------------------------------------------------------------ */

/**
 * Stadium-shaped oval: two straights of length 2·OVAL_HL joined by
 * semicircular ends of radius OVAL_R. The centerline is the set of points
 * at distance OVAL_R from the central segment (−OVAL_HL,0)–(OVAL_HL,0).
 */
const OVAL_HL = 0.5; // half length of the central segment (m)
const OVAL_R = 0.4; // end-cap / offset radius (m)
/** Painted line half-width (m). 34 mm line ≫ 20 mm sensor spacing. */
const LINE_HALF_W = 0.017;
/** Soft edge width of the painted line (m). */
const LINE_EDGE = 0.003;

const OVAL_LENGTH = 4 * OVAL_HL + 2 * Math.PI * OVAL_R;

function distToCentralSegment(x: number, y: number): number {
  const cx = Math.max(-OVAL_HL, Math.min(OVAL_HL, x));
  return Math.hypot(x - cx, y);
}

function ovalDarkness(x: number, y: number): number {
  const d = Math.abs(distToCentralSegment(x, y) - OVAL_R);
  if (d <= LINE_HALF_W - LINE_EDGE) return 1;
  if (d >= LINE_HALF_W + LINE_EDGE) return 0;
  return (LINE_HALF_W + LINE_EDGE - d) / (2 * LINE_EDGE);
}

/**
 * Arc-length progress along the oval centerline, clockwise-from-above
 * starting at (−OVAL_HL, −OVAL_R): bottom straight (+x) → right cap →
 * top straight (−x) → left cap.
 */
function ovalProgressM(x: number, y: number): number {
  if (x > OVAL_HL) {
    const theta = Math.atan2(y, x - OVAL_HL); // −π/2 (bottom) … +π/2 (top)
    return 2 * OVAL_HL + (theta + Math.PI / 2) * OVAL_R;
  }
  if (x < -OVAL_HL) {
    let theta = Math.atan2(y, x + OVAL_HL); // arrives at π/2, leaves at 3π/2
    if (theta < Math.PI / 2) theta += 2 * Math.PI;
    return 4 * OVAL_HL + Math.PI * OVAL_R + (theta - Math.PI / 2) * OVAL_R;
  }
  if (y < 0) return x + OVAL_HL; // bottom straight, travelling +x
  return 2 * OVAL_HL + Math.PI * OVAL_R + (OVAL_HL - x); // top straight, −x
}

const lineOval: ArenaDef = {
  id: "line_oval",
  name: "Line oval",
  sizeM: { x: 2 * (OVAL_HL + OVAL_R) + 0.5, y: 2 * OVAL_R + 0.5 },
  // Spawn on the bottom straight, heading along the track (+x).
  spawn: { x: 0, y: -OVAL_R, yaw: 0 },
  walls: [],
  ground: makeGroundField(2 * (OVAL_HL + OVAL_R) + 0.5, 2 * OVAL_R + 0.5, 0.005, ovalDarkness),
  track: { lengthM: OVAL_LENGTH, progressM: ovalProgressM },
};

/* ------------------------------------------------------------------ */
/* obstacle_pen                                                        */
/* ------------------------------------------------------------------ */

const PEN_SIZE = 1.5; // inner width/depth (m)
const PEN_WALL_T = 0.05;
const PEN_WALL_H = 0.5;
const PEN_BLOCKS = 4;
const PEN_SPAWN = { x: -0.5, y: -0.5, yaw: 0.7 };

function penWalls(): StaticBox[] {
  const half = PEN_SIZE / 2;
  const c = half + PEN_WALL_T / 2;
  const hLong = half + PEN_WALL_T;
  const hz = PEN_WALL_H / 2;
  return [
    { cx: c, cy: 0, cz: hz, hx: PEN_WALL_T / 2, hy: hLong, hz, yaw: 0 },
    { cx: -c, cy: 0, cz: hz, hx: PEN_WALL_T / 2, hy: hLong, hz, yaw: 0 },
    { cx: 0, cy: c, cz: hz, hx: hLong, hy: PEN_WALL_T / 2, hz, yaw: 0 },
    { cx: 0, cy: -c, cz: hz, hx: hLong, hy: PEN_WALL_T / 2, hz, yaw: 0 },
  ];
}

function penScatter(rng: Rng): StaticBox[] {
  const blocks: StaticBox[] = [];
  const lim = PEN_SIZE / 2 - 0.18; // keep clear of the walls
  let guard = 0;
  while (blocks.length < PEN_BLOCKS && guard++ < 200) {
    const hx = randRange(rng, 0.03, 0.06);
    const hy = randRange(rng, 0.03, 0.06);
    const cx = randRange(rng, -lim, lim);
    const cy = randRange(rng, -lim, lim);
    const yaw = randRange(rng, 0, Math.PI);
    if (Math.hypot(cx - PEN_SPAWN.x, cy - PEN_SPAWN.y) < 0.35) continue;
    if (blocks.some((b) => Math.hypot(cx - b.cx, cy - b.cy) < 0.3)) continue;
    blocks.push({ cx, cy, cz: 0.06, hx, hy, hz: 0.06, yaw });
  }
  return blocks;
}

const obstaclePen: ArenaDef = {
  id: "obstacle_pen",
  name: "Obstacle pen",
  sizeM: { x: PEN_SIZE + 2 * PEN_WALL_T, y: PEN_SIZE + 2 * PEN_WALL_T },
  spawn: PEN_SPAWN,
  walls: penWalls(),
  scatter: penScatter,
  ground: null,
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const ARENAS: Record<string, ArenaDef> = Object.freeze({
  open_floor: openFloor,
  line_oval: lineOval,
  obstacle_pen: obstaclePen,
});
