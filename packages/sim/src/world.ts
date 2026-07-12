/**
 * SimWorld — the headless-capable physics world of the BOTFORGE simulator
 * (PLAN.md Phase 3.3).
 *
 * - Rapier world stepped at a fixed 1/120 s (`SIM_FIXED_STEP_HZ`).
 * - Seedable mulberry32 RNG drives ALL randomness (sensor noise, arena
 *   block placement, BSJ `rand`): a seed fully determines a run.
 * - The robot is loaded from a URDF string (our own dependency-free parser,
 *   see urdf.ts) + a mesh map; colliders are per-link cuboids from the
 *   collision meshes' bounding boxes ("bbox approximations"). Pass
 *   `collidersOnly: true` to skip building the three.js visual scene
 *   (recommended for Node tests; physics + sensors never need WebGL/DOM).
 *
 * Drive model: differential drive on a single planar rigid body. Wheel
 * power −100..100 maps to a target wheel surface speed (v_max = 0.45 m/s at
 * 100, radius read from the URDF continuous joints), giving a target
 * forward velocity and yaw rate. Each substep the body's velocity moves
 * toward the target under acceleration caps (the torque-cap equivalent:
 * a = 2·τ_max/(r·m)) and a strong lateral-friction decay kills sideways
 * slip. Contacts with arena colliders are resolved by Rapier, so walls
 * stop and deflect the robot realistically. Servo (revolute) joints are
 * position motors: the joint angle slews toward the target at a fixed rate
 * and feeds both the sensor-frame kinematics and the visual pose.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ARENAS, type ArenaDef, type StaticBox } from "./arenas.js";
import { makeGaussian, mulberry32, randInt, type Rng } from "./rng.js";
import { parseUrdf, type UrdfJoint, type UrdfModel, type UrdfPose } from "./urdf.js";
import { VirtualSensors, type LineSensorConfig, type RangeSensorConfig } from "./sensors.js";

/** Fixed physics timestep rate for the simulator, in Hz. */
export const SIM_FIXED_STEP_HZ = 120;

const STEP_MS = 1000 / SIM_FIXED_STEP_HZ;

/**
 * Differential-drive tuning constants. These are sim-side physical
 * parameters (NOT behavior semantics) — the Phase-3 gates are tuned by
 * adjusting these within physically plausible ranges for the real rover.
 */
export const DRIVE_TUNING = {
  /** Wheel surface speed at power 100 (m/s). */
  vMaxMps: 0.45,
  /** Max forward acceleration — torque cap equivalent (m/s²). */
  maxLinAccel: 3.5,
  /** Max yaw acceleration (rad/s²). */
  maxYawAccel: 60,
  /** Lateral tire grip: how fast sideways slip is damped (m/s²). */
  latGripAccel: 10,
  /** Servo slew rate (rad/s) ≈ 0.15 s / 60°. */
  servoRateRad: (400 * Math.PI) / 180,
} as const;

/** Collision-group bits (Rapier interaction groups). */
const GROUP_ROBOT = 0x0001;
const GROUP_OBSTACLE = 0x0002;
const ROBOT_GROUPS = (GROUP_ROBOT << 16) | GROUP_OBSTACLE;
const OBSTACLE_GROUPS = (GROUP_OBSTACLE << 16) | GROUP_ROBOT;
const RAY_GROUPS = (0xffff << 16) | GROUP_OBSTACLE;

/** Contact-streak bookkeeping: gaps shorter than this don't reset a streak. */
const CONTACT_GAP_TOLERANCE_MS = 150;

export interface SimWorldOptions {
  /** URDF document content (dist/<robot>/urdf/robot.urdf). */
  urdf: string;
  /** Mesh data keyed by the filename used in the URDF (or its basename). */
  meshes?: Record<string, ArrayBuffer | Uint8Array>;
  /** Async mesh resolver (browser fetch); used when `meshes` misses. */
  resolveMesh?: (path: string) => Promise<ArrayBuffer | Uint8Array>;
  /** Arena id from `ARENAS` or a custom `ArenaDef`. Default: open_floor. */
  arena?: string | ArenaDef;
  /** RNG seed; identical seeds reproduce identical runs. Default 1. */
  seed?: number;
  /** Skip the three.js visual scene (physics/sensors only). Default false. */
  collidersOnly?: boolean;
  rangeSensor?: Partial<RangeSensorConfig>;
  lineSensor?: Partial<LineSensorConfig>;
  /** Number of addressable LED pixels (rover: 2 "eyes"). */
  ledCount?: number;
}

