"use client";

/**
 * /play — sim + block editor split view (Phase 3.5). Blockly, three.js and
 * Rapier all need a browser, so the whole page loads client-side only; the
 * server prerenders just this shell.
 */

import dynamic from "next/dynamic";

const PlayClient = dynamic(() => import("./PlayClient"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950">
      <p className="animate-pulse text-sm text-zinc-500">Loading the simulator…</p>
    </main>
  ),
});

export default function PlayPage() {
  return <PlayClient />;
}
