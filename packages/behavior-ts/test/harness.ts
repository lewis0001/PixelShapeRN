/**
 * Golden-trace fixture harness (TypeScript side).
 * The procedure and trace format are specified in ../fixtures/README.md and
 * mirrored by the C++ harness in
 * packages/firmware/test/native/test_vm/test_main.cpp.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BsjInterpreter, type RobotAdapter } from "../src/interpreter.js";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export interface Fixture {
  name: string;
  desc: string;
  tick_ms: number;
  run_ms: number;
  sensors?: Record<string, [number, number][]>;
  random?: number[];
  buttons?: number[];
  program: unknown;
  expected: string[];
  expect_error?: string;
}

export function loadFixtureIndex(): string[] {
  return JSON.parse(readFileSync(FIXTURES_DIR + "index.json", "utf8")) as string[];
}

export function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(FIXTURES_DIR + file, "utf8")) as Fixture;
}

/** Recording mock adapter with scripted sensors and random sequence. */
export class MockAdapter implements RobotAdapter {
  readonly trace: string[] = [];
  nowMs = 0;
  private randomIndex = 0;

  constructor(
    private readonly sensors: Record<string, [number, number][]> = {},
    private readonly randomSeq: number[] = []
  ) {}

  private record(line: string): void {
    this.trace.push(`${this.nowMs} ${line}`);
  }

  drive(l: number, r: number): void {
    this.record(`drive ${l} ${r}`);
  }
  servo(id: string, deg: number): void {
    this.record(`servo ${id} ${deg}`);
  }
  led(r: number, g: number, b: number, id?: number): void {
    this.record(`led ${r} ${g} ${b} ${id ?? -1}`);
  }
  ledOff(id?: number): void {
    this.record(`led_off ${id ?? -1}`);
  }
  tone(hz: number, ms: number): void {
    this.record(`tone ${hz} ${ms}`);
  }
  log(level: number, msg: string): void {
    this.record(`log ${level} ${msg}`);
  }
  readSensor(name: string): number {
    const profile = this.sensors[name];
    if (!profile) return 0;
    let value = 0;
    for (const [t, v] of profile) {
      if (t <= this.nowMs) value = v;
      else break;
    }
    return value;
  }
  now(): number {
    return this.nowMs;
  }
  random(lo: number, _hi: number): number {
    if (this.randomSeq.length === 0) return lo;
    const v = this.randomSeq[this.randomIndex % this.randomSeq.length];
    this.randomIndex++;
    return v;
  }
}

export interface FixtureResult {
  trace: string[];
  error: string | null;
  running: boolean;
}

/** Run a fixture through the reference interpreter (README procedure). */
export function runFixture(fx: Fixture): FixtureResult {
  const mock = new MockAdapter(fx.sensors ?? {}, fx.random ?? []);
  const vm = new BsjInterpreter(mock);
  vm.load(fx.program);
  mock.nowMs = 0;
  vm.start(0);
  const buttons = fx.buttons ?? [];
  for (let t = fx.tick_ms; t <= fx.run_ms; t += fx.tick_ms) {
    mock.nowMs = t;
    for (const b of buttons) if (b === t) vm.onButton(t);
    vm.tick(t);
  }
  return { trace: mock.trace, error: vm.error(), running: vm.running() };
}
