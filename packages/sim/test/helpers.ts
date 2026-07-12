/** Shared fixtures for the sim tests: rover URDF + meshes + behaviors. */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SimWorld, type SimWorldOptions } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Copied from dist/rover-v1/urdf (regenerate: `botforge build robots/rover-v1 --only cad,urdf`). */
export const FIXTURE_DIR = path.join(here, "fixtures", "rover-v1");

const REPO_ROOT = path.resolve(here, "..", "..", "..");

export function roverUrdf(): string {
  return readFileSync(path.join(FIXTURE_DIR, "robot.urdf"), "utf8");
}

let meshCache: Record<string, Uint8Array> | null = null;

export function roverMeshes(): Record<string, Uint8Array> {
  if (!meshCache) {
    meshCache = {};
    const dir = path.join(FIXTURE_DIR, "meshes");
    for (const f of readdirSync(dir)) {
      meshCache[`meshes/${f}`] = readFileSync(path.join(dir, f));
    }
  }
  return meshCache;
}

export async function createRoverWorld(opts: Partial<SimWorldOptions> = {}): Promise<SimWorld> {
  return SimWorld.create({
    urdf: roverUrdf(),
    meshes: roverMeshes(),
    collidersOnly: true,
    ...opts,
  });
}

/** Load a shipped rover behavior JSON (robots/rover-v1/behaviors). */
export function roverBehavior(name: string): string {
  return readFileSync(
    path.join(REPO_ROOT, "robots", "rover-v1", "behaviors", `${name}.json`),
    "utf8"
  );
}
