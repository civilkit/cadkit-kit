// Plugin-declared joint/motion hints: reads joints saved in `doc.pluginRuns[*].meta.joints`, computes rigid transforms
// for revolute (hinge) and prismatic (slider) joints, and maps them onto body faces & edges for live viewport preview.
import type { Rigid } from '@kit/motion';
import type { PluginJointHint } from '@kit/plugin-wasm';

export interface PluginJointEntry {
  /** Stable key (`${group}:${joint.name}`) used in slider value maps */
  id: string;
  /** Feature folder / plugin run name */
  group: string;
  joint: PluginJointHint;
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Extract all movable (revolute / prismatic) joints declared by plugin runs in the document. */
export function readPluginJoints(
  pluginRuns: Record<string, { meta?: Record<string, unknown> }> | null | undefined,
): PluginJointEntry[] {
  if (!pluginRuns || typeof pluginRuns !== 'object') return [];
  const out: PluginJointEntry[] = [];
  for (const [group, run] of Object.entries(pluginRuns)) {
    const raw = run?.meta?.joints;
    if (!Array.isArray(raw)) continue;
    raw.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const j = item as Record<string, unknown>;
      const kind = j.kind;
      if (kind !== 'revolute' && kind !== 'prismatic') return;
      const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim() : `Joint ${idx + 1}`;
      const bodies = Array.isArray(j.bodies) ? j.bodies.filter((b): b is string => typeof b === 'string' && b.length > 0) : [];
      const origin: [number, number, number] = isVec3(j.origin) ? j.origin : [0, 0, 0];
      const axis: [number, number, number] = isVec3(j.axis) ? j.axis : (kind === 'prismatic' ? [0, 1, 0] : [0, 0, 1]);
      const min = typeof j.min === 'number' && Number.isFinite(j.min) ? j.min : 0;
      const max = typeof j.max === 'number' && Number.isFinite(j.max) ? j.max : (kind === 'revolute' ? 110 : 300);
      const rest = typeof j.rest === 'number' && Number.isFinite(j.rest) ? j.rest : undefined;
      const component = typeof j.component === 'string' ? j.component : undefined;
      out.push({
        id: `${group}:${name}`,
        group,
        joint: { name, kind, bodies, origin, axis, min, max, ...(rest !== undefined ? { rest } : {}), ...(component ? { component } : {}) },
      });
    });
  }
  return out;
}

/** Rigid transform for one plugin joint at `value` (degrees for revolute, mm for prismatic). */
export function jointRigid(joint: PluginJointHint, value: number): Rigid {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-12 || joint.kind === 'rigid') {
    return { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  }
  const len = Math.hypot(joint.axis[0], joint.axis[1], joint.axis[2]);
  const [ux, uy, uz] = len > 1e-12 ? [joint.axis[0] / len, joint.axis[1] / len, joint.axis[2] / len] : [0, 0, 1];
  if (joint.kind === 'prismatic') {
    return { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [ux * value, uy * value, uz * value] };
  }
  // Rodrigues' rotation formula about axis `u` passing through `origin` by `value` degrees
  const rad = (value * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad), k = 1 - c;
  const r = [
    c + ux * ux * k, ux * uy * k - uz * s, ux * uz * k + uy * s,
    uy * ux * k + uz * s, c + uy * uy * k, uy * uz * k - ux * s,
    uz * ux * k - uy * s, uz * uy * k + ux * s, c + uz * uz * k,
  ];
  const [ox, oy, oz] = joint.origin;
  const rox = r[0] * ox + r[1] * oy + r[2] * oz;
  const roy = r[3] * ox + r[4] * oy + r[5] * oz;
  const roz = r[6] * ox + r[7] * oy + r[8] * oz;
  return { r, t: [ox - rox, oy - roy, oz - roz] };
}

/** Compose two rigid transforms: apply `a` first, then `b` (`b(a(p))`). */
function composeRigid(b: Rigid, a: Rigid): Rigid {
  const r = [
    b.r[0] * a.r[0] + b.r[1] * a.r[3] + b.r[2] * a.r[6],
    b.r[0] * a.r[1] + b.r[1] * a.r[4] + b.r[2] * a.r[7],
    b.r[0] * a.r[2] + b.r[1] * a.r[5] + b.r[2] * a.r[8],
    b.r[3] * a.r[0] + b.r[4] * a.r[3] + b.r[5] * a.r[6],
    b.r[3] * a.r[1] + b.r[4] * a.r[4] + b.r[5] * a.r[7],
    b.r[3] * a.r[2] + b.r[4] * a.r[5] + b.r[5] * a.r[8],
    b.r[6] * a.r[0] + b.r[7] * a.r[3] + b.r[8] * a.r[6],
    b.r[6] * a.r[1] + b.r[7] * a.r[4] + b.r[8] * a.r[7],
    b.r[6] * a.r[2] + b.r[7] * a.r[5] + b.r[8] * a.r[8],
  ];
  const t = [
    b.r[0] * a.t[0] + b.r[1] * a.t[1] + b.r[2] * a.t[2] + b.t[0],
    b.r[3] * a.t[0] + b.r[4] * a.t[1] + b.r[5] * a.t[2] + b.t[1],
    b.r[6] * a.t[0] + b.r[7] * a.t[1] + b.r[8] * a.t[2] + b.t[2],
  ];
  return { r, t };
}

/** Build per-face and per-edge rigid pose maps for all active plugin joints. */
export function pluginPoseMaps(
  entries: readonly PluginJointEntry[],
  values: Readonly<Record<string, number>>,
  rows: ReadonlyArray<{ name: string; docName?: string; faces: readonly string[]; edges?: readonly string[] }>,
): { facePose: Map<string, Rigid>; edgePose: Map<string, Rigid> } {
  const facePose = new Map<string, Rigid>();
  const edgePose = new Map<string, Rigid>();
  if (!entries.length) return { facePose, edgePose };
  const byName = new Map(rows.map((r) => [r.docName ?? r.name, r]));
  for (const e of entries) {
    const v = values[e.id] ?? 0;
    if (!Number.isFinite(v) || Math.abs(v) < 1e-12) continue;
    const rig = jointRigid(e.joint, v);
    for (const bodyName of e.joint.bodies) {
      const row = byName.get(bodyName);
      if (!row) continue;
      for (const f of row.faces) {
        const prev = facePose.get(f);
        facePose.set(f, prev ? composeRigid(rig, prev) : rig);
      }
      for (const ed of row.edges ?? []) {
        const prev = edgePose.get(ed);
        edgePose.set(ed, prev ? composeRigid(rig, prev) : rig);
      }
    }
  }
  return { facePose, edgePose };
}
