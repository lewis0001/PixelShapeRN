/**
 * Browser-side URDF visual loader (PLAN.md Phase 3.3): parses a URDF
 * string with `urdf-loader` onto a three.js object for the /play canvas.
 *
 * This is the *visual* twin of SimWorld's own dependency-free URDF parser:
 * physics + sensors never need it (they run headless), but the /play page
 * gets articulated `URDFRobot` meshes with `setJointValue()` support.
 * `urdf-loader` requires a DOM (`DOMParser`), so this module guards and
 * lazy-imports it — importing @botforge/sim in Node stays safe.
 */

import * as THREE from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses.js";

export interface LoadRobotUrdfOptions {
  /**
   * Base path/URL the URDF's relative mesh filenames resolve against,
   * e.g. `/artifacts/rover-v1/urdf/`.
   */
  meshPath?: string;
}

/**
 * Parse a URDF document into a `URDFRobot` (three.js Object3D subclass),
 * waiting for all referenced meshes to finish loading. Browser only.
 */
export async function loadRobotUrdf(
  urdf: string,
  opts: LoadRobotUrdfOptions = {}
): Promise<URDFRobot> {
  if (typeof DOMParser === "undefined") {
    throw new Error(
      "loadRobotUrdf needs a browser DOM (urdf-loader uses DOMParser). " +
        "Headless callers should use SimWorld (it parses URDF itself)."
    );
  }
  const { default: URDFLoader } = await import("urdf-loader");
  const manager = new THREE.LoadingManager();
  const loader = new URDFLoader(manager);
  if (opts.meshPath) loader.workingPath = opts.meshPath;

  let meshesStarted = false;
  manager.onStart = () => {
    meshesStarted = true;
  };
  const done = new Promise<void>((resolve, reject) => {
    manager.onLoad = () => resolve();
    manager.onError = (url) => reject(new Error(`loadRobotUrdf: failed to load mesh ${url}`));
  });
  const robot = loader.parse(urdf);
  if (meshesStarted) await done;
  return robot;
}
