/**
 * Minimal URDF parser for the physics side of the simulator.
 *
 * The engine's URDF generator (packages/engine, §5.6 `urdf/robot.urdf`)
 * emits a small, regular subset of URDF: links with mesh/box geometry and
 * fixed/continuous/revolute joints. This hand-rolled parser covers exactly
 * that subset with zero DOM dependency, so `SimWorld` runs headless in Node
 * (vitest) as well as in the browser.
 *
 * The *visual* path is separate: `loadRobotUrdf()` uses the real
 * `urdf-loader` package in the browser (it needs `DOMParser`).
 */

export type Vec3 = [number, number, number];

export interface UrdfPose {
  xyz: Vec3;
  rpy: Vec3;
}

export interface UrdfGeometry {
  /** Mesh geometry: filename as written in the URDF + per-axis scale. */
  mesh?: { filename: string; scale: Vec3 };
  /** Box geometry: full size (x, y, z) in meters. */
  box?: Vec3;
}

export interface UrdfShape {
  origin: UrdfPose;
  geometry: UrdfGeometry;
}

export interface UrdfLink {
  name: string;
  /** Mass from <inertial>, kg (0 if absent). */
  mass: number;
  collisions: UrdfShape[];
  visuals: UrdfShape[];
}

export type UrdfJointType = "fixed" | "continuous" | "revolute" | "prismatic" | "floating";

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  origin: UrdfPose;
  /** Joint axis in the child/joint frame (URDF default [1,0,0]). */
  axis: Vec3;
  limit?: { lower: number; upper: number };
}

export interface UrdfModel {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
  linkByName: Map<string, UrdfLink>;
  /** Joint whose `child` is the given link (a URDF link has ≤ 1 parent). */
  jointByChild: Map<string, UrdfJoint>;
  /** The base link — the one link that is never a joint child. */
  rootLink: string;
}

/* ------------------------------------------------------------------ */
/* Tiny XML parser (elements + attributes; text nodes ignored)         */
/* ------------------------------------------------------------------ */

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function parseXml(src: string): XmlNode {
  let i = 0;
  const n = src.length;

  const fail = (msg: string): never => {
    throw new Error(`URDF XML parse error at offset ${i}: ${msg}`);
  };

  const skipProlog = (): void => {
    for (;;) {
      while (i < n && (isSpace(src[i]) || src[i] !== "<")) i++;
      if (i >= n) fail("no root element");
      if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i);
        if (e < 0) fail("unterminated comment");
        i = e + 3;
      } else if (src.startsWith("<?", i)) {
        const e = src.indexOf("?>", i);
        if (e < 0) fail("unterminated processing instruction");
        i = e + 2;
      } else if (src.startsWith("<!", i)) {
        const e = src.indexOf(">", i);
        if (e < 0) fail("unterminated declaration");
        i = e + 1;
      } else {
        return;
      }
    }
  };

  const parseElement = (): XmlNode => {
    if (src[i] !== "<") fail("expected '<'");
    i++;
    const nameStart = i;
    while (i < n && !isSpace(src[i]) && src[i] !== ">" && src[i] !== "/") i++;
    const tag = src.slice(nameStart, i);
    if (tag.length === 0) fail("empty tag name");
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (i < n && isSpace(src[i])) i++;
      if (i >= n) fail(`unterminated <${tag}>`);
      if (src[i] === "/") {
        if (src[i + 1] !== ">") fail("expected '/>'");
        i += 2;
        selfClosing = true;
        break;
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      const aStart = i;
      while (i < n && src[i] !== "=" && !isSpace(src[i])) i++;
      const aName = src.slice(aStart, i);
      while (i < n && isSpace(src[i])) i++;
      if (src[i] !== "=") fail(`attribute '${aName}' missing '='`);
      i++;
      while (i < n && isSpace(src[i])) i++;
      const quote = src[i];
      if (quote !== '"' && quote !== "'") fail(`attribute '${aName}' value not quoted`);
      i++;
      const vStart = i;
      while (i < n && src[i] !== quote) i++;
      if (i >= n) fail(`unterminated value for '${aName}'`);
      attrs[aName] = src.slice(vStart, i);
      i++;
    }
    const node: XmlNode = { tag, attrs, children: [] };
    if (selfClosing) return node;
    for (;;) {
      while (i < n && src[i] !== "<") i++; // skip text content
      if (i >= n) fail(`unterminated <${tag}>`);
      if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i);
        if (e < 0) fail("unterminated comment");
        i = e + 3;
        continue;
      }
      if (src.startsWith("</", i)) {
        const e = src.indexOf(">", i);
        if (e < 0) fail(`unterminated </${tag}>`);
        i = e + 1;
        return node;
      }
      node.children.push(parseElement());
    }
  };

  skipProlog();
  return parseElement();
}

