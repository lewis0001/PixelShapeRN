"use client";

/**
 * /builder — no-code Blockly builder for BSJ behaviors (Phase 3.2).
 * Blockly needs a DOM, so the whole editor loads client-side only.
 */

import dynamic from "next/dynamic";

const BuilderClient = dynamic(() => import("./BuilderClient"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950">
      <p className="animate-pulse text-sm text-zinc-500">Loading the block builder…</p>
    </main>
  ),
});

export default function BuilderPage() {
  return <BuilderClient />;
}
