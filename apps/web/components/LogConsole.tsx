"use client";

import { useEffect, useRef } from "react";
import type { LogLevel } from "../lib/robotlink/types";

export interface LogRow {
  key: number;
  time: string;
  level: LogLevel;
  msg: string;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-zinc-500",
  info: "text-zinc-300",
  warn: "text-amber-400",
  error: "text-red-400",
};

/** Scrolling, level-colored console for robot `log` messages. */
export function LogConsole({ rows }: { rows: LogRow[] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <div
      ref={boxRef}
      className="h-48 overflow-y-auto rounded-xl border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-5"
    >
      {rows.length === 0 ? (
        <span className="text-zinc-600">No log messages yet.</span>
      ) : (
        rows.map((row) => (
          <div key={row.key} className={LEVEL_CLASS[row.level] ?? "text-zinc-300"}>
            <span className="text-zinc-600">{row.time} </span>
            <span className="uppercase">[{row.level}]</span> {row.msg}
          </div>
        ))
      )}
    </div>
  );
}
