/**
 * /play run/stop/send wiring (PLAN.md Phase 3.5) — pure and UI-free so the
 * whole flow is unit-testable headless:
 *
 * - `runInSim`  — workspace program → zod validate → SimLink.loadBehavior
 *                 + ctl run (the in-page `POST /api/behavior` twins).
 * - `stopSim` / `resetSimWorld` — halt the VM; rewind the world to spawn.
 * - `sendToRobot` — the SAME program over real HTTP to a robot (§5.4
 *                 `POST /api/behavior` then `/api/behavior/ctl run`).
 *
 * The Sim* interfaces are structural subsets of @botforge/sim's `SimLink` /
 * `SimWorld`, so this module never imports the heavy sim/three bundle and
 * tests can pass minimal fakes.
 */

import { parseBsj, type BsjProgram } from "@botforge/behavior-ts";
import { validationIssues } from "../blockly/validate";
import { httpUrl, normalizeHost } from "../robotlink/host";

/* ------------------------------------------------------------------ */
/* Structural link/world types (satisfied by SimLink / SimWorld)       */
/* ------------------------------------------------------------------ */

/** What running a behavior needs from a SimLink. */
export interface BehaviorSimLink {
  /** `POST /api/behavior` equivalent; throws on invalid programs. */
  loadBehavior(bsj: unknown): void;
  /** `POST /api/behavior/ctl` equivalent. */
  ctl(action: "run" | "stop"): void;
}

/** What a world reset additionally needs (re-sync of the link clocks). */
export interface ResettableSimLink extends BehaviorSimLink {
  connect(): Promise<void>;
  disconnect(): void;
}

export interface ResettableSimWorld {
  reset(): void;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type PrepareOutcome = { ok: true; program: BsjProgram } | { ok: false; issues: string[] };

/**
 * Validate a candidate program (object or JSON string) against §5.3.
 * Returns the parsed, typed program or human-readable issue lines.
 */
export function prepareProgram(source: unknown): PrepareOutcome {
  const record = typeof source === "object" && source !== null ? (source as BsjProgram) : null;
  if (record && Array.isArray(record.handlers)) {
    // Editor-shaped program: reuse the editor's multi-line issue report.
    const issues = validationIssues(record);
    if (issues.length > 0) return { ok: false, issues };
  }
  try {
    return { ok: true, program: parseBsj(source) };
  } catch (err) {
    return { ok: false, issues: [err instanceof Error ? err.message : String(err)] };
  }
}

/* ------------------------------------------------------------------ */
/* Run in Sim / Stop / Reset                                           */
/* ------------------------------------------------------------------ */

/**
 * ▶ Run in Sim: validate, load into the SimLink's behavior VM, start it.
 * On a validation failure the link is left untouched.
 */
export function runInSim(link: BehaviorSimLink, source: unknown): PrepareOutcome {
  const prepared = prepareProgram(source);
  if (!prepared.ok) return prepared;
  try {
    link.loadBehavior(prepared.program);
    link.ctl("run");
  } catch (err) {
    return { ok: false, issues: [err instanceof Error ? err.message : String(err)] };
  }
  return prepared;
}

/** ⏹ Stop: halt the behavior VM (it stops the motors itself). */
export function stopSim(link: BehaviorSimLink): void {
  link.ctl("stop");
}

/**
 * ⟲ Reset world: stop the behavior, rewind the world to its spawn state,
 * and bounce the link so its sim-time schedules (telemetry, deadman)
 * re-anchor at t=0 instead of waiting for the old timestamps.
 * The caller restarts the realtime clock (speed is page state).
 */
export async function resetSimWorld(
  link: ResettableSimLink,
  world: ResettableSimWorld
): Promise<void> {
  link.ctl("stop");
  link.disconnect();
  world.reset();
  await link.connect();
}

/* ------------------------------------------------------------------ */
/* ⬆ Send to Robot                                                     */
/* ------------------------------------------------------------------ */

/** §5.4 behavior upload endpoint for a user-typed host. */
export function behaviorUrl(host: string): string {
  return httpUrl(host, "/api/behavior");
}

/** §5.4 behavior run/stop control endpoint for a user-typed host. */
export function behaviorCtlUrl(host: string): string {
  return httpUrl(host, "/api/behavior/ctl");
}

export type SendOutcome =
  { ok: true; host: string } | { ok: false; message: string; issues?: string[] };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * Send the program to a real robot: `POST /api/behavior` with the BSJ,
 * then `POST /api/behavior/ctl {action:"run"}`. Resolves to a readable
 * outcome — network and HTTP failures never throw.
 */
export async function sendToRobot(
  host: string,
  source: unknown,
  fetchImpl: FetchLike = defaultFetch
): Promise<SendOutcome> {
  const h = normalizeHost(host);
  if (!h) {
    return { ok: false, message: "Enter your robot's hostname or IP address first." };
  }
  const prepared = prepareProgram(source);
  if (!prepared.ok) {
    return { ok: false, message: "Not valid BSJ yet — fix these first:", issues: prepared.issues };
  }

  const jsonHeaders = { "Content-Type": "application/json" };
  let upload: { ok: boolean; status: number };
  try {
    upload = await fetchImpl(behaviorUrl(h), {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(prepared.program),
    });
  } catch {
    return {
      ok: false,
      message: `Could not reach ${h}. Check the robot is powered on and on the same Wi-Fi network.`,
    };
  }
  if (!upload.ok) {
    return { ok: false, message: `${h} rejected the behavior (HTTP ${upload.status}).` };
  }

  let run: { ok: boolean; status: number };
  try {
    run = await fetchImpl(behaviorCtlUrl(h), {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ action: "run" }),
    });
  } catch {
    return { ok: false, message: `Behavior uploaded, but ${h} became unreachable before it ran.` };
  }
  if (!run.ok) {
    return {
      ok: false,
      message: `Behavior uploaded, but starting it failed (HTTP ${run.status}).`,
    };
  }
  return { ok: true, host: h };
}
