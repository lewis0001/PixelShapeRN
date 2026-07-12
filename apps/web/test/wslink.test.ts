import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsLink } from "../lib/robotlink/WsLink";
import type { Telemetry, RobotInfo, LogEntry } from "../lib/robotlink/types";

/** Scriptable stand-in for the browser WebSocket, injected into WsLink. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static get last(): MockWebSocket {
    const inst = MockWebSocket.instances.at(-1);
    if (!inst) throw new Error("no MockWebSocket instantiated");
    return inst;
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("send on non-open socket");
    this.sent.push(data);
  }

  close(): void {
    this.serverClose();
  }

  /* test helpers */
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  serverMessage(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }

  serverClose(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function makeLink(host = "botforge-a1b2.local"): WsLink {
  return new WsLink(host, { WebSocketImpl: MockWebSocket });
}

/** connect() + open the mock socket, resolving the connect promise. */
async function connectLink(link: WsLink): Promise<MockWebSocket> {
  const p = link.connect();
  const socket = MockWebSocket.last;
  socket.serverOpen();
  await p;
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WsLink", () => {
  it("connects to ws://<host>:81/ws and sends hello on open", async () => {
    const link = makeLink("botforge-a1b2.local");
    const socket = await connectLink(link);

    expect(socket.url).toBe("ws://botforge-a1b2.local:81/ws");
    expect(socket.sentJson()).toEqual([{ t: "hello" }]);
    expect(link.state).toBe("connected");
  });

  it("normalizes pasted URLs into a bare host", async () => {
    const link = makeLink("http://192.168.1.42/");
    const socket = await connectLink(link);
    expect(socket.url).toBe("ws://192.168.1.42:81/ws");
  });

  it("emits open on connect and close on disconnect", async () => {
    const link = makeLink();
    const opened = vi.fn();
    const closed = vi.fn();
    link.on("open", opened);
    link.on("close", closed);

    await connectLink(link);
    expect(opened).toHaveBeenCalledTimes(1);

    link.disconnect();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(link.state).toBe("disconnected");
  });

  it("sends ping every 500 ms while connected", async () => {
    const link = makeLink();
    const socket = await connectLink(link);

    vi.advanceTimersByTime(1500);
    const pings = socket.sentJson().filter((m) => (m as { t: string }).t === "ping");
    expect(pings).toHaveLength(3);

    link.disconnect();
    const before = socket.sent.length;
    vi.advanceTimersByTime(2000);
    expect(socket.sent.length).toBe(before); // pings stop after disconnect
  });

  it("dispatches telemetry events", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    const onTelemetry = vi.fn();
    link.on("telemetry", onTelemetry);

    const frame = {
      batt_mv: 3900,
      rssi: -55,
      mode: "manual",
      behavior_running: false,
      sensors: { range: { mm: 240 }, line: { l: 1000, r: 2000 } },
    };
    socket.serverMessage({ t: "telemetry", ...frame });

    expect(onTelemetry).toHaveBeenCalledTimes(1);
    expect(onTelemetry).toHaveBeenCalledWith(frame satisfies Telemetry);
  });

  it("dispatches hello.ack with robot info and exposes robotInfo", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    const onAck = vi.fn();
    link.on("hello.ack", onAck);

    const info: RobotInfo = {
      fw: "0.1.0",
      robot_id: "rover-v1",
      name: "Rover",
      cfg_hash: "a1b2c3d4",
    };
    socket.serverMessage({ t: "hello.ack", ...info });

    expect(onAck).toHaveBeenCalledWith(info);
    expect(link.robotInfo).toEqual(info);
  });

  it("dispatches log events", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    const onLog = vi.fn();
    link.on("log", onLog);

    socket.serverMessage({ t: "log", level: "warn", msg: "battery low" });
    expect(onLog).toHaveBeenCalledWith({ level: "warn", msg: "battery low" } satisfies LogEntry);
  });

  it("ignores unknown message types and malformed frames", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    const onTelemetry = vi.fn();
    link.on("telemetry", onTelemetry);

    expect(() => {
      socket.serverMessage({ t: "future.thing", x: 1 });
      socket.serverMessage("not json {{{");
      socket.serverMessage("42");
      socket.serverMessage({ no_t: true });
    }).not.toThrow();
    expect(onTelemetry).not.toHaveBeenCalled();
    expect(link.state).toBe("connected");
  });

  it("reconnects with backoff after an unexpected close", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    expect(MockWebSocket.instances).toHaveLength(1);

    socket.serverClose(); // robot dropped the connection
    expect(link.state).toBe("disconnected");

    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1); // first retry after 500 ms
    expect(MockWebSocket.instances).toHaveLength(2);

    // Retry fails too -> next delay doubles to 1000 ms.
    MockWebSocket.last.serverClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    // Reconnect succeeds: hello sent again, backoff resets.
    MockWebSocket.last.serverOpen();
    expect(link.state).toBe("connected");
    expect(MockWebSocket.last.sentJson()).toEqual([{ t: "hello" }]);
  });

  it("does not reconnect after an intentional disconnect", async () => {
    const link = makeLink();
    await connectLink(link);
    link.disconnect();

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("rejects connect() when the first attempt fails and stays quiet", async () => {
    const link = makeLink();
    const p = link.connect();
    const rejection = expect(p).rejects.toThrow(/could not connect/);
    MockWebSocket.last.serverClose();
    await rejection;
    expect(link.state).toBe("disconnected");

    // No auto-retry storm on a host that never answered.
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("drops sends while not connected instead of throwing", () => {
    const link = makeLink();
    expect(() => link.send({ t: "cmd.drive", l: 0, r: 0 })).not.toThrow();
  });

  it("removes listeners via the returned off-function", async () => {
    const link = makeLink();
    const socket = await connectLink(link);
    const onLog = vi.fn();
    const off = link.on("log", onLog);
    off();

    socket.serverMessage({ t: "log", level: "info", msg: "hi" });
    expect(onLog).not.toHaveBeenCalled();
  });
});
