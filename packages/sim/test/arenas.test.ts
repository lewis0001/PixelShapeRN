import { describe, expect, it } from "vitest";
import { ARENAS, makeGroundField, mulberry32 } from "../src/index.js";

describe("ARENAS registry", () => {
  it("contains the three Phase-3 arenas", () => {
    expect(ARENAS.open_floor).toBeDefined();
    expect(ARENAS.line_oval).toBeDefined();
    expect(ARENAS.obstacle_pen).toBeDefined();
  });

  it("obstacle_pen: four walls plus seeded, reproducible blocks", () => {
    const pen = ARENAS.obstacle_pen;
    expect(pen.walls).toHaveLength(4);
    const a = pen.scatter!(mulberry32(7));
    const b = pen.scatter!(mulberry32(7));
    const c = pen.scatter!(mulberry32(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThanOrEqual(3);
    for (const box of a) {
      expect(Math.abs(box.cx)).toBeLessThan(0.75);
      expect(Math.abs(box.cy)).toBeLessThan(0.75);
      // blocks keep clear of the spawn corner
      expect(Math.hypot(box.cx - pen.spawn.x, box.cy - pen.spawn.y)).toBeGreaterThan(0.3);
    }
  });

  it("line_oval: ground sampler is dark on the line, light off it", () => {
    const oval = ARENAS.line_oval;
    const g = oval.ground!;
    expect(g.sample(0, -0.4)).toBeGreaterThan(0.9); // bottom straight centerline
    expect(g.sample(0, 0.4)).toBeGreaterThan(0.9); // top straight
    expect(g.sample(0.9, 0)).toBeGreaterThan(0.9); // right cap apex
    expect(g.sample(0, 0)).toBe(0); // oval interior
    expect(g.sample(0, -0.6)).toBe(0); // outside the track
  });

  it("line_oval: track progress is monotonic along the centerline", () => {
    const track = ARENAS.line_oval.track!;
    expect(track.lengthM).toBeCloseTo(4 * 0.5 + 2 * Math.PI * 0.4, 6);
    // Walk the stadium centerline: bottom straight → right cap → top → left cap.
    const pts: [number, number][] = [];
    for (let x = -0.45; x <= 0.45; x += 0.05) pts.push([x, -0.4]);
    for (let a = -80; a <= 80; a += 10) {
      const t = (a * Math.PI) / 180;
      pts.push([0.5 + 0.4 * Math.cos(t), 0.4 * Math.sin(t)]);
    }
    for (let x = 0.45; x >= -0.45; x -= 0.05) pts.push([x, 0.4]);
    let prev = track.progressM(...pts[0]);
    for (const [x, y] of pts.slice(1)) {
      const s = track.progressM(x, y);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(prev).toBeLessThan(track.lengthM);
  });

  it("makeGroundField samples bilinearly and returns 0 outside", () => {
    const f = makeGroundField(1, 1, 0.01, (x) => (x > 0 ? 1 : 0));
    expect(f.sample(0.3, 0)).toBe(1);
    expect(f.sample(-0.3, 0)).toBe(0);
    expect(f.sample(5, 5)).toBe(0);
    expect(f.data.length).toBe(f.width * f.height);
  });
});
