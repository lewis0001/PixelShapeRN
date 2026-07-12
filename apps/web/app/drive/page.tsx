"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Joystick } from "../../components/Joystick";
import { TelemetryBar } from "../../components/TelemetryBar";
import { LogConsole, type LogRow } from "../../components/LogConsole";
import { LinkCard } from "../../components/LinkCard";
import { WsLink } from "../../lib/robotlink/WsLink";
import { httpUrl, normalizeHost } from "../../lib/robotlink/host";
import { arcadeMix } from "../../lib/robotlink/drive";
import type {
  LogLevel,
  RobotConfigModule,
  RobotInfo,
  RobotMode,
  Telemetry,
} from "../../lib/robotlink/types";

type UiLinkState = "disconnected" | "connecting" | "connected";

const DRIVE_SEND_HZ = 10;
const MAX_LOG_ROWS = 100;

const LED_SWATCHES: { name: string; r: number; g: number; b: number; css: string }[] = [
  { name: "Off", r: 0, g: 0, b: 0, css: "#27272a" },
  { name: "White", r: 255, g: 255, b: 255, css: "#ffffff" },
  { name: "Forge orange", r: 255, g: 107, b: 53, css: "#ff6b35" },
  { name: "Red", r: 255, g: 0, b: 0, css: "#ef4444" },
  { name: "Green", r: 0, g: 255, b: 0, css: "#22c55e" },
  { name: "Blue", r: 0, g: 80, b: 255, css: "#3b82f6" },
  { name: "Purple", r: 160, g: 0, b: 255, css: "#a855f7" },
  { name: "Cyan", r: 0, g: 255, b: 200, css: "#2dd4bf" },
];

const STATE_CHIP: Record<UiLinkState, { label: string; cls: string }> = {
  disconnected: { label: "Disconnected", cls: "border-zinc-700 bg-zinc-900 text-zinc-400" },
  connecting: {
    label: "Connecting…",
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",
  },
  connected: {
    label: "Connected",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  },
};

