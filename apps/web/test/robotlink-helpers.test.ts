import { describe, expect, it } from "vitest";
import { httpUrl, normalizeHost, wsUrl } from "../lib/robotlink/host";
import { arcadeMix, batteryPct } from "../lib/robotlink/drive";

describe("normalizeHost", () => {
  it("passes through a bare mDNS host", () => {
    expect(normalizeHost("botforge-a1b2.local")).toBe("botforge-a1b2.local");
  });

  it("strips scheme, path and whitespace", () => {
    expect(normalizeHost("  http://192.168.1.42/setup?x=1 ")).toBe("192.168.1.42");
    expect(normalizeHost("ws://robot.local/ws")).toBe("robot.local");
  });
});

describe("wsUrl / httpUrl", () => {
  it("builds the §5.4 endpoints", () => {
    expect(wsUrl("botforge-a1b2.local")).toBe("ws://botforge-a1b2.local:81/ws");
    expect(httpUrl("botforge-a1b2.local", "/api/config")).toBe(
      "http://botforge-a1b2.local/api/config"
    );
    expect(httpUrl("http://10.0.0.7/", "api/behavior")).toBe("http://10.0.0.7/api/behavior");
  });

  it("respects an explicit ws port and strips it for http", () => {
    expect(wsUrl("robot.local:8081")).toBe("ws://robot.local:8081/ws");
    expect(httpUrl("robot.local:8081", "/api/info")).toBe("http://robot.local/api/info");
  });
});

describe("arcadeMix", () => {
  it("zeroes inside the 8% deadzone", () => {
    expect(arcadeMix(0, 0)).toEqual({ l: 0, r: 0 });
    expect(arcadeMix(0.05, 0.05)).toEqual({ l: 0, r: 0 });
  });

  it("full forward drives both wheels forward", () => {
    expect(arcadeMix(0, 1)).toEqual({ l: 100, r: 100 });
  });

  it("full reverse drives both wheels back", () => {
    expect(arcadeMix(0, -1)).toEqual({ l: -100, r: -100 });
  });

  it("pure steer spins in place", () => {
    expect(arcadeMix(1, 0)).toEqual({ l: 100, r: -100 });
    expect(arcadeMix(-1, 0)).toEqual({ l: -100, r: 100 });
  });

  it("mixes throttle and steer, clamped to ±100", () => {
    const { l, r } = arcadeMix(0.5, 1);
    expect(l).toBe(100); // saturated
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(100);
  });

  it("ramps smoothly from the deadzone edge", () => {
    const just = arcadeMix(0, 0.081);
    expect(just.l).toBeGreaterThanOrEqual(0);
    expect(just.l).toBeLessThanOrEqual(1);
  });
});

describe("batteryPct", () => {
  it("maps 3.3 V to 0 and 4.2 V to 100", () => {
    expect(batteryPct(3300)).toBe(0);
    expect(batteryPct(4200)).toBe(100);
  });

  it("clamps out-of-range readings", () => {
    expect(batteryPct(3000)).toBe(0);
    expect(batteryPct(4500)).toBe(100);
  });

  it("interpolates linearly", () => {
    expect(batteryPct(3750)).toBe(50);
  });
});
