"use client";

/**
 * Blockly no-code builder for BSJ v1 (PLAN.md §5.3, Phase 3.2).
 *
 * Client-only: this module imports Blockly, so it must be loaded with
 * `next/dynamic` + `ssr: false` (see ./page.tsx).
 */

import * as Blockly from "blockly/core";
import * as enMsg from "blockly/msg/en";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { bsjProgramSchema, parseBsj, type BsjProgram } from "@botforge/behavior-ts";
import { BSJ_TOOLBOX, registerBsjBlocks } from "../../lib/blockly/blocks";
import {
  bsjToWorkspace,
  formatKb,
  measureBsj,
  workspaceToBsj,
  type BsjMeter,
  type WorkspaceState,
} from "../../lib/blockly/codec";

const SAVES_KEY = "botforge.builder.saves";
const AUTOSAVE_KEY = "botforge.builder.autosave";
const DEFAULT_NAME = "my_behavior";

const EXAMPLES = [
  { file: "avoid_obstacles", label: "Avoid obstacles" },
  { file: "line_follow", label: "Line follow" },
  { file: "pet_mode", label: "Pet mode" },
] as const;

interface SaveEntry {
  name: string;
  workspace: WorkspaceState;
  savedAt: string;
}

interface Notice {
  kind: "error" | "success";
  title: string;
  lines?: string[];
}

type MenuName = "examples" | "load";

const EMPTY_METER = measureBsj({ bsj: 1, vars: [], handlers: [] });

/* ------------------------------------------------------------------ */
/* Blockly setup helpers                                               */
/* ------------------------------------------------------------------ */

let themeSingleton: Blockly.Theme | null = null;

function getBotforgeTheme(): Blockly.Theme {
  if (!themeSingleton) {
    themeSingleton = Blockly.Theme.defineTheme("botforgeDark", {
      name: "botforgeDark",
      base: Blockly.Themes.Zelos,
      startHats: true,
      componentStyles: {
        workspaceBackgroundColour: "#0c0c0f",
        toolboxBackgroundColour: "#111114",
        toolboxForegroundColour: "#d4d4d8",
        flyoutBackgroundColour: "#18181b",
        flyoutForegroundColour: "#d4d4d8",
        flyoutOpacity: 0.97,
        scrollbarColour: "#3f3f46",
        scrollbarOpacity: 0.5,
        insertionMarkerColour: "#ff6b35",
        insertionMarkerOpacity: 0.5,
        cursorColour: "#ff6b35",
      },
      fontStyle: { family: "ui-sans-serif, system-ui, sans-serif", size: 10.5 },
    });
  }
  return themeSingleton;
}

