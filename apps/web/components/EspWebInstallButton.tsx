"use client";

import { useEffect, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";

/**
 * Client-only wrapper around ESP Web Tools' `<esp-web-install-button>`
 * custom element. The library touches `window`/`customElements` at import
 * time, so it is loaded lazily inside an effect — this file must only be
 * rendered via `next/dynamic(..., { ssr: false })`.
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "esp-web-install-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        manifest?: string;
      };
    }
  }
}

export default function EspWebInstallButton({ manifest }: { manifest: string }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Registers the esp-web-install-button custom element (side-effect import).
    import("esp-web-tools")
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <p className="text-sm text-red-400">
        The flashing tool failed to load. Refresh the page and try again.
      </p>
    );
  }

  if (!ready) {
    return (
      <button
        disabled
        className="cursor-wait rounded-lg bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-400"
      >
        Loading flasher…
      </button>
    );
  }

  return (
    <esp-web-install-button manifest={manifest}>
      <button
        slot="activate"
        className="rounded-lg bg-[#ff6b35] px-6 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-[#ff8555]"
      >
        Install firmware
      </button>
      <span slot="unsupported" className="text-sm text-amber-400">
        Your browser doesn&apos;t support Web Serial. Use Chrome or Edge on a desktop computer.
      </span>
      <span slot="not-allowed" className="text-sm text-amber-400">
        Flashing isn&apos;t allowed from this page (it must be served over HTTPS or localhost).
      </span>
    </esp-web-install-button>
  );
}
