/**
 * /play sim canvas engine (PLAN.md Phase 3.5) — everything heavy lives
 * here: three.js rendering, OrbitControls, and @botforge/sim (Rapier WASM).
 *
 * IMPORTANT: only load this module via a dynamic `import()` from client
 * code so three/rapier/urdf-loader stay out of the initial page bundle.
 *
 * One `SimView` = one arena run: renderer + SimWorld + SimLink wired to a
 * container element. Switching arenas disposes the view and creates a new
 * one. The robot is rendered from the engine-generated URDF meshes via
 * `loadRobotUrdf` (articulated urdf-loader model, base pose + servo/wheel
 * joints synced from physics each frame); if that fails we fall back to
 * SimWorld's own visual group (per-link meshes/collider boxes).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ARENAS,
  DRIVE_TUNING,
  SimLink,
  SimWorld,
  loadRobotUrdf,
  type LedColor,
  type UrdfJoint,
} from "@botforge/sim";

export { ARENAS };
export type { LedColor };

const Z_UP = new THREE.Vector3(0, 0, 1);

export interface SimViewOptions {
  /** Arena id from `ARENAS`. */
  arena: string;
  /** Static base URL of the rover URDF + meshes. */
  assetBase?: string;
  /** RNG seed (identical seeds reproduce identical runs). */
  seed?: number;
}

export interface SimView {
  world: SimWorld;
  link: SimLink;
  /** False when the urdf-loader visuals failed and the fallback is shown. */
  usingUrdfMeshes: boolean;
  /** (Re)start the realtime clock at 1× or 4× sim speed. */
  setSpeed(speed: number): void;
  /** Put the orbit camera back to its home pose. */
  resetView(): void;
  getLeds(): readonly LedColor[];
  dispose(): void;
}

async function fetchAsset(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res;
}

/** Inverse of SimWorld.getServoDeg: 0–180° back to joint radians. */
function servoRad(deg: number, joint: UrdfJoint): number {
  const lim = joint.limit;
  return lim ? lim.lower + (deg / 180) * (lim.upper - lim.lower) : ((deg - 90) * Math.PI) / 180;
}

/**
 * Create the sim view inside `container` (fills it; observes resizes).
 * Physics clock starts stopped — call `setSpeed()` to run.
 */
export async function createSimView(
  container: HTMLElement,
  opts: SimViewOptions
): Promise<SimView> {
  const assetBase = opts.assetBase ?? "/sim-assets/rover-v1";
  const urdf = await fetchAsset(`${assetBase}/robot.urdf`).then((r) => r.text());

  const world = await SimWorld.create({
    urdf,
    resolveMesh: (path) => fetchAsset(`${assetBase}/${path}`).then((r) => r.arrayBuffer()),
    arena: opts.arena,
    seed: opts.seed ?? 1,
  });
  const link = new SimLink(world, { name: "Sim rover" });
  await link.connect();

  /* ---------------- three.js scene ---------------- */

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c0f);
  scene.add(world.scene!);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30302c, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1.2, -1.6, 2.4);
  scene.add(sun);

  const span = Math.max(world.arena.sizeM.x, world.arena.sizeM.y);
  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
    0.01,
    span * 20
  );
  camera.up.copy(Z_UP); // URDF/sim world is z-up

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.maxDistance = span * 3;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the floor

  const homeTarget = new THREE.Vector3(0, 0, 0.02);
  function resetView(): void {
    camera.position.set(span * 0.42, -span * 0.5, span * 0.42);
    controls.target.copy(homeTarget);
    controls.update();
  }
  resetView();

  /* -------- robot visuals: urdf-loader meshes, world group fallback ---- */

  // SimWorld's own visual group (URDF meshes / collider boxes) is the
  // always-available fallback; it articulates itself via syncVisuals().
  const fallbackRobot = world.scene!.getObjectByName("robot");

  let urdfRobot: Awaited<ReturnType<typeof loadRobotUrdf>> | null = null;
  let syncUrdfRobot: (() => void) | null = null;
  try {
    urdfRobot = await loadRobotUrdf(urdf, { meshPath: `${assetBase}/` });

    // Pretty materials for the loader's plain output.
    urdfRobot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.7 });
      }
    });

    // Wheel joints, left/right by URDF y-origin (same rule as SimWorld).
    const continuous = world.model.joints.filter((j) => j.type === "continuous");
    const byY = [...continuous].sort((a, b) => b.origin.xyz[1] - a.origin.xyz[1]);
    const wheelLeft = byY.length >= 2 ? byY[0].name : null;
    const wheelRight = byY.length >= 2 ? byY[byY.length - 1].name : null;
    const servoJoints = world.model.joints.filter((j) => j.type === "revolute");
    const wheelAngle: Record<string, number> = {};
    let lastSimMs = world.timeMs;

    if (fallbackRobot) fallbackRobot.visible = false;
    scene.add(urdfRobot);

    syncUrdfRobot = () => {
      const robot = urdfRobot!;
      const pose = world.getRobotPose();
      robot.position.set(pose.x, pose.y, pose.z);
      robot.quaternion.setFromAxisAngle(Z_UP, pose.yaw);
      for (const j of servoJoints) {
        const deg = world.getServoDeg(j.name);
        if (deg !== null) robot.setJointValue(j.name, servoRad(deg, j));
      }
      // Cosmetic wheel spin from commanded surface speed, in sim time.
      const dtS = (world.timeMs - lastSimMs) / 1000;
      lastSimMs = world.timeMs;
      const { l, r } = world.getDrive();
      const radius = world.driveInfo.wheelRadiusM;
      for (const [name, power] of [
        [wheelLeft, l],
        [wheelRight, r],
      ] as const) {
        if (!name) continue;
        wheelAngle[name] =
          (wheelAngle[name] ?? 0) + (((power / 100) * DRIVE_TUNING.vMaxMps) / radius) * dtS;
        robot.setJointValue(name, wheelAngle[name]);
      }
    };
  } catch (err) {
    // Keep the fallback group visible — physics and behaviors are unaffected.
    console.warn("[/play] URDF mesh visuals unavailable, using collider visuals:", err);
  }

  /* ---------------- render loop + resize ---------------- */

  renderer.setAnimationLoop(() => {
    world.syncVisuals();
    syncUrdfRobot?.();
    controls.update();
    renderer.render(scene, camera);
  });

  const ro = new ResizeObserver(() => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  /* ---------------- handle ---------------- */

  let disposed = false;
  return {
    world,
    link,
    usingUrdfMeshes: urdfRobot !== null,
    setSpeed(speed: number) {
      link.startClock(speed);
    },
    resetView,
    getLeds() {
      return world.getLeds();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      link.disconnect(); // stops the clock too
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
