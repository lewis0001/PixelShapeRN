/**
 * `RobotLink` — the one transport interface between the app and a robot
 * (PLAN.md §5.4). Two implementations share it: `WsLink(host)` for real
 * hardware over WebSocket, and the Phase-3 `SimLink(world)` that runs
 * in-page against the simulator. Keep this module dependency-free.
 */

import type { AppToRobotMsg, LogEntry, RobotInfo, Telemetry } from "./types";

export type LinkState = "disconnected" | "connecting" | "connected";

/** Events a RobotLink can emit, with their callback payloads. */
export interface RobotLinkEvents {
  /** Transport is open (for WsLink: socket opened, hello sent). */
  open: void;
  /** Transport closed — intentionally or not. */
  close: void;
  /** Robot answered our hello with its identity. */
  "hello.ack": RobotInfo;
  /** 5 Hz telemetry frame. */
  telemetry: Telemetry;
  /** Robot log line. */
  log: LogEntry;
}

export type RobotLinkEventName = keyof RobotLinkEvents;

export interface RobotLink {
  /** Resolves once the transport is open (hello sent). Rejects on failure. */
  connect(): Promise<void>;
  /** Tear down the transport; no auto-reconnect afterwards. */
  disconnect(): void;
  /** Fire-and-forget send; silently dropped while not connected. */
  send(msg: AppToRobotMsg): void;
  /** Subscribe to a link event. Returns an unsubscribe function. */
  on<E extends RobotLinkEventName>(event: E, cb: (payload: RobotLinkEvents[E]) => void): () => void;
  readonly state: LinkState;
}

/**
 * Minimal typed event emitter for RobotLink implementations (WsLink,
 * SimLink). Listener errors are swallowed so one bad subscriber can't
 * break the transport.
 */
export class RobotLinkEmitter {
  private listeners = new Map<RobotLinkEventName, Set<(payload: never) => void>>();

  on<E extends RobotLinkEventName>(
    event: E,
    cb: (payload: RobotLinkEvents[E]) => void
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as (payload: never) => void);
    return () => {
      set.delete(cb as (payload: never) => void);
    };
  }

  protected emit<E extends RobotLinkEventName>(event: E, payload: RobotLinkEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (p: RobotLinkEvents[E]) => void)(payload);
      } catch {
        // A subscriber threw — never let that take down the link.
      }
    }
  }
}