export interface RobotPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface LedColor {
  r: number;
  g: number;
  b: number;
}

export interface ToneState {
  hz: number;
  endMs: number;
}

export type StepListener = (timeMs: number, stepMs: number) => void;

interface WheelInfo {
  enabled: boolean;
  radiusM: number;
  trackM: number;
  baseZM: number;
  leftJoint?: string;
  rightJoint?: string;
}

interface ServoState {
  angleRad: number;
  targetRad: number;
  joint: UrdfJoint;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(cur: number, target: number, maxDelta: number): number {
  return cur + clamp(target - cur, -maxDelta, maxDelta);
}

function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function poseMatrix(pose: UrdfPose): THREE.Matrix4 {
  // URDF rpy = fixed-axis roll/pitch/yaw ⇒ R = Rz(y)·Ry(p)·Rx(r) = Euler "ZYX".
  const e = new THREE.Euler(pose.rpy[0], pose.rpy[1], pose.rpy[2], "ZYX");
  const m = new THREE.Matrix4().makeRotationFromEuler(e);
  m.setPosition(pose.xyz[0], pose.xyz[1], pose.xyz[2]);
  return m;
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data;
}

export class SimWorld {
  readonly model: UrdfModel;
  readonly arena: ArenaDef;
  readonly sensors: VirtualSensors;
  /** Visual scene root (z-up). Undefined when `collidersOnly` is set. */
  readonly scene?: THREE.Group;
  /** All static boxes actually placed (walls + seeded scatter blocks). */
  readonly obstacles: StaticBox[] = [];

  private readonly seed: number;
  private rapier!: RAPIER.World;
  private body!: RAPIER.RigidBody;
  private robotColliders: RAPIER.Collider[] = [];
  private readonly geometries: Map<string, THREE.BufferGeometry>;
  private readonly wheels: WheelInfo;
  private readonly servos = new Map<string, ServoState>();
  /** Current angle of every non-fixed joint (servos + cosmetic wheel spin). */
  private readonly jointAngles = new Map<string, number>();
  private readonly staticRelCache = new Map<string, THREE.Matrix4>();
  private readonly linkObjects = new Map<string, THREE.Object3D>();
  private robotGroup?: THREE.Group;

  private rng: Rng;
  private gauss: () => number;

  private stepCount = 0;
  private acc = 0;
  private driveL = 0;
  private driveR = 0;
  /** Cumulative ms with nonzero wheel power (battery model input). */
  activeDriveMs = 0;

  private leds: LedColor[];
  private tone: ToneState | null = null;

  private inContactNow = false;
  private contactStreakMs = 0;
  private contactGapMs = Infinity;
  private maxContactStreakMsInternal = 0;
  /** Broad-phase staleness: colliders added/moved since the last step. */
  private queriesDirty = true;

  private stepListeners = new Set<StepListener>();

  private constructor(
    model: UrdfModel,
    geometries: Map<string, THREE.BufferGeometry>,
    opts: SimWorldOptions
  ) {
    this.model = model;
    this.geometries = geometries;
    this.seed = opts.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.gauss = makeGaussian(this.rng);
    this.leds = Array.from({ length: opts.ledCount ?? 2 }, () => ({ r: 0, g: 0, b: 0 }));

    const arena =
      typeof opts.arena === "string" || opts.arena === undefined
        ? ARENAS[opts.arena ?? "open_floor"]
        : opts.arena;
    if (!arena) throw new Error(`unknown arena: ${String(opts.arena)}`);
    this.arena = arena;

    this.wheels = this.deriveWheels();
    for (const j of model.joints) {
      if (j.type === "continuous") this.jointAngles.set(j.name, 0);
      if (j.type === "revolute") {
        this.jointAngles.set(j.name, 0);
        this.servos.set(j.name, { angleRad: 0, targetRad: 0, joint: j });
      }
    }

    this.buildPhysics();
    if (!opts.collidersOnly) {
      this.scene = new THREE.Group();
      this.scene.name = "simworld";
      this.buildVisuals();
      this.syncVisuals();
    }
    this.sensors = new VirtualSensors(this, opts.rangeSensor, opts.lineSensor);
  }

