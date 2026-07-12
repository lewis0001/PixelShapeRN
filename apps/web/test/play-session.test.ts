/**
 * /play session helpers (lib/play/session.ts) — pure-unit side:
 * validation outcomes, run/stop/reset wiring against a fake link, and the
 * send-to-robot HTTP flow against a mocked fetch (URLs, methods, bodies).
 */

import { describe, expect, it, vi } from "vitest";
import type { BsjProgram } from "@botforge/behavior-ts";
import {
  behaviorCtlUrl,
  behaviorUrl,
  prepareProgram,
  resetSimWorld,
  runInSim,
  sendToRobot,
  stopSim,
  type FetchLike,
} from "../lib/play/session";

const TINY_BSJ: BsjProgram = {
  bsj: 1,
  name: "smoke_drive",
  vars: [],
  handlers: [
    {
      event: { type: "on_start" },
      body: [{ op: "drive", l: 60, r: 60 }, { op: "wait", ms: 500 }, { op: "stop" }],
    },
  ],
};

function fakeLink() {
  const calls: string[] = [];
  return {
    calls,
    loadBehavior(bsj: unknown) {
      calls.push(`load:${(bsj as BsjProgram).name ?? "?"}`);
    },
    ctl(action: "run" | "stop") {
      calls.push(`ctl:${action}`);
    },
    connect() {
      calls.push("connect");
      return Promise.resolve();
    },
    disconnect() {
      calls.push("disconnect");
    },
  };
}

/* ------------------------------------------------------------------ */
/* URLs (§5.4 endpoints from messy user input)                         */
/* ------------------------------------------------------------------ */

describe("behavior endpoint URLs", () => {
  it("builds the §5.4 POST endpoints from a bare host", () => {
    expect(behaviorUrl("botforge-a1b2.local")).toBe("http://botforge-a1b2.local/api/behavior");
    expect(behaviorCtlUrl("botforge-a1b2.local")).toBe(
      "http://botforge-a1b2.local/api/behavior/ctl"
    );
  });

  it("normalizes scheme, path and port from user input", () => {
    expect(behaviorUrl("http://192.168.1.23/some/page")).toBe("http://192.168.1.23/api/behavior");
    expect(behaviorUrl("ws://rover.local:81/ws")).toBe("http://rover.local/api/behavior");
  });
});

/* ------------------------------------------------------------------ */
/* prepareProgram                                                      */
/* ------------------------------------------------------------------ */

describe("prepareProgram", () => {
  it("accepts a valid program object and returns the typed parse", () => {
    const out = prepareProgram(TINY_BSJ);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.program.name).toBe("smoke_drive");
  });

  it("accepts a valid JSON string", () => {
    const out = prepareProgram(JSON.stringify(TINY_BSJ));
    expect(out.ok).toBe(true);
  });

  it("reports the editor-style hint for a program with no handlers", () => {
    const out = prepareProgram({ bsj: 1, vars: [], handlers: [] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues[0]).toMatch(/event block/i);
  });

  it("reports readable issues for malformed input", () => {
    const bad = prepareProgram("this is not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]).toMatch(/not valid JSON/);

    const wrongShape = prepareProgram({ hello: "world" });
    expect(wrongShape.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* run / stop / reset wiring                                           */
/* ------------------------------------------------------------------ */

describe("runInSim / stopSim / resetSimWorld", () => {
  it("loads then runs a valid program", () => {
    const link = fakeLink();
    const out = runInSim(link, TINY_BSJ);
    expect(out.ok).toBe(true);
    expect(link.calls).toEqual(["load:smoke_drive", "ctl:run"]);
  });

  it("leaves the link untouched on a validation failure", () => {
    const link = fakeLink();
    const out = runInSim(link, { bsj: 1, vars: [], handlers: [] });
    expect(out.ok).toBe(false);
    expect(link.calls).toEqual([]);
  });

  it("surfaces a loadBehavior throw as an issue", () => {
    const link = fakeLink();
    link.loadBehavior = () => {
      throw new Error("VM said no");
    };
    const out = runInSim(link, TINY_BSJ);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues).toEqual(["VM said no"]);
  });

  it("stopSim sends ctl stop", () => {
    const link = fakeLink();
    stopSim(link);
    expect(link.calls).toEqual(["ctl:stop"]);
  });

  it("resetSimWorld stops, bounces the link around the world reset", async () => {
    const link = fakeLink();
    const world = {
      reset: () => {
        link.calls.push("world.reset");
      },
    };
    await resetSimWorld(link, world);
    expect(link.calls).toEqual(["ctl:stop", "disconnect", "world.reset", "connect"]);
  });
});

/* ------------------------------------------------------------------ */
/* sendToRobot (mocked fetch)                                          */
/* ------------------------------------------------------------------ */

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function mockFetch(responses: { ok: boolean; status: number }[]) {
  const calls: FetchCall[] = [];
  const impl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const res = responses[calls.length - 1];
    if (!res) throw new Error("unexpected extra fetch");
    return Promise.resolve(res);
  };
  return { calls, impl };
}

describe("sendToRobot", () => {
  it("POSTs the BSJ then ctl run to the right URLs", async () => {
    const { calls, impl } = mockFetch([
      { ok: true, status: 200 },
      { ok: true, status: 200 },
    ]);
    const out = await sendToRobot("http://botforge-a1b2.local/", TINY_BSJ, impl);
    expect(out).toEqual({ ok: true, host: "botforge-a1b2.local" });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://botforge-a1b2.local/api/behavior");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual(TINY_BSJ);

    expect(calls[1].url).toBe("http://botforge-a1b2.local/api/behavior/ctl");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(calls[1].init.body)).toEqual({ action: "run" });
  });

  it("stops after a rejected upload and reports the HTTP status", async () => {
    const { calls, impl } = mockFetch([{ ok: false, status: 413 }]);
    const out = await sendToRobot("rover.local", TINY_BSJ, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("HTTP 413");
    expect(calls).toHaveLength(1); // no ctl attempt
  });

  it("reports a failed ctl run distinctly", async () => {
    const { impl } = mockFetch([
      { ok: true, status: 200 },
      { ok: false, status: 500 },
    ]);
    const out = await sendToRobot("rover.local", TINY_BSJ, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/uploaded.*starting it failed.*500/i);
  });

  it("turns a network error into a readable message", async () => {
    const impl: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    const out = await sendToRobot("rover.local", TINY_BSJ, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain("Could not reach rover.local");
  });

  it("never fetches when the program is invalid", async () => {
    const impl = vi.fn<FetchLike>();
    const out = await sendToRobot("rover.local", { bsj: 1, vars: [], handlers: [] }, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.issues?.[0]).toMatch(/event block/i);
    }
    expect(impl).not.toHaveBeenCalled();
  });

  it("never fetches when the host is empty", async () => {
    const impl = vi.fn<FetchLike>();
    const out = await sendToRobot("   ", TINY_BSJ, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/hostname or IP/);
    expect(impl).not.toHaveBeenCalled();
  });
});
