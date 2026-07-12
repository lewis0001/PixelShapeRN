import Link from "next/link";

/** Dark card linking between the robot pages (/flash ↔ /drive, home). */
export function LinkCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-[#ff6b35]/60"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="text-[#ff6b35] transition-transform group-hover:translate-x-1">→</span>
      </div>
      <p className="mt-1 text-sm text-zinc-400">{desc}</p>
    </Link>
  );
}
