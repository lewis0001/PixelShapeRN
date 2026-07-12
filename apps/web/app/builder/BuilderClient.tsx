"use client";

/**
 * Blockly no-code builder for BSJ v1 (PLAN.md §5.3, Phase 3.2).
 *
 * The editor itself lives in the shared <BlockEditor> component (also
 * composed by /play); this page adds the Builder framing around it.
 *
 * Client-only: BlockEditor imports Blockly, so this module must be loaded
 * with `next/dynamic` + `ssr: false` (see ./page.tsx).
 */

import Link from "next/link";
import { BlockEditor } from "../../components/BlockEditor";

export default function BuilderClient() {
  return (
    <BlockEditor
      className="flex h-screen flex-col bg-zinc-950"
      heading={
        <>
          <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-[#ff6b35]">
            ←
          </Link>
          <h1 className="text-lg font-extrabold tracking-tight text-white">Builder</h1>
        </>
      }
      trailing={
        <>
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
        </>
      }
    />
  );
}
