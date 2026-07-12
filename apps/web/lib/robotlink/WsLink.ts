/**
 * `WsLink` — RobotLink over WebSocket to `ws://<host>:81/ws` (PLAN.md §5.4).
 *
 * - sends `hello` as soon as the socket opens
 * - sends `ping` every 500 ms (feeds the firmware's 800 ms manual-mode deadman)
 * - auto-reconnects with exponential backoff after an unexpected close
 * - parses incoming JSON and ignores unknown message types gracefully
 *
 * The WebSocket implementation is injectable via the constructor so unit
 * tests can drive a mock without a network.
 */

import { RobotLinkEmitter, type LinkState, type RobotLink } from "./RobotLink";
import { wsUrl } from "./host";
import type { AppToRobotMsg, LogEntry, RobotInfo, Telemetry } from "./types";

/** The subset of the WebSocket API WsLink relies on (mock-friendly). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

const WS_OPEN = 1;

export interface WsLinkOptions {
  /** WebSocket class to instantiate; defaults to the global WebSocket. */
  WebSocketImpl?: WebSocketCtor;
  /** Keepalive cadence, ms (default 500 per §5.4). */
  pingIntervalMs?: number;
  /** First reconnect delay, ms (default 500). */
  reconnectInitialMs?: number;
  /** Backoff cap, ms (default 8000). */
  reconnectMaxMs?: number;
}

export class WsLink extends RobotLinkEmitter implements RobotLink {
  readonly host: string;

  private readonly WebSocketImpl: WebSocketCtor;
  private readonly pingIntervalMs: number;
  private readonly reconnectInitialMs: number;
  private readonly reconnectMaxMs: number;

  private socket: WebSocketLike | null = null;
  private _state: LinkState = "disconnected";
  private _robotInfo: RobotInfo | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number;
  /** True after a successful open; enables auto-reconnect on close. */
  private shouldReconnect = false;

  constructor(host: string, options: WsLinkOptions = {}) {
    super();
    this.host = host;
    const globalWs = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    const impl = options.WebSocketImpl ?? globalWs;
    if (!impl) {
      throw new Error("WsLink: no WebSocket implementation available");
    }
    this.WebSocketImpl = impl;
    this.pingIntervalMs = options.pingIntervalMs ?? 500;
    this.reconnectInitialMs = options.reconnectInitialMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 8000;
    this.reconnectDelayMs = this.reconnectInitialMs;
  }

  get state(): LinkState {
    return this._state;
  }

  /** Identity from the last `hello.ack`, if any. */
  get robotInfo(): RobotInfo | null {
    return this._robotInfo;
  }

  /**
   * Open the socket. Resolves once connected (hello sent). Rejects if the
   * first attempt fails; after a successful open, later drops reconnect
   * automatically until `disconnect()` is called.
   */
  connect(): Promise<void> {
    if (this._state === "connected") return Promise.resolve();
    if (this._state === "connecting") {
      return Promise.reject(new Error("WsLink: connect already in progress"));
    }
    this._state = "connecting";
    return new Promise<void>((resolve, reject) => {
      this.openSocket(resolve, reject);
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // Socket may already be closed; nothing to do.
      }
    }
    if (this._state !== "disconnected") {
      this._state = "disconnected";
      this.emit("close", undefined);
    }
  }

  send(msg: AppToRobotMsg): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) return; // drop while offline
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // A racing close can make send throw — treat as a dropped frame.
    }
  }

  /* ---------------------------------------------------------------- */

  private openSocket(resolve?: () => void, reject?: (err: Error) => void): void {
    let settled = false;
    const socket = new this.WebSocketImpl(wsUrl(this.host));
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket) return;
      settled = true;
      this._state = "connected";
      this.shouldReconnect = true;
      this.reconnectDelayMs = this.reconnectInitialMs;
      this.send({ t: "hello" });
      this.startPing();
      this.emit("open", undefined);
      resolve?.();
    };

    socket.onmessage = (ev) => {
      if (socket !== this.socket) return;
      this.handleMessage(ev.data);
    };

    socket.onerror = () => {
      // A close event follows in every WebSocket implementation; the
      // close handler owns state transitions and rejection.
    };

    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.stopPing();
      const wasConnected = this._state === "connected";
      this._state = "disconnected";
      if (!settled) {
        settled = true;
        reject?.(new Error(`WsLink: could not connect to ${wsUrl(this.host)}`));
      }
      if (wasConnected) {
        this.emit("close", undefined);
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;
      this._state = "connecting";
      this.openSocket();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ t: "ping" });
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // malformed frame — ignore
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const msg = parsed as Record<string, unknown> & { t?: unknown };
    switch (msg.t) {
      case "hello.ack": {
        const info: RobotInfo = {
          fw: String(msg.fw ?? ""),
          robot_id: String(msg.robot_id ?? ""),
          name: String(msg.name ?? ""),
          cfg_hash: String(msg.cfg_hash ?? ""),
        };
        this._robotInfo = info;
        this.emit("hello.ack", info);
        break;
      }
      case "telemetry": {
        const { t: _t, ...telemetry } = msg;
        this.emit("telemetry", telemetry as unknown as Telemetry);
        break;
      }
      case "log": {
        const entry: LogEntry = {
          level: (msg.level as LogEntry["level"]) ?? "info",
          msg: String(msg.msg ?? ""),
        };
        this.emit("log", entry);
        break;
      }
      default:
        // Unknown message type — forward-compatible, ignore.
        break;
    }
  }
}