/* ------------------------------------------------------------------ */
/* URDF mapping                                                        */
/* ------------------------------------------------------------------ */

function parseTriple(s: string | undefined, fallback: Vec3): Vec3 {
  if (s === undefined) return [...fallback] as Vec3;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((v) => Number.isNaN(v))) {
    throw new Error(`URDF: expected 3 numbers, got "${s}"`);
  }
  return [parts[0], parts[1], parts[2]];
}

function parseOrigin(el: XmlNode | undefined): UrdfPose {
  return {
    xyz: parseTriple(el?.attrs.xyz, [0, 0, 0]),
    rpy: parseTriple(el?.attrs.rpy, [0, 0, 0]),
  };
}

function child(el: XmlNode, tag: string): XmlNode | undefined {
  return el.children.find((c) => c.tag === tag);
}

function parseShape(el: XmlNode): UrdfShape | null {
  const geomEl = child(el, "geometry");
  if (!geomEl) return null;
  const geometry: UrdfGeometry = {};
  const meshEl = child(geomEl, "mesh");
  const boxEl = child(geomEl, "box");
  if (meshEl) {
    geometry.mesh = {
      filename: meshEl.attrs.filename ?? "",
      scale: parseTriple(meshEl.attrs.scale, [1, 1, 1]),
    };
  } else if (boxEl) {
    geometry.box = parseTriple(boxEl.attrs.size, [0, 0, 0]);
  } else {
    return null; // cylinder/sphere not emitted by the engine; ignore
  }
  return { origin: parseOrigin(child(el, "origin")), geometry };
}

/** Parse a URDF document (string) into a `UrdfModel`. */
export function parseUrdf(xml: string): UrdfModel {
  const root = parseXml(xml);
  if (root.tag !== "robot") throw new Error(`URDF: root element is <${root.tag}>, not <robot>`);
  const links: UrdfLink[] = [];
  const joints: UrdfJoint[] = [];

  for (const el of root.children) {
    if (el.tag === "link") {
      const inertial = child(el, "inertial");
      const massEl = inertial ? child(inertial, "mass") : undefined;
      const link: UrdfLink = {
        name: el.attrs.name ?? "",
        mass: massEl ? Number(massEl.attrs.value ?? 0) : 0,
        collisions: [],
        visuals: [],
      };
      for (const sub of el.children) {
        if (sub.tag === "collision") {
          const s = parseShape(sub);
          if (s) link.collisions.push(s);
        } else if (sub.tag === "visual") {
          const s = parseShape(sub);
          if (s) link.visuals.push(s);
        }
      }
      links.push(link);
    } else if (el.tag === "joint") {
      const parent = child(el, "parent")?.attrs.link;
      const childLink = child(el, "child")?.attrs.link;
      if (!parent || !childLink) {
        throw new Error(`URDF: joint '${el.attrs.name}' missing parent/child`);
      }
      const limitEl = child(el, "limit");
      joints.push({
        name: el.attrs.name ?? "",
        type: (el.attrs.type ?? "fixed") as UrdfJointType,
        parent,
        child: childLink,
        origin: parseOrigin(child(el, "origin")),
        axis: parseTriple(child(el, "axis")?.attrs.xyz, [1, 0, 0]),
        limit: limitEl
          ? { lower: Number(limitEl.attrs.lower ?? 0), upper: Number(limitEl.attrs.upper ?? 0) }
          : undefined,
      });
    }
  }

  const linkByName = new Map(links.map((l) => [l.name, l]));
  const jointByChild = new Map(joints.map((j) => [j.child, j]));
  const childNames = new Set(joints.map((j) => j.child));
  const roots = links.filter((l) => !childNames.has(l.name));
  if (roots.length !== 1) {
    throw new Error(`URDF: expected exactly 1 root link, found ${roots.length}`);
  }

  return {
    name: root.attrs.name ?? "robot",
    links,
    joints,
    linkByName,
    jointByChild,
    rootLink: roots[0].name,
  };
}
