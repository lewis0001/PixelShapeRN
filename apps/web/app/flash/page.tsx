"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { LinkCard } from "../../components/LinkCard";

// ESP Web Tools touches window/customElements at import time — client only.
const EspWebInstallButton = dynamic(() => import("../../components/EspWebInstallButton"), {
  ssr: false,
  loading: () => (
    <button
      disabled
      className="cursor-wait rounded-lg bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-400"
    >
      Loading flasher…
    </button>
  ),
});

/**
 * Latest firmware manifest, attached to every tagged GitHub Release by CI.
 * NOTE: the first release lands once CI tags v0.1.0 — until then this URL
 * 404s and the page shows the "no firmware release yet" fallback below.
 */
const MANIFEST_URL =
  "https://github.com/lewis0001/PixelShapeRN/releases/latest/download/esp-web-tools-manifest.json";

type ManifestStatus = "checking" | "available" | "missing";

const STEPS: { title: string; body: string; art: string }[] = [
  {
    title: "Plug in USB-C",
    body: "Connect the ESP32-S3 board to this computer with a USB-C data cable (not a charge-only lead).",
    art: "🔌",
  },
  {
    title: "Hold BOOT, click Install",
    body: "Hold the BOOT button on the board down, then click Install firmware and pick the serial port.",
    art: "👇",
  },
  {
    title: "Release when connecting",
    body: "Let go of BOOT as soon as the dialog says Connecting. Flashing takes about a minute — keep the cable in.",
    art: "✅",
  },
];

export default function FlashPage() {
  const [manifestStatus, setManifestStatus] = useState<ManifestStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: "no-store" })
      .then((res) => {
        if (!cancelled) setManifestStatus(res.ok ? "available" : "missing");
      })
      .catch(() => {
        // Network/CORS failure — the flasher couldn't fetch it either.
        if (!cancelled) setManifestStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <nav className="mb-10 text-sm">
        <Link href="/" className="text-zinc-400 transition-colors hover:text-[#ff6b35]">
          ← Back home
        </Link>
      </nav>

      <header>
        <h1 className="text-4xl font-extrabold tracking-tight text-white">Flash your robot</h1>
        <p className="mt-3 max-w-xl leading-relaxed text-zinc-300">
          Install the BOTFORGE firmware onto an ESP32-S3 straight from the browser — no toolchain,
          no drivers, no command line.
        </p>
        <p className="mt-3 text-sm text-amber-400/90">
          Works in <span className="font-semibold">Chrome or Edge on desktop</span> only — Safari,
          Firefox and mobile browsers don&apos;t support Web Serial yet.
        </p>
      </header>

      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="text-3xl" aria-hidden>
              {step.art}
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#ff6b35]">
              Step {i + 1}
            </div>
            <h2 className="mt-1 font-semibold text-white">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        {manifestStatus === "checking" && (
          <button
            disabled
            className="cursor-wait rounded-lg bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-400"
          >
            Checking for firmware…
          </button>
        )}

        {manifestStatus === "available" && <EspWebInstallButton manifest={MANIFEST_URL} />}

        {manifestStatus === "missing" && (
          <div>
            <button
              disabled
              className="cursor-not-allowed rounded-lg bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-500"
            >
              Install firmware
            </button>
            <p className="mt-3 text-sm text-zinc-400">
              <span className="font-semibold text-amber-400">No firmware release yet.</span> The
              flasher reads the manifest from the latest GitHub Release, and the first one is
              published when CI tags <code className="text-zinc-300">v0.1.0</code>. Check back soon.
            </p>
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-500">
          After flashing, the robot boots into a <code>Botforge-XXXX</code> Wi-Fi hotspot — join it
          to name your robot and connect it to your network, then head to Drive.
        </p>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <LinkCard
          href="/drive"
          title="Drive"
          desc="Already flashed and on Wi-Fi? Take the controls from your phone or laptop."
        />
        <LinkCard href="/" title="Home" desc="Back to the BOTFORGE landing page." />
      </section>
    </main>
  );
}
