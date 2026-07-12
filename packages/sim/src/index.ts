/**
 * @botforge/sim — the browser/headless robot simulator (PLAN.md Phase 3):
 * three.js visuals + Rapier physics, loading the engine-generated URDF, with
 * virtual sensors, arenas, and a §5.4 `SimLink` transport for /play & /drive.
 *
 * Typical /play wiring:
 *
 *   const world = await SimWorld.create({ urdf, meshes, arena: "obstacle_pen", seed });
 *   const link = new SimLink(world);            // implements RobotLink
 *   await link.connect();
 *   link.loadBehavior(bsjJson);                 // POST /api/behavior equivalent
 *   link.ctl("run");                            //   ...behavior/ctl equivalent
 *   link.startClock(1);                         // real-time stepping (4 = 4×)
 *   scene.add(world.scene!);                    // world.syncVisuals() per frame
 */

export { SIM_FIXED_STEP_HZ, SimWorld, DRIVE_TUNING } from "./world.js";
export type { SimWorldOptions, RobotPose, LedColor, ToneState, StepListener } from "./world.js";

export {
  VirtualSensors,
  DEFAULT_RANGE_SENSOR,
  DEFAULT_LINE_SENSOR,
  BATTERY_MODEL,
} from "./sensors.js";
export type { RangeSensorConfig, LineSensorConfig } from "./sensors.js";

export { ARENAS, makeGroundField } from "./arenas.js";
export type { ArenaDef, StaticBox, GroundField, TrackInfo } from "./arenas.js";

export { SimLink } from "./simlink.js";
export type { SimLinkOptions, BehaviorCtlAction } from "./simlink.js";

export { loadRobotUrdf } from "./loadRobotUrdf.js";
export type { LoadRobotUrdfOptions } from "./loadRobotUrdf.js";

export { parseUrdf } from "./urdf.js";
export type {
  UrdfModel,
  UrdfLink,
  UrdfJoint,
  UrdfJointType,
  UrdfShape,
  UrdfGeometry,
  UrdfPose,
  Vec3,
} from "./urdf.js";

export { mulberry32, makeGaussian, randInt, randRange } from "./rng.js";
export type { Rng } from "./rng.js";

// §5.4 protocol surface (kept in lockstep with apps/web/lib/robotlink).
export { RobotLinkEmitter } from "./robotlink.js";
export type {
  RobotLink,
  RobotLinkEvents,
  RobotLinkEventName,
  LinkState,
  RobotMode,
  LogLevel,
  AppToRobotMsg,
  RobotToAppMsg,
  RobotMsg,
  HelloMsg,
  PingMsg,
  ModeMsg,
  CmdDriveMsg,
  CmdServoMsg,
  CmdLedMsg,
  CmdToneMsg,
  HelloAckMsg,
  TelemetryMsg,
  LogMsg,
  RobotInfo,
  Telemetry,
  TelemetrySensors,
  LogEntry,
} from "./robotlink.js";