  /** Create a world (initializes the Rapier WASM module on first use). */
  static async create(opts: SimWorldOptions): Promise<SimWorld> {
    await RAPIER.init();
    const model = parseUrdf(opts.urdf);
    const geometries = await SimWorld.loadGeometries(model, opts);
    return new SimWorld(model, geometries, opts);
  }

  private static async loadGeometries(
    model: UrdfModel,
    opts: SimWorldOptions
  ): Promise<Map<string, THREE.BufferGeometry>> {
    const filenames = new Set<string>();
    for (const link of model.links) {
      for (const shape of [...link.collisions, ...(opts.collidersOnly ? [] : link.visuals)]) {
        if (shape.geometry.mesh) filenames.add(shape.geometry.mesh.filename);
      }
    }
    const loader = new STLLoader();
    const out = new Map<string, THREE.BufferGeometry>();
    for (const filename of filenames) {
      const base = filename.split("/").pop() ?? filename;
      let data = opts.meshes?.[filename] ?? opts.meshes?.[base];
      if (!data && opts.resolveMesh) data = await opts.resolveMesh(filename);
      if (!data) {
        throw new Error(
          `SimWorld: no mesh data for "${filename}" — pass it in options.meshes or provide resolveMesh`
        );
      }
      const geom = loader.parse(toArrayBuffer(data));
      geom.computeBoundingBox();
      out.set(filename, geom);
    }
    return out;
  }

  /* ------------------------------------------------------------- build */

  private deriveWheels(): WheelInfo {
    const cont = this.model.joints.filter((j) => j.type === "continuous");
    if (cont.length < 2) {
      return { enabled: false, radiusM: 0.021, trackM: 0.082, baseZM: 0.02 };
    }
    const sorted = [...cont].sort((a, b) => b.origin.xyz[1] - a.origin.xyz[1]);
    const left = sorted[0];
    const right = sorted[sorted.length - 1];
    const radiusM = this.wheelRadiusFor(left.child) ?? 0.021;
    const trackM = Math.hypot(
      left.origin.xyz[0] - right.origin.xyz[0],
      left.origin.xyz[1] - right.origin.xyz[1]
    );
    const baseZM = Math.max(0, radiusM - left.origin.xyz[2]);
    return { enabled: true, radiusM, trackM, baseZM, leftJoint: left.name, rightJoint: right.name };
  }

  private wheelRadiusFor(linkName: string): number | null {
    const link = this.model.linkByName.get(linkName);
    const shape = link?.collisions[0] ?? link?.visuals[0];
    if (!shape) return null;
    if (shape.geometry.box) {
      return Math.max(...shape.geometry.box) / 2;
    }
    const mesh = shape.geometry.mesh;
    if (!mesh) return null;
    const geom = this.geometries.get(mesh.filename);
    const bb = geom?.boundingBox;
    if (!bb) return null;
    const size = new THREE.Vector3();
    bb.getSize(size);
    return Math.max(size.x * mesh.scale[0], size.y * mesh.scale[1], size.z * mesh.scale[2]) / 2;
  }

