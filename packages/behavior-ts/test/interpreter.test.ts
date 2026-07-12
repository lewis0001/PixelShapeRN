/** Interpreter API/edge-case tests beyond the shared golden fixtures. */
import { describe, expect, it } from "vitest";

import { BsjInterpreter } from "../src/index.js";
import { MockAdapter } from "./harness.js";

function make(program: unknown, mock = new MockAdapter()) {
  const vm = new BsjInterpreter(mock);
  vm.load(program);
  return { vm, mock };
}

const onStart = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  bsj: 1,
  vars: [],
  handlers: [{ event: { type: "on_start" }, body }],
  ...extra,
});

describe("BsjInterpreter", () => {
  it("stop() halts and stops the motors exactly once", () => {
    const { vm, mock } = make(onStart([{ op: "wait", ms: 1000 }]));
    vm.start(0);
    expect(vm.running()).toBe(true);
    vm.stop();
    vm.stop(); // idempotent
    expect(vm.running()).toBe(false);
    expect(mock.trace).toEqual(["0 drive 0 0"]);
  });

  it("uses adapter.now() when no timestamp is passed", () => {
    const mock = new MockAdapter();
    const { vm } = make(
      onStart([
        { op: "wait", ms: 100 },
        { op: "log", msg: "x" },
      ]),
      mock
    );
    mock.nowMs = 500;
    vm.start();
    mock.nowMs = 600;
    vm.tick();
    expect(mock.trace).toEqual(["600 log 1 x"]);
  });

  it("caps concurrent activations at 4 (5th on_start handler is skipped)", () => {
    const handlers = Array.from({ length: 5 }, (_, i) => ({
      event: { type: "on_start" },
      body: [
        { op: "tone", hz: 100 + i, ms: 1 },
        { op: "wait", ms: 1000 }, // keep every activation alive
      ],
    }));
    const { vm, mock } = make({ bsj: 1, vars: [], handlers });
    vm.start(0);
    expect(mock.trace).toEqual(["0 tone 100 1", "0 tone 101 1", "0 tone 102 1", "0 tone 103 1"]);
  });

  it("errors on break outside a loop", () => {
    const { vm, mock } = make(onStart([{ op: "break" }]));
    vm.start(0);
    expect(vm.running()).toBe(false);
    expect(vm.error()).toBe("break outside loop");
    expect(mock.trace).toEqual(["0 drive 0 0", "0 log 3 break outside loop"]);
  });

  it("errors on frame overflow (nesting deeper than 16 frames)", () => {
    let stmt: Record<string, unknown> = { op: "log", msg: "deep" };
    for (let i = 0; i < 16; i++) stmt = { op: "if", cond: 1, body: [stmt] };
    const { vm } = make(onStart([stmt]));
    vm.start(0);
    expect(vm.error()).toBe("frame overflow");
  });

  it("errors on an inverted rand range", () => {
    const { vm } = make(onStart([{ op: "wait", ms: { rand: [5, 1] } }]));
    vm.start(0);
    expect(vm.error()).toBe("rand range invalid");
  });

  it("clamps drive/led/servo params", () => {
    const { vm, mock } = make(
      onStart([
        { op: "drive", l: 250, r: -250 },
        { op: "led", r: 300, g: -5, b: 12 },
        { op: "servo", id: "s", deg: 200 },
      ])
    );
    vm.start(0);
    expect(mock.trace).toEqual(["0 drive 100 -100", "0 led 255 0 12 -1", "0 servo s 180"]);
  });

  it("wait 0 and drive_time 0 complete within the same tick", () => {
    const { vm, mock } = make(
      onStart([
        { op: "wait", ms: 0 },
        { op: "drive_time", l: 10, r: 10, ms: 0 },
        { op: "log", msg: "done" },
      ])
    );
    vm.start(0);
    expect(mock.trace).toEqual(["0 drive 10 10", "0 drive 0 0", "0 log 1 done"]);
    expect(vm.running()).toBe(true); // behavior stays armed for future events
  });

  it("load() replaces a running program (stopping motors)", () => {
    const { vm, mock } = make(onStart([{ op: "wait", ms: 1000 }]));
    vm.start(0);
    vm.load(onStart([{ op: "log", msg: "second" }]));
    expect(mock.trace).toEqual(["0 drive 0 0"]);
    expect(vm.running()).toBe(false);
    mock.nowMs = 10;
    vm.start(10);
    expect(mock.trace).toEqual(["0 drive 0 0", "10 log 1 second"]);
  });

  it("throws on start() with no program", () => {
    const vm = new BsjInterpreter(new MockAdapter());
    expect(() => vm.start(0)).toThrow(/no program/);
  });
});