function readSaves(): Record<string, SaveEntry> {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SaveEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSaves(saves: Record<string, SaveEntry>): void {
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

function fileSafeName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned || "behavior";
}

/** All §5.3 problems with a program, as human-readable lines ([] = valid). */
function validationIssues(program: BsjProgram): string[] {
  if (program.handlers.length === 0) {
    return ["Add an event block (Events category) — a program needs at least one handler."];
  }
  try {
    parseBsj(program);
    return [];
  } catch (err) {
    const lines: string[] = [];
    const res = bsjProgramSchema.safeParse(program);
    if (!res.success) {
      for (const issue of res.error.issues.slice(0, 8)) {
        const path = issue.path.length > 0 ? issue.path.join(".") : "program";
        lines.push(`${path} — ${issue.message}`);
      }
      const extra = res.error.issues.length - 8;
      if (extra > 0) lines.push(`…and ${extra} more`);
    }
    if (lines.length === 0) lines.push(err instanceof Error ? err.message : String(err));
    return lines;
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function BuilderClient() {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const nameRef = useRef(DEFAULT_NAME);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(DEFAULT_NAME);
  const [meter, setMeter] = useState<BsjMeter>(EMPTY_METER);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [savedNames, setSavedNames] = useState<string[]>([]);

  /** Serialize the live workspace into a BSJ program (meter + export). */
  const currentProgram = useCallback((): BsjProgram | null => {
    const ws = workspaceRef.current;
    if (!ws) return null;
    try {
      const state = Blockly.serialization.workspaces.save(ws) as WorkspaceState;
      const trimmed = nameRef.current.trim();
      return workspaceToBsj(state, trimmed === "" ? undefined : trimmed);
    } catch {
      return null; // mid-edit weirdness — keep the last meter
    }
  }, []);

  const refreshMeter = useCallback(() => {
    const program = currentProgram();
    if (program) setMeter(measureBsj(program));
  }, [currentProgram]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const ws = workspaceRef.current;
      if (!ws) return;
      try {
        const entry: SaveEntry = {
          name: nameRef.current,
          workspace: Blockly.serialization.workspaces.save(ws) as WorkspaceState,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(entry));
      } catch {
        /* storage full/blocked — autosave is best-effort */
      }
    }, 400);
  }, []);

  /* ---------------- Blockly injection (once) ---------------- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    Blockly.setLocale(enMsg as unknown as Record<string, string>);
    registerBsjBlocks(Blockly);

    const ws = Blockly.inject(host, {
      toolbox: BSJ_TOOLBOX as unknown as Blockly.utils.toolbox.ToolboxDefinition,
      renderer: "zelos",
      theme: getBotforgeTheme(),
      grid: { spacing: 24, length: 2, colour: "#232329", snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.8, minScale: 0.35, maxScale: 1.75 },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
    });
    workspaceRef.current = ws;

    // Restore the last session, if any.
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const entry = JSON.parse(raw) as SaveEntry;
        if (entry.workspace) {
          Blockly.serialization.workspaces.load(entry.workspace as never, ws);
        }
        if (entry.name) {
          nameRef.current = entry.name;
          setName(entry.name);
        }
      }
    } catch {
      /* corrupt autosave — start fresh */
    }

    setSavedNames(Object.keys(readSaves()).sort());
    refreshMeter();

    const onChange = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      refreshMeter();
      scheduleAutosave();
    };
    ws.addChangeListener(onChange);

    const onResize = () => Blockly.svgResize(ws);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      ws.dispose();
      workspaceRef.current = null;
    };
  }, [refreshMeter, scheduleAutosave]);

  // Auto-dismiss success toasts.
  useEffect(() => {
    if (notice?.kind !== "success") return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /* ---------------- actions ---------------- */

  function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
    nameRef.current = e.target.value;
    setName(e.target.value);
    refreshMeter();
    scheduleAutosave();
  }

  function loadProgram(program: BsjProgram, fallbackName?: string) {
    const ws = workspaceRef.current;
    if (!ws) return;
    ws.clear();
    Blockly.serialization.workspaces.load(bsjToWorkspace(program) as never, ws);
    const next = program.name ?? fallbackName ?? DEFAULT_NAME;
    nameRef.current = next;
    setName(next);
    refreshMeter();
    scheduleAutosave();
  }

  function handleNew() {
    const ws = workspaceRef.current;
    if (!ws) return;
    if (
      ws.getAllBlocks(false).length > 0 &&
      !window.confirm("Clear the canvas? Blocks you haven't saved will be lost.")
    ) {
      return;
    }
    ws.clear();
    nameRef.current = DEFAULT_NAME;
    setName(DEFAULT_NAME);
    setNotice(null);
    refreshMeter();
    scheduleAutosave();
  }

  async function loadExample(file: string, label: string) {
    setOpenMenu(null);
    try {
      const res = await fetch(`/examples/${file}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const program = parseBsj(await res.text());
      loadProgram(program, file);
      setNotice({ kind: "success", title: `Loaded example "${label}".` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setNotice({ kind: "error", title: `Couldn't load example "${label}".`, lines: [msg] });
    }
  }

  function handleSave() {
    const ws = workspaceRef.current;
    if (!ws) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice({ kind: "error", title: "Name your program before saving." });
      return;
    }
    const saves = readSaves();
    saves[trimmed] = {
      name: trimmed,
      workspace: Blockly.serialization.workspaces.save(ws) as WorkspaceState,
      savedAt: new Date().toISOString(),
    };
    try {
      writeSaves(saves);
    } catch {
      setNotice({ kind: "error", title: "Couldn't save — browser storage is full or blocked." });
      return;
    }
    setSavedNames(Object.keys(saves).sort());
    setNotice({ kind: "success", title: `Saved "${trimmed}" in this browser.` });
  }

  function handleLoadSave(saveName: string) {
    setOpenMenu(null);
    const ws = workspaceRef.current;
    const entry = readSaves()[saveName];
    if (!ws || !entry) return;
    try {
      ws.clear();
      Blockly.serialization.workspaces.load(entry.workspace as never, ws);
      nameRef.current = entry.name;
      setName(entry.name);
      refreshMeter();
      scheduleAutosave();
      setNotice({ kind: "success", title: `Loaded "${saveName}".` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setNotice({ kind: "error", title: `Couldn't load "${saveName}".`, lines: [msg] });
    }
  }

  function handleDeleteSave(saveName: string) {
    const saves = readSaves();
    delete saves[saveName];
    writeSaves(saves);
    setSavedNames(Object.keys(saves).sort());
  }

  function handleDownload() {
    const program = currentProgram();
    if (!program) return;
    const issues = validationIssues(program);
    if (issues.length > 0) {
      setNotice({ kind: "error", title: "Not valid BSJ yet — fix these first:", lines: issues });
      return;
    }
    const filename = `${fileSafeName(name)}.json`;
    const blob = new Blob([JSON.stringify(program, null, 2) + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "success", title: `Downloaded ${filename}.` });
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const program = parseBsj(await file.text());
      loadProgram(program, file.name.replace(/\.json$/i, ""));
      setNotice({ kind: "success", title: `Loaded ${file.name}.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setNotice({
        kind: "error",
        title: `${file.name} isn't a valid behavior file.`,
        lines: [msg],
      });
    }
  }

  /* ---------------- render ---------------- */

  const meterCls = meter.over
    ? "border-red-500/60 bg-red-500/10 text-red-400"
    : "border-zinc-700 bg-zinc-900 text-zinc-400";

  const btn =
    "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold " +
    "text-zinc-200 transition-colors hover:border-[#ff6b35]/60 hover:text-[#ff6b35]";

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-[#ff6b35]">
            ←
          </Link>
          <h1 className="text-lg font-extrabold tracking-tight text-white">Builder</h1>

          <input
            type="text"
            value={name}
            onChange={handleNameChange}
            placeholder="program name"
            spellCheck={false}
            maxLength={63}
            aria-label="Program name"
            className="w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#ff6b35] focus:outline-none"
          />

          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold ${meterCls}`}
            title="§5.3 limits: 128 statements, 16 KB per behavior file"
          >
            {meter.statements}/{meter.maxStatements} blocks · {formatKb(meter.bytes)}/16 KB
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={handleNew} className={btn}>
              New
            </button>

            <div className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === "examples" ? null : "examples")}
                className={btn}
                aria-expanded={openMenu === "examples"}
              >
                Examples ▾
              </button>
              {openMenu === "examples" && (
                <div className="absolute right-0 z-40 mt-2 w-48 rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.file}
                      onClick={() => void loadExample(ex.file, ex.label)}
                      className="block w-full px-4 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-[#ff6b35]"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={handleSave} className={btn}>
              Save
            </button>

            <div className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === "load" ? null : "load")}
                className={btn}
                aria-expanded={openMenu === "load"}
              >
                Load ▾
              </button>
              {openMenu === "load" && (
                <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                  {savedNames.length === 0 ? (
                    <p className="px-4 py-2 text-sm text-zinc-500">
                      Nothing saved in this browser yet.
                    </p>
                  ) : (
                    savedNames.map((n) => (
                      <div key={n} className="flex items-center justify-between gap-2 px-2 py-1">
                        <button
                          onClick={() => handleLoadSave(n)}
                          className="flex-1 truncate rounded-lg px-2 py-1 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-[#ff6b35]"
                        >
                          {n}
                        </button>
                        <button
                          onClick={() => handleDeleteSave(n)}
                          aria-label={`Delete saved program ${n}`}
                          title="Delete"
                          className="rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-red-400"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <button onClick={() => fileInputRef.current?.click()} className={btn}>
              Upload .json
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleUpload(e)}
              className="hidden"
            />

            <button
              onClick={handleDownload}
              className="rounded-lg bg-[#ff6b35] px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-[#ff8555]"
            >
              Download .json
            </button>

            <button
              disabled
              title="Coming soon — run it in the simulator at /play, then send it to your robot from there."
              className="cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-600"
            >
              Send to Robot
            </button>
            <Link
              href="/play"
              className="text-xs text-zinc-500 transition-colors hover:text-[#ff6b35]"
              title="The simulator wires up Send to Robot"
            >
              via /play →
            </Link>
          </div>
        </div>
      </header>

      {/* Click-away backdrop for the menus */}
      {openMenu && (
        <button
          aria-label="Close menu"
          onClick={() => setOpenMenu(null)}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`fixed bottom-4 right-4 z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border p-4 shadow-2xl ${
            notice.kind === "error"
              ? "border-red-500/50 bg-zinc-900"
              : "border-emerald-500/50 bg-zinc-900"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p
              className={`text-sm font-semibold ${
                notice.kind === "error" ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {notice.title}
            </p>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="text-zinc-500 transition-colors hover:text-zinc-200"
            >
              ×
            </button>
          </div>
          {notice.lines && notice.lines.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-zinc-300">
              {notice.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
