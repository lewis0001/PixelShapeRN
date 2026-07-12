/**
 * Seedable RNG for the simulator (PLAN.md Phase 3.3).
 *
 * mulberry32 — tiny, fast, deterministic. Every source of randomness in the
 * sim (sensor noise, arena block placement, the BSJ `rand` expression) draws
 * from a mulberry32 stream so that a given seed always reproduces the exact
 * same run.
 */

/** A deterministic PRNG returning uniform floats in [0, 1). */
export type Rng = () => number;

/** Create a mulberry32 PRNG from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random integer in the inclusive range [lo, hi]. */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Uniform random float in [lo, hi). */
export function randRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/**
 * Standard-normal sampler over an `Rng` (Box–Muller, with the spare value
 * cached so consumption stays deterministic: two uniforms per two normals).
 */
export function makeGaussian(rng: Rng): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    do {
      u = rng();
    } while (u === 0);
    v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}