  private buildPhysics(): void {
    // Planar diff-drive model: no gravity, base locked to the floor plane
    // (z translation and x/y rotation disabled). Contacts still resolve in
    // the plane, which is all a floor-bound rover needs.
    this.rapier = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.rapier.timestep = 1 / SIM_FIXED_STEP_HZ;

    const spawn = this.arena.spawn;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spawn.yaw);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, this.wheels.baseZM)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true);
    this.body = this.rapier.createRigidBody(desc);

    // Per-link cuboid colliders from collision bbox approximations.
    for (const link of this.model.links) {
      const rel = this.linkRelMatrix(link.name);
      if (!rel) continue;
      const perShapeMass = link.mass / Math.max(1, link.collisions.length);
      for (const shape of link.collisions) {
        let half: THREE.Vector3;
        let center: THREE.Vector3;
        if (shape.geometry.box) {
          half = new THREE.Vector3(...shape.geometry.box).multiplyScalar(0.5);
          center = new THREE.Vector3(0, 0, 0);
        } else if (shape.geometry.mesh) {
          const geom = this.geometries.get(shape.geometry.mesh.filename);
          const bb = geom?.boundingBox;
          if (!bb) continue;
          const s = shape.geometry.mesh.scale;
          half = new THREE.Vector3(
            ((bb.max.x - bb.min.x) / 2) * s[0],
            ((bb.max.y - bb.min.y) / 2) * s[1],
            ((bb.max.z - bb.min.z) / 2) * s[2]
          );
          center = new THREE.Vector3(
            ((bb.max.x + bb.min.x) / 2) * s[0],
            ((bb.max.y + bb.min.y) / 2) * s[1],
            ((bb.max.z + bb.min.z) / 2) * s[2]
          );
        } else {
          continue;
        }
        const m = rel.clone().multiply(poseMatrix(shape.origin));
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        m.decompose(pos, quat, new THREE.Vector3());
        pos.add(center.clone().applyQuaternion(quat));
        const cdesc = RAPIER.ColliderDesc.cuboid(
          Math.max(1e-4, half.x),
          Math.max(1e-4, half.y),
          Math.max(1e-4, half.z)
        )
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
          .setMass(Math.max(1e-4, perShapeMass))
          .setFriction(0.3)
          .setRestitution(0)
          .setCollisionGroups(ROBOT_GROUPS);
        this.robotColliders.push(this.rapier.createCollider(cdesc, this.body));
      }
    }

    // Arena: walls + seeded scatter blocks. The scatter stream is separate
    // from the noise stream so reset()/sensor use never re-shuffles blocks.
    const arenaRng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    this.obstacles.push(...this.arena.walls);
    if (this.arena.scatter) this.obstacles.push(...this.arena.scatter(arenaRng));
    for (const box of this.obstacles) this.createObstacleCollider(box);
  }

  private createObstacleCollider(box: StaticBox): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), box.yaw);
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
      .setTranslation(box.cx, box.cy, box.cz)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.2)
      .setRestitution(0)
      .setCollisionGroups(OBSTACLE_GROUPS);
    this.rapier.createCollider(desc);
  }

  /**
   * Add an extra static box (obstacle) at runtime — handy for tests and
   * custom /play setups. Also appears in the visual scene when present.
   */
  addStaticBox(box: StaticBox): void {
    this.obstacles.push(box);
    this.createObstacleCollider(box);
    this.queriesDirty = true;
    if (this.scene) this.addBoxMesh(box);
  }

  /* ------------------------------------------------------------ visuals */

  private addBoxMesh(box: StaticBox): void {
    if (!this.scene) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(box.hx * 2, box.hy * 2, box.hz * 2),
      new THREE.MeshStandardMaterial({ color: 0x8a8a8a })
    );
    mesh.position.set(box.cx, box.cy, box.cz);
    mesh.rotation.z = box.yaw;
    this.scene.add(mesh);
  }

  private buildVisuals(): void {
    if (!this.scene) return;
    // Ground plane; its texture derives from the same Float32Array the line
    // sensors sample, so the sensor view and the visual view can't diverge.
    const g = this.arena.ground;
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    if (g) {
      const rgba = new Uint8Array(g.width * g.height * 4);
      for (let i = 0; i < g.data.length; i++) {
        const v = Math.round(235 - 215 * g.data[i]);
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(rgba, g.width, g.height, THREE.RGBAFormat);
      tex.needsUpdate = true;
      groundMat.map = tex;
    } else {
      groundMat.color.set(0xf2f0ea);
    }
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.arena.sizeM.x, this.arena.sizeM.y),
      groundMat
    );
    ground.name = "arena-ground";
    this.scene.add(ground);
    for (const box of this.obstacles) this.addBoxMesh(box);

    this.robotGroup = new THREE.Group();
    this.robotGroup.name = "robot";
    for (const link of this.model.links) {
      const obj = new THREE.Object3D();
      obj.name = `link:${link.name}`;
      for (const shape of link.visuals) {
        const meshRef = shape.geometry.mesh;
        let geometry: THREE.BufferGeometry | undefined;
        if (meshRef) {
          const src = this.geometries.get(meshRef.filename);
          if (src) {
            geometry = src.clone();
            geometry.scale(meshRef.scale[0], meshRef.scale[1], meshRef.scale[2]);
          }
        } else if (shape.geometry.box) {
          geometry = new THREE.BoxGeometry(...shape.geometry.box);
        }
        if (!geometry) continue;
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.7 })
        );
        mesh.applyMatrix4(poseMatrix(shape.origin));
        obj.add(mesh);
      }
      this.linkObjects.set(link.name, obj);
      this.robotGroup.add(obj);
    }
    this.scene.add(this.robotGroup);
  }

  /**
   * Push physics state into the visual scene (robot pose, wheel spin,
   * servo angles). No-op when `collidersOnly`. Call once per rendered
   * frame from the host page.
   */
  syncVisuals(): void {
    if (!this.robotGroup) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.robotGroup.position.set(t.x, t.y, t.z);
    this.robotGroup.quaternion.set(r.x, r.y, r.z, r.w);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const [name, obj] of this.linkObjects) {
      const rel = this.linkRelMatrix(name);
      if (!rel) continue;
      rel.decompose(pos, quat, scale);
      obj.position.copy(pos);
      obj.quaternion.copy(quat);
    }
  }

  /* --------------------------------------------------------- kinematics */

  /**
   * Link transform relative to the base link, honoring current servo
   * angles and wheel spin. Returns null for unknown links.
   */
  private linkRelMatrix(linkName: string): THREE.Matrix4 | null {
    if (linkName === this.model.rootLink) return new THREE.Matrix4();
    const cached = this.staticRelCache.get(linkName);
    if (cached) return cached;
    const chain: UrdfJoint[] = [];
    let cur = linkName;
    let moving = false;
    while (cur !== this.model.rootLink) {
      const j = this.model.jointByChild.get(cur);
      if (!j) return null;
      chain.push(j);
      if (j.type !== "fixed") moving = true;
      cur = j.parent;
    }
    const m = new THREE.Matrix4();
    for (let i = chain.length - 1; i >= 0; i--) {
      const j = chain[i];
      m.multiply(poseMatrix(j.origin));
      if (j.type === "revolute" || j.type === "continuous") {
        const angle = this.jointAngles.get(j.name) ?? 0;
        if (angle !== 0) {
          const axis = new THREE.Vector3(...j.axis).normalize();
          m.multiply(new THREE.Matrix4().makeRotationAxis(axis, angle));
        }
      }
    }
    if (!moving) this.staticRelCache.set(linkName, m);
    return m;
  }

  /** World-frame pose of a URDF link (used by the virtual sensors). */
  getLinkWorldTransform(
    linkName: string
  ): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const rel = this.linkRelMatrix(linkName);
    if (!rel) return null;
    const t = this.body.translation();
    const r = this.body.rotation();
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x, t.y, t.z),
      new THREE.Quaternion(r.x, r.y, r.z, r.w),
      new THREE.Vector3(1, 1, 1)
    );
    base.multiply(rel);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    base.decompose(position, quaternion, new THREE.Vector3());
    return { position, quaternion };
  }

  /* ------------------------------------------------------------ stepping */

  /** Simulated time in ms (derived from the fixed-step count, drift-free). */
  get timeMs(): number {
    return this.stepCount * STEP_MS;
  }

  /**
   * Advance the simulation by `dtMs` of sim time, running as many fixed
   * 1/120 s substeps as fit (remainder carries over).
   */
  step(dtMs: number): void {
    this.acc += Math.max(0, dtMs);
    while (this.acc >= STEP_MS - 1e-9) {
      this.acc -= STEP_MS;
      this.substep();
    }
  }

  /** Subscribe to fixed-step completion. Returns an unsubscribe function. */
  onStep(cb: StepListener): () => void {
    this.stepListeners.add(cb);
    return () => {
      this.stepListeners.delete(cb);
    };
  }

  private substep(): void {
    const dt = STEP_MS / 1000;

    // Servo position motors.
    for (const s of this.servos.values()) {
      s.angleRad = approach(s.angleRad, s.targetRad, DRIVE_TUNING.servoRateRad * dt);
      this.jointAngles.set(s.joint.name, s.angleRad);
    }

    // Differential drive: velocity tracking with accel caps + lateral grip.
    if (this.wheels.enabled) {
      const vL = (this.driveL / 100) * DRIVE_TUNING.vMaxMps;
      const vR = (this.driveR / 100) * DRIVE_TUNING.vMaxMps;
      const targetV = (vL + vR) / 2;
      const targetW = (vR - vL) / this.wheels.trackM;
      const yaw = yawFromQuat(this.body.rotation());
      const fx = Math.cos(yaw);
      const fy = Math.sin(yaw);
      const lv = this.body.linvel();
      const vFwd = lv.x * fx + lv.y * fy;
      const vLat = -lv.x * fy + lv.y * fx;
      const newFwd = approach(vFwd, targetV, DRIVE_TUNING.maxLinAccel * dt);
      const newLat = approach(vLat, 0, DRIVE_TUNING.latGripAccel * dt);
      this.body.setLinvel(
        { x: newFwd * fx - newLat * fy, y: newFwd * fy + newLat * fx, z: 0 },
        true
      );
      const w = this.body.angvel().z;
      const newW = approach(w, targetW, DRIVE_TUNING.maxYawAccel * dt);
      this.body.setAngvel({ x: 0, y: 0, z: newW }, true);

      // Cosmetic wheel spin for the visuals (from commanded surface speed).
      if (this.wheels.leftJoint) {
        const a = this.jointAngles.get(this.wheels.leftJoint) ?? 0;
        this.jointAngles.set(this.wheels.leftJoint, a + (vL / this.wheels.radiusM) * dt);
      }
      if (this.wheels.rightJoint) {
        const a = this.jointAngles.get(this.wheels.rightJoint) ?? 0;
        this.jointAngles.set(this.wheels.rightJoint, a + (vR / this.wheels.radiusM) * dt);
      }
    }

    this.rapier.step();
    this.queriesDirty = false;
    this.stepCount += 1;

    if (this.driveL !== 0 || this.driveR !== 0) this.activeDriveMs += STEP_MS;
    if (this.tone && this.timeMs >= this.tone.endMs) this.tone = null;

    // Contact streak tracking (gate: no sustained wall contact).
    const contact = this.robotInContact();
    this.inContactNow = contact;
    if (contact) {
      this.contactStreakMs += STEP_MS;
      this.contactGapMs = 0;
      if (this.contactStreakMs > this.maxContactStreakMsInternal) {
        this.maxContactStreakMsInternal = this.contactStreakMs;
      }
    } else {
      this.contactGapMs += STEP_MS;
      if (this.contactGapMs > CONTACT_GAP_TOLERANCE_MS) this.contactStreakMs = 0;
    }

    const t = this.timeMs;
    for (const cb of [...this.stepListeners]) cb(t, STEP_MS);
  }

  /** True when any robot collider currently touches an arena collider. */
  robotInContact(): boolean {
    let hit = false;
    for (const c of this.robotColliders) {
      this.rapier.contactPairsWith(c, (other) => {
        if (hit) return;
        this.rapier.contactPair(c, other, (manifold) => {
          if (hit) return;
          const n = manifold.numContacts();
          for (let i = 0; i < n; i++) {
            if (manifold.contactDist(i) <= 1e-4) {
              hit = true;
              return;
            }
          }
        });
      });
      if (hit) break;
    }
    return hit;
  }

  /** Contact statistics for the obstacle-avoidance gate. */
  contactStats(): { inContact: boolean; currentStreakMs: number; maxStreakMs: number } {
    return {
      inContact: this.inContactNow,
      currentStreakMs: this.contactStreakMs,
      maxStreakMs: this.maxContactStreakMsInternal,
    };
  }

  resetContactStats(): void {
    this.inContactNow = false;
    this.contactStreakMs = 0;
    this.contactGapMs = Infinity;
    this.maxContactStreakMsInternal = 0;
  }

  /* ------------------------------------------------------------ robot IO */

  /** Set wheel power, −100..100 per side (§5.4 cmd.drive / BSJ drive). */
  setDrive(l: number, r: number): void {
    this.driveL = clamp(l, -100, 100);
    this.driveR = clamp(r, -100, 100);
  }

  getDrive(): { l: number; r: number } {
    return { l: this.driveL, r: this.driveR };
  }

  /**
   * Servo position command, 0–180°. `id` matches a revolute joint name
   * (directly or as `<id>_joint`). 0–180° maps onto the joint's URDF
   * limits when present, else onto ±90° about the joint zero.
   */
  setServo(id: string, deg: number): void {
    const s = this.servos.get(id) ?? this.servos.get(`${id}_joint`);
    if (!s) return;
    const d = clamp(deg, 0, 180);
    const lim = s.joint.limit;
    s.targetRad = lim
      ? lim.lower + (d / 180) * (lim.upper - lim.lower)
      : ((d - 90) * Math.PI) / 180;
  }

  /** Current servo angle in degrees (inverse of the setServo mapping). */
  getServoDeg(id: string): number | null {
    const s = this.servos.get(id) ?? this.servos.get(`${id}_joint`);
    if (!s) return null;
    const lim = s.joint.limit;
    return lim
      ? ((s.angleRad - lim.lower) / (lim.upper - lim.lower)) * 180
      : (s.angleRad * 180) / Math.PI + 90;
  }

  setLed(r: number, g: number, b: number, id?: number): void {
    const color = {
      r: clamp(Math.round(r), 0, 255),
      g: clamp(Math.round(g), 0, 255),
      b: clamp(Math.round(b), 0, 255),
    };
    if (id === undefined) {
      this.leds = this.leds.map(() => ({ ...color }));
    } else if (id >= 0 && id < this.leds.length) {
      this.leds[id] = color;
    }
  }

  clearLed(id?: number): void {
    this.setLed(0, 0, 0, id);
  }

  getLeds(): readonly LedColor[] {
    return this.leds;
  }

  playTone(hz: number, ms: number): void {
    this.tone = { hz, endMs: this.timeMs + Math.max(0, ms) };
  }

  /** Currently sounding tone, or null. */
  getActiveTone(): ToneState | null {
    return this.tone && this.timeMs < this.tone.endMs ? this.tone : null;
  }

  /* ------------------------------------------------------------- queries */

  getRobotPose(): RobotPose {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z, yaw: yawFromQuat(this.body.rotation()) };
  }

  /** Teleport the robot (velocities are zeroed). */
  setRobotPose(x: number, y: number, yaw: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    this.body.setTranslation({ x, y, z: this.wheels.baseZM }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.queriesDirty = true;
  }

  /** Robot drive geometry derived from the URDF. */
  get driveInfo(): { wheelRadiusM: number; trackM: number; enabled: boolean } {
    return {
      wheelRadiusM: this.wheels.radiusM,
      trackM: this.wheels.trackM,
      enabled: this.wheels.enabled,
    };
  }

  /**
   * Cast a ray against arena obstacles (robot excluded). Returns hit
   * distance in meters or null.
   */
  castObstacleRay(origin: THREE.Vector3, dir: THREE.Vector3, maxM: number): number | null {
    if (this.queriesDirty) {
      // Raycasts before the first step (or right after addStaticBox /
      // setRobotPose) need a fresh broad phase.
      this.rapier.propagateModifiedBodyPositionsToColliders();
      this.rapier.updateSceneQueries();
      this.queriesDirty = false;
    }
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );
    const hit = this.rapier.castRay(ray, maxM, true, undefined, RAY_GROUPS, undefined, this.body);
    return hit ? hit.timeOfImpact : null;
  }

  /** Ground darkness under a world point, 0..1 (line sensors sample this). */
  sampleGround(x: number, y: number): number {
    return this.arena.ground ? this.arena.ground.sample(x, y) : 0;
  }

  /** Seeded uniform integer in [lo, hi] (BSJ `rand` expression). */
  randomInt(lo: number, hi: number): number {
    return randInt(this.rng, lo, hi);
  }

  /** Seeded standard-normal sample (sensor noise). */
  gaussian(): number {
    return this.gauss();
  }

  /* -------------------------------------------------------------- reset */

  /**
   * Reset to the initial state: robot at the arena spawn, time zero, RNG
   * noise stream re-seeded, battery full, LEDs off. Arena block placement
   * is unchanged (it comes from a separate seeded stream at build time).
   */
  reset(): void {
    this.stepCount = 0;
    this.acc = 0;
    this.driveL = 0;
    this.driveR = 0;
    this.activeDriveMs = 0;
    this.tone = null;
    this.leds = this.leds.map(() => ({ r: 0, g: 0, b: 0 }));
    this.rng = mulberry32(this.seed);
    this.gauss = makeGaussian(this.rng);
    for (const s of this.servos.values()) {
      s.angleRad = 0;
      s.targetRad = 0;
      this.jointAngles.set(s.joint.name, 0);
    }
    for (const j of this.model.joints) {
      if (j.type === "continuous") this.jointAngles.set(j.name, 0);
    }
    this.resetContactStats();
    this.setRobotPose(this.arena.spawn.x, this.arena.spawn.y, this.arena.spawn.yaw);
    if (this.scene) this.syncVisuals();
  }

  /** Free the Rapier WASM resources. The world is unusable afterwards. */
  dispose(): void {
    this.stepListeners.clear();
    this.rapier.free();
  }
}
