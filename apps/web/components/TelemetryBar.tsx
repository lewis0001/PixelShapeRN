"use client";

import type { Telemetry } from "../lib/robotlink/types";
import { batteryPct } from "../lib/robotlink/drive";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex min-w-[5.5rem] flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-[#ff6b35]" : "text-zinc-100"}`}>
        {value}
      </span>
    </div>
  );
}

/** Live telemetry strip: battery, RSSI, mode, behavior state + sensor readouts. */
export function TelemetryBar({ telemetry }: { telemetry: Telemetry | null }) {
  if (!telemetry) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500">
        Waiting for telemetry…
      </div>
    );
  }

  const pct = batteryPct(telemetry.batt_mv);
  const battTone = pct <= 15 ? "text-red-400" : pct <= 35 ? "text-amber-400" : "text-emerald-400";
  const range = telemetry.sensors?.range;
  const line = telemetry.sensors?.line;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex min-w-[5.5rem] flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Battery</span>
        <span className={`text-sm font-semibold ${battTone}`}>
          {pct}%{" "}
          <span className="font-normal text-zinc-500">
            ({(telemetry.batt_mv / 1000).toFixed(2)} V)
          </span>
        </span>
      </div>
      <Stat label="RSSI" value={`${telemetry.rssi} dBm`} />
      <Stat label="Mode" value={telemetry.mode} accent />
      <Stat label="Behavior" value={telemetry.behavior_running ? "running" : "stopped"} />
      {range && typeof range.mm === "number" && (
        <Stat label="Range" value={`${Math.round(range.mm)} mm`} />
      )}
      {line && typeof line.l === "number" && (
        <Stat label="Line L/R" value={`${line.l} / ${line.r}`} />
      )}
    </div>
  );
}
