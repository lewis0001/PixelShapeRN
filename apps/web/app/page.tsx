export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="max-w-2xl">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-7xl">BOTFORGE</h1>
        <p className="mt-6 text-lg leading-relaxed text-zinc-300 sm:text-xl">
          An open, modular robotics platform. Build palm-sized robots from standard modules and
          3D-printed bodies.
        </p>
        <p className="mt-10 inline-block rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-400">
          Phase 0 scaffold — catalog, builder, simulator and drive apps land in later phases.
        </p>
      </div>
    </main>
  );
}