export default function DrivePage() {
  const [host, setHost] = useState("");
  const [linkState, setLinkState] = useState<UiLinkState>("disconnected");
  const [robotInfo, setRobotInfo] = useState<RobotInfo | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [mode, setMode] = useState<RobotMode>("manual");
  const [servos, setServos] = useState<RobotConfigModule[]>([]);
  const [servoDeg, setServoDeg] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [behaviorStatus, setBehaviorStatus] = useState<string | null>(null);

  const linkRef = useRef<WsLink | null>(null);
  const offFnsRef = useRef<(() => void)[]>([]);
  const userDisconnectRef = useRef(false);
  const driveVecRef = useRef({ x: 0, y: 0 });
  const driveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logKeyRef = useRef(0);

  const appendLog = useCallback((level: LogLevel, msg: string) => {
    setLogs((prev) => {
      const row: LogRow = {
        key: logKeyRef.current++,
        time: new Date().toLocaleTimeString(),
        level,
        msg,
      };
      return [...prev, row].slice(-MAX_LOG_ROWS);
    });
  }, []);

  const stopDriveLoop = useCallback((sendZero: boolean) => {
    if (driveTimerRef.current) {
      clearInterval(driveTimerRef.current);
      driveTimerRef.current = null;
    }
    driveVecRef.current = { x: 0, y: 0 };
    if (sendZero) linkRef.current?.send({ t: "cmd.drive", l: 0, r: 0 });
  }, []);

  const teardown = useCallback(() => {
    stopDriveLoop(false);
    for (const off of offFnsRef.current) off();
    offFnsRef.current = [];
    linkRef.current?.disconnect();
    linkRef.current = null;
  }, [stopDriveLoop]);

  useEffect(() => teardown, [teardown]); // full cleanup on unmount

  async function fetchServoModules(h: string) {
    try {
      const res = await fetch(httpUrl(h, "/api/config"), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const config = (await res.json()) as { modules?: RobotConfigModule[] };
      const servoModules = (config.modules ?? []).filter((m) => m.driver === "Servo_Std");
      setServos(servoModules);
      setServoDeg(Object.fromEntries(servoModules.map((m) => [m.id, 90])));
    } catch {
      setServos([]);
      appendLog("warn", "Could not read /api/config — servo sliders unavailable.");
    }
  }

  async function connect() {
    const h = normalizeHost(host);
    if (!h) {
      setError("Enter your robot's hostname or IP address first.");
      return;
    }
    teardown();
    setError(null);
    setBehaviorStatus(null);
    setRobotInfo(null);
    setTelemetry(null);
    userDisconnectRef.current = false;
    setLinkState("connecting");

    const link = new WsLink(h);
    linkRef.current = link;
    offFnsRef.current = [
      link.on("open", () => {
        setLinkState("connected");
        appendLog("info", `Connected to ${h}.`);
      }),
      link.on("close", () => {
        stopDriveLoop(false);
        if (userDisconnectRef.current) {
          setLinkState("disconnected");
        } else {
          // WsLink auto-reconnects with backoff after an unexpected drop.
          setLinkState("connecting");
          appendLog("warn", "Connection lost — reconnecting…");
        }
      }),
      link.on("hello.ack", (info) => setRobotInfo(info)),
      link.on("telemetry", (frame) => setTelemetry(frame)),
      link.on("log", (entry) => appendLog(entry.level, entry.msg)),
    ];

    try {
      await link.connect();
      void fetchServoModules(h);
    } catch {
      if (linkRef.current === link) {
        teardown();
        setLinkState("disconnected");
        setError(
          `Could not reach ${h}. Check the robot is powered on and on the same Wi-Fi network.`
        );
      }
    }
  }

  function disconnect() {
    userDisconnectRef.current = true;
    stopDriveLoop(true);
    teardown();
    setLinkState("disconnected");
    setTelemetry(null);
    appendLog("info", "Disconnected.");
  }

  function sendDriveFrame() {
    const { x, y } = driveVecRef.current;
    const { l, r } = arcadeMix(x, y);
    linkRef.current?.send({ t: "cmd.drive", l, r });
  }

  function handleJoystickVector(x: number, y: number) {
    driveVecRef.current = { x, y };
    if (!driveTimerRef.current) {
      sendDriveFrame();
      driveTimerRef.current = setInterval(sendDriveFrame, 1000 / DRIVE_SEND_HZ);
    }
  }

  function handleJoystickRelease() {
    stopDriveLoop(true); // zero immediately — deadman-friendly
  }

  function switchMode(next: RobotMode) {
    setMode(next);
    if (next === "behavior") stopDriveLoop(true);
    linkRef.current?.send({ t: "mode", mode: next });
  }

  function handleServo(id: string, deg: number) {
    setServoDeg((prev) => ({ ...prev, [id]: deg }));
    linkRef.current?.send({ t: "cmd.servo", id, deg });
  }

  async function uploadBehavior(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !linkRef.current) return;
    const h = linkRef.current.host;
    setBehaviorStatus("Uploading…");
    try {
      const text = await file.text();
      const upload = await fetch(httpUrl(h, "/api/behavior"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (!upload.ok) throw new Error(`upload failed (HTTP ${upload.status})`);
      const run = await fetch(httpUrl(h, "/api/behavior/ctl"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      if (!run.ok) throw new Error(`run failed (HTTP ${run.status})`);
      setBehaviorStatus(`Uploaded ${file.name} — behavior running.`);
      appendLog("info", `Behavior ${file.name} uploaded and started.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setBehaviorStatus(`Behavior upload failed: ${msg}`);
      appendLog("error", `Behavior upload failed: ${msg}`);
    }
  }

  const connected = linkState === "connected";
  const activeMode = telemetry?.mode ?? mode;
  const chip = STATE_CHIP[linkState];

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <nav className="mb-10 text-sm">
        <Link href="/" className="text-zinc-400 transition-colors hover:text-[#ff6b35]">
          ← Back home
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white">Drive</h1>
          <p className="mt-3 max-w-xl leading-relaxed text-zinc-300">
            Connect to your robot over Wi-Fi and take the controls.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${chip.cls}`}>
          {chip.label}
          {connected && robotInfo ? ` · ${robotInfo.name}` : ""}
        </span>
      </header>

      {/* Connect card */}
      <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="font-semibold text-white">Connect</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !connected && linkState !== "connecting") void connect();
            }}
            placeholder="botforge-xxxx.local"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-w-[16rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff6b35] focus:outline-none"
          />
          {connected || linkState === "connecting" ? (
            <button
              onClick={disconnect}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-red-500/60 hover:text-red-400"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => void connect()}
              className="rounded-lg bg-[#ff6b35] px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-[#ff8555]"
            >
              Connect
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Your robot&apos;s name is shown on its setup page (e.g. <code>botforge-a1b2.local</code>).
          On iPhone, use the IP address shown in the robot&apos;s setup page if <code>.local</code>{" "}
          doesn&apos;t resolve — iOS is picky about mDNS.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Heads-up: this page talks to the robot over plain <code>http://</code> and{" "}
          <code>ws://</code> on your local network. If you&apos;re viewing the site over HTTPS, the
          browser may block that as mixed content — for now, open the site over <code>http://</code>{" "}
          (dev) or allow insecure content for this page. A proper fix ships later.
        </p>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {connected && robotInfo && (
          <p className="mt-3 text-xs text-zinc-500">
            {robotInfo.name} · {robotInfo.robot_id} · fw {robotInfo.fw} · cfg {robotInfo.cfg_hash}
          </p>
        )}
      </section>

      {connected && (
        <>
          {/* Telemetry */}
          <section className="mt-6">
            <TelemetryBar telemetry={telemetry} />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Joystick */}
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white">Joystick</h2>
                {/* Mode toggle */}
                <div className="flex overflow-hidden rounded-lg border border-zinc-700 text-xs font-semibold">
                  {(["manual", "behavior"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className={`px-3 py-1.5 transition-colors ${
                        activeMode === m
                          ? "bg-[#ff6b35] text-zinc-950"
                          : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex justify-center">
                <Joystick
                  disabled={activeMode !== "manual"}
                  onVector={handleJoystickVector}
                  onRelease={handleJoystickRelease}
                />
              </div>
              <p className="mt-4 text-center text-xs text-zinc-500">
                {activeMode === "manual"
                  ? "Up = forward, sideways = turn. Let go to stop."
                  : "Switch to manual mode to take the wheel."}
              </p>
            </section>

            {/* Servos + LED + tone */}
            <section className="flex flex-col gap-6">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                <h2 className="font-semibold text-white">Servos</h2>
                {servos.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-500">
                    No servo modules in this robot&apos;s config.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-4">
                    {servos.map((s) => (
                      <label key={s.id} className="block">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span className="font-mono">{s.id}</span>
                          <span>{servoDeg[s.id] ?? 90}°</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          step={1}
                          value={servoDeg[s.id] ?? 90}
                          onChange={(e) => handleServo(s.id, Number(e.target.value))}
                          className="mt-1 w-full accent-[#ff6b35]"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                <h2 className="font-semibold text-white">Lights &amp; sound</h2>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {LED_SWATCHES.map((c) => (
                    <button
                      key={c.name}
                      title={c.name}
                      aria-label={`Set LEDs to ${c.name}`}
                      onClick={() =>
                        linkRef.current?.send({ t: "cmd.led", r: c.r, g: c.g, b: c.b })
                      }
                      className="h-9 w-9 rounded-full border border-zinc-700 transition-transform hover:scale-110 hover:border-zinc-400"
                      style={{ backgroundColor: c.css }}
                    />
                  ))}
                  <button
                    onClick={() => linkRef.current?.send({ t: "cmd.tone", hz: 880, ms: 200 })}
                    className="ml-auto rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-[#ff6b35]/60 hover:text-[#ff6b35]"
                  >
                    ♪ Beep
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                <h2 className="font-semibold text-white">Behavior</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Upload a behavior file (<code>.json</code>) and run it on the robot.
                </p>
                <label className="mt-3 inline-block cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-[#ff6b35]/60 hover:text-[#ff6b35]">
                  Upload behavior
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void uploadBehavior(e)}
                    className="hidden"
                  />
                </label>
                {behaviorStatus && <p className="mt-3 text-xs text-zinc-400">{behaviorStatus}</p>}
              </div>
            </section>
          </div>
        </>
      )}

      {/* Log console */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-400">Robot log</h2>
        <LogConsole rows={logs} />
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <LinkCard
          href="/flash"
          title="Flash"
          desc="New board? Install the BOTFORGE firmware from your browser first."
        />
        <LinkCard href="/" title="Home" desc="Back to the BOTFORGE landing page." />
      </section>
    </main>
  );
}
