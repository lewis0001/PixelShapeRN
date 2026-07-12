"use client";

/**
 * /play — split view: physics sim canvas (left) + the shared Blockly
 * editor (right), with a merged sim/robot log console (PLAN.md Phase 3.5).
 *
 * The heavy pieces load lazily: this module is behind `next/dynamic`
 * (ssr: false), and three/Rapier/urdf-loader live in ./simView which is
 * only reached via a runtime `import()`.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { BlockEditor, type BlockEditorApi } from "../../components/BlockEditor";
import { LogConsole, type LogRow } from "../../components/LogConsole";
import { TelemetryBar } from "../../components/TelemetryBar";
import { resetSimWorld, runInSim, sendToRobot, stopSim } from "../../lib/play/session";
import { WsLink } from "../../lib/robotlink/WsLink";
import { normalizeHost } from "../../lib/robotlink/host";
import type { LogLevel, Telemetry } from "../../lib/robotlink/types";
import type { SimView } from "./simView";

const HOST_KEY = "botforge.play.host";
const MAX_LOG_ROWS = 200;
const DEFAULT_ARENA = "obstacle_pen";

type SimStatus = "booting" | "ready" | "error";
type RobotState = "disconnected" | "connecting" | "connected";

interface ArenaOption {
  id: string;
  name: string;
}

interface LiveSimState {
  leds: { r: number; g: number; b: number }[];
  running: boolean;
  timeS: number;
}

const FALLBACK_ARENAS: ArenaOption[] = [{ id: DEFAULT_ARENA, name: "Obstacle pen" }];

const btn =
  "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold " +
  "text-zinc-200 transition-colors hover:border-[#ff6b35]/60 hover:text-[#ff6b35] " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200";

export default function PlayClient() {
  /* ---------------- sim state ---------------- */
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SimView | null>(null);
  const editorApiRef = useRef<BlockEditorApi | null>(null);
  const speedRef = useRef(1);
  const logKeyRef = useRef(0);

  const [simStatus, setSimStatus] = useState<SimStatus>("booting");
  const [simError, setSimError] = useState("");
  const [arenaId, setArenaId] = useState(DEFAULT_ARENA);
  const [arenas, setArenas] = useState<ArenaOption[]>(FALLBACK_ARENAS);
  const [bootNonce, setBootNonce] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [usingMeshes, setUsingMeshes] = useState(true);
  const [live, setLive] = useState<LiveSimState>({ leds: [], running: false, timeS: 0 });
  const [simTelemetry, setSimTelemetry] = useState<Telemetry | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);

  /* ---------------- robot (WsLink) state ---------------- */
  const wsRef = useRef<WsLink | null>(null);
  const wsOffRef = useRef<(() => void)[]>([]);
  const wsUserDisconnectRef = useRef(false);
  const [robotState, setRobotState] = useState<RobotState>("disconnected");
  const [robotHost, setRobotHost] = useState("");
  const [wsTelemetry, setWsTelemetry] = useState<Telemetry | null>(null);
  const [sending, setSending] = useState(false);

  const appendLog = useCallback((source: "sim" | "robot", level: LogLevel, msg: string) => {
    setLogs((prev) => {
      const row: LogRow = {
        key: logKeyRef.current++,
        time: new Date().toLocaleTimeString(),
        level,
        msg: `${source} ▸ ${msg}`,
      };
      return [...prev, row].slice(-MAX_LOG_ROWS);
    });
  }, []);

  /* ---------------- sim boot (per arena) ---------------- */

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: SimView | null = null;
    const offFns: (() => void)[] = [];
    setSimStatus("booting");
    setSimTelemetry(null);

    void (async () => {
      try {
        const mod = await import("./simView");
        const v = await mod.createSimView(host, { arena: arenaId });
        if (cancelled) {
          v.dispose();
          return;
        }
        view = v;
        viewRef.current = v;
        setArenas(Object.values(mod.ARENAS).map((a) => ({ id: a.id, name: a.name })));
        setUsingMeshes(v.usingUrdfMeshes);
        offFns.push(
          v.link.on("log", (entry) => appendLog("sim", entry.level, entry.msg)),
          v.link.on("telemetry", (frame) => setSimTelemetry(frame as Telemetry))
        );
        v.setSpeed(speedRef.current);
        setSimStatus("ready");
        appendLog("sim", "info", `Arena "${arenaId}" ready.`);
      } catch (err) {
        if (cancelled) return;
        setSimStatus("error");
        setSimError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      for (const off of offFns) off();
      if (viewRef.current === view) viewRef.current = null;
      view?.dispose();
    };
  }, [arenaId, bootNonce, appendLog]);

  // Light poll of LED colors / behavior state / sim clock for the overlay.
  useEffect(() => {
    const t = setInterval(() => {
      const v = viewRef.current;
      if (!v) return;
      setLive({
        leds: v.getLeds().map((c) => ({ ...c })),
        running: v.link.behaviorRunning,
        timeS: v.world.timeMs / 1000,
      });
    }, 200);
    return () => clearInterval(t);
  }, []);

  /* ---------------- robot link ---------------- */

  const teardownRobot = useCallback(() => {
    for (const off of wsOffRef.current) off();
    wsOffRef.current = [];
    wsRef.current?.disconnect();
    wsRef.current = null;
    setWsTelemetry(null);
  }, []);

  useEffect(() => teardownRobot, [teardownRobot]); // unmount cleanup

  const connectRobot = useCallback(
    async (host: string) => {
      teardownRobot();
      wsUserDisconnectRef.current = false;
      setRobotHost(host);
      setRobotState("connecting");
      const link = new WsLink(host);
      wsRef.current = link;
      wsOffRef.current = [
        link.on("open", () => {
          setRobotState("connected");
          appendLog("robot", "info", `Live link to ${host} open.`);
        }),
        link.on("close", () => {
          if (wsUserDisconnectRef.current) {
            setRobotState("disconnected");
          } else {
            setRobotState("connecting"); // WsLink auto-reconnects with backoff
            appendLog("robot", "warn", "Live link lost — reconnecting…");
          }
        }),
        link.on("log", (entry) => appendLog("robot", entry.level, entry.msg)),
        link.on("telemetry", (frame) => setWsTelemetry(frame)),
      ];
      try {
        await link.connect();
      } catch {
        if (wsRef.current === link) {
          teardownRobot();
          setRobotState("disconnected");
          appendLog(
            "robot",
            "warn",
            `No live link to ${host} — behavior was still sent over HTTP.`
          );
        }
      }
    },
    [appendLog, teardownRobot]
  );

  function disconnectRobot() {
    wsUserDisconnectRef.current = true;
    teardownRobot();
    setRobotState("disconnected");
    appendLog("robot", "info", "Live link closed.");
  }

  /* ---------------- controls ---------------- */

  function handleRun() {
    const v = viewRef.current;
    const api = editorApiRef.current;
    if (!v || !api) return;
    const program = api.getProgram();
    if (!program) return;
    const outcome = runInSim(v.link, program);
    if (!outcome.ok) {
      api.notify({
        kind: "error",
        title: "Not valid BSJ yet — fix these first:",
        lines: outcome.issues,
      });
      return;
    }
    appendLog("sim", "info", `▶ Running "${outcome.program.name ?? "program"}".`);
  }

  function handleStop() {
    const v = viewRef.current;
    if (!v) return;
    stopSim(v.link);
    appendLog("sim", "info", "⏹ Behavior stopped.");
  }

  async function handleResetWorld() {
    const v = viewRef.current;
    if (!v) return;
    await resetSimWorld(v.link, v.world);
    v.setSpeed(speedRef.current);
    appendLog("sim", "info", "⟲ World reset to spawn.");
  }

  function handleSpeed(next: number) {
    setSpeed(next);
    speedRef.current = next;
    viewRef.current?.setSpeed(next);
  }

  async function handleSend() {
    const api = editorApiRef.current;
    if (!api) return;
    const program = api.getProgram();
    if (!program) return;
    let suggestion = robotHost;
    try {
      suggestion = suggestion || localStorage.getItem(HOST_KEY) || "";
    } catch {
      /* storage blocked */
    }
    const input = window.prompt(
      "Robot hostname or IP (shown on its setup page, e.g. botforge-a1b2.local):",
      suggestion || "botforge-xxxx.local"
    );
    if (input === null) return; // cancelled
    const host = normalizeHost(input);
    setSending(true);
    const outcome = await sendToRobot(host, program);
    setSending(false);
    if (!outcome.ok) {
      api.notify({
        kind: "error",
        title: "Send to Robot failed.",
        lines: [outcome.message, ...(outcome.issues ?? [])],
      });
      appendLog("robot", "error", outcome.message);
      return;
    }
    try {
      localStorage.setItem(HOST_KEY, outcome.host);
    } catch {
      /* storage blocked */
    }
    api.notify({ kind: "success", title: `Behavior sent to ${outcome.host} — running.` });
    appendLog("robot", "info", `Behavior uploaded to ${outcome.host} and started.`);
    void connectRobot(outcome.host);
  }

  /* ---------------- render ---------------- */

  const simReady = simStatus === "ready";
  const activeTelemetry = robotState === "connected" && wsTelemetry ? wsTelemetry : simTelemetry;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 lg:h-screen lg:overflow-hidden">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-[#ff6b35]">
            ←
          </Link>
          <h1 className="text-lg font-extrabold tracking-tight text-white">Play</h1>
          <p className="hidden text-xs text-zinc-500 sm:block">
            Build blocks, watch them run in physics, then send the same program to your robot.
          </p>
          <div className="ml-auto flex items-center gap-2">
            {robotState !== "disconnected" && (
              <span
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  robotState === "connected"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "animate-pulse border-amber-500/40 bg-amber-500/10 text-amber-400"
                }`}
              >
                Robot {robotState === "connected" ? "connected" : "connecting"} · {robotHost}
                <button
                  onClick={disconnectRobot}
                  aria-label="Disconnect robot"
                  title="Disconnect"
                  className="text-zinc-500 transition-colors hover:text-red-400"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* -------- LEFT: sim canvas + telemetry + console -------- */}
        <section className="flex flex-col border-b border-zinc-800 lg:min-h-0 lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <button
              onClick={handleRun}
              disabled={!simReady}
              className={btn}
              title="Run the blocks in the simulator"
            >
              ▶ Run in Sim
            </button>
            <button
              onClick={handleStop}
              disabled={!simReady}
              className={btn}
              title="Stop the running behavior"
            >
              ⏹ Stop
            </button>
            <button
              onClick={() => void handleResetWorld()}
              disabled={!simReady}
              className={btn}
              title="Put the robot back at the arena spawn"
            >
              ⟲ Reset world
            </button>

            <select
              value={arenaId}
              onChange={(e) => setArenaId(e.target.value)}
              disabled={simStatus === "booting"}
              aria-label="Arena"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-semibold text-zinc-200 focus:border-[#ff6b35] focus:outline-none"
            >
              {arenas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <div
              className="flex overflow-hidden rounded-lg border border-zinc-700 text-xs font-semibold"
              role="group"
              aria-label="Sim speed"
            >
              {[1, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className={`px-3 py-1.5 transition-colors ${
                    speed === s
                      ? "bg-[#ff6b35] text-zinc-950"
                      : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>

            <button
              onClick={() => viewRef.current?.resetView()}
              disabled={!simReady}
              className={btn}
              title="Reset the camera"
            >
              ⌖ View
            </button>
            <button
              onClick={() => viewRef.current?.link.pressButton()}
              disabled={!simReady}
              className={btn}
              title="Press the robot's BOOT button (fires on-button blocks)"
            >
              ● Button
            </button>

            <button
              onClick={() => void handleSend()}
              disabled={sending}
              className="ml-auto rounded-lg bg-[#ff6b35] px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-[#ff8555] disabled:cursor-wait disabled:opacity-60"
              title="POST the behavior to a real robot and run it"
            >
              {sending ? "Sending…" : "⬆ Send to Robot"}
            </button>
          </div>

          {/* Canvas */}
          <div className="relative h-[42vh] bg-[#0c0c0f] lg:h-auto lg:min-h-0 lg:flex-1">
            <div ref={canvasHostRef} className="absolute inset-0" />
            {simStatus === "booting" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="animate-pulse text-sm text-zinc-500">Loading physics…</p>
              </div>
            )}
            {simStatus === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm font-semibold text-red-400">
                  The simulator couldn&apos;t start.
                </p>
                <p className="max-w-md font-mono text-xs text-zinc-400">{simError}</p>
                <button onClick={() => setBootNonce((n) => n + 1)} className={btn}>
                  Try again
                </button>
              </div>
            )}
            {simReady && (
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    LED
                  </span>
                  {live.leds.map((c, i) => (
                    <span
                      key={i}
                      title={`pixel ${i}: rgb(${c.r}, ${c.g}, ${c.b})`}
                      className="h-3.5 w-3.5 rounded-full border border-zinc-600"
                      style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                    />
                  ))}
                </span>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    live.running
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-700 bg-zinc-950/80 text-zinc-400"
                  }`}
                >
                  {live.running ? "behavior running" : "behavior stopped"} · t=
                  {live.timeS.toFixed(1)}s{speed !== 1 ? ` · ${speed}×` : ""}
                </span>
                {!usingMeshes && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                    collider visuals
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Telemetry mini-bar (active link: robot when connected, else sim) */}
          <div className="border-t border-zinc-800 px-3 py-2">
            <TelemetryBar telemetry={activeTelemetry} />
          </div>

          {/* Merged sim + robot console */}
          <div className="border-t border-zinc-800 px-3 py-2">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Console — sim &amp; robot
            </h2>
            <LogConsole rows={logs} />
          </div>
        </section>

        {/* -------- RIGHT: shared block editor -------- */}
        <section className="flex h-[80vh] flex-col lg:h-auto lg:min-h-0 lg:w-1/2">
          <BlockEditor
            className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950"
            apiRef={editorApiRef}
            heading={<h2 className="text-lg font-extrabold tracking-tight text-white">Blocks</h2>}
          />
        </section>
      </div>
    </div>
  );
}
