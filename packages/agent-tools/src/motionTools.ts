// Motion tools (docs/spec-motion-studies.md, section 9): motion_list, motion_drive, motion_sweep, motion_study_run. Each answers with the same structured
// result as the Motion panel, in plain words next to the numbers, so an agent can check a mechanism ("the drawer opens 250 mm without hitting the
// carcass") and get an exact answer. Read only: nothing is rebuilt and the document is not changed. Needs a document with assembly mates.
import { firstIssue, frameCount, frameTime, poseProblem, readMotion, readStudies, solvedFrom, studyFrames, type Study } from '@kit/motion';
import type { AgentSession } from './agent-session';
import { ToolError } from './errors';
import type { Schema } from './schema';
import type { ToolDef } from './tools';

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });
const r3 = (x: number): number => Number(x.toFixed(3));
const num: Schema = { type: 'number' };

type Feat = { id: string; type: string; name?: string; kind?: string };
const features = (a: AgentSession): Feat[] => (a.doc.features ?? []) as unknown as Feat[];
const nameOf = (a: AgentSession) => (id: string): string => { const f = features(a).find((x) => x.id === id); return f?.name ? `${f.name} (${id})` : id; };

/** The kernel's refusal of a driver, as an actionable tool error. */
function bad(e: unknown, a: AgentSession): never {
  const m = e instanceof Error ? e.message : String(e);
  const [code, mate] = m.split(': ');
  if (code === 'unknownDriver') throw new ToolError('unknown_driver', `no mate ${mate}`, `drivable mates: ${drivers(a)}; call motion_list`);
  if (code === 'notDrivable') throw new ToolError('not_drivable', `${mate} cannot be driven`, 'hinge, slot, angle, distance, gear, screw and rackPinion mates can be; call motion_list');
  throw new ToolError('motion_failed', m, 'does the document have assembly mates? call motion_list');
}
const drivers = (a: AgentSession): string => features(a).filter((f) => f.type === 'mate' && ['hinge', 'slot', 'angle', 'distance', 'gear', 'screw', 'rackPinion'].includes(String(f.kind))).map((f) => f.id).join(', ') || 'none';

const turnDeg = (r: number[]): number => Math.acos(Math.max(-1, Math.min(1, (r[0] + r[4] + r[8] - 1) / 2))) * (180 / Math.PI);
const rotOf = (p: { x: number[]; y: number[]; z: number[] }): number[] => [p.x[0], p.y[0], p.z[0], p.x[1], p.y[1], p.z[1], p.x[2], p.y[2], p.z[2]];

/** What a stop means, in the panel's words. */
export function stopWords(s: { reason: string; value: number; mate?: string; bound?: string; bound_value?: number; a?: string; b?: string; near?: boolean; distance?: number; component?: string }, name: (id: string) => string, unit: string): string {
  const v = `${r3(s.value)}${unit}`;
  switch (s.reason) {
    case 'range': return `reaches the end of the range (${v}) without stopping`;
    case 'limit': return `stopped at ${v} by the limit ${name(s.mate ?? '')} (${s.bound === 'min' ? 'at least' : 'at most'} ${r3(s.bound_value ?? 0)}${unit})`;
    case 'contact': return s.near ? `stopped at ${v}: ${name(s.a ?? '')} comes within the clearance of ${name(s.b ?? '')} (${r3(s.distance ?? 0)} mm)` : `stopped at ${v}: ${name(s.a ?? '')} would hit ${name(s.b ?? '')}`;
    case 'branchJump': return `stopped at ${v}: the mechanism would flip to another position (${name(s.component ?? '')} jumps)`;
    default: return `stopped at ${v}: the mates cannot all hold beyond this`;
  }
}

export function motionTools(): ToolDef[] {
  return [
    {
      name: 'motion_list',
      description: 'The drivable mates of the open assembly (hinge, slot, angle, distance, gear, screw, rackPinion): id, name, kind, unit (deg or mm) and assembled value, plus the saved ranges and studies of doc.motion. Call it first to learn the driver ids motion_drive / motion_sweep / motion_study_run take.',
      inputSchema: obj({}),
      async handler(_i, a) {
        let r;
        try { r = await a.session.solvePoses([], { contact: false }); } catch (e) { bad(e, a); }
        const m = readMotion((a.doc as unknown as { motion?: unknown }).motion);
        const name = nameOf(a);
        const studies = readStudies(m);
        return {
          summary: `${r.drivers.length} driver${r.drivers.length === 1 ? '' : 's'}, ${studies.length} stud${studies.length === 1 ? 'y' : 'ies'}`,
          data: {
            drivers: r.drivers.map((d) => ({ ...d, name: name(d.mate), kindOfMate: features(a).find((f) => f.id === d.mate)?.kind, range: m.drivers.find((x) => x.mate === d.mate) ? { min: m.drivers.find((x) => x.mate === d.mate)!.min, max: m.drivers.find((x) => x.mate === d.mate)!.max } : null })),
            studies: studies.map((s) => ({ id: s.id, name: s.name, duration: s.duration, loop: s.loop, clearance: s.clearance, drivers: s.tracks.map((t) => t.driver), keys: s.tracks.reduce((n, t) => n + t.keys.length, 0) })),
          },
        };
      },
    },
    {
      name: 'motion_drive',
      description: 'Put the assembly in a pose: values {mateId: value} (degrees for angles, mm for distances; hinge and slot values are measured from the assembled pose). Returns whether the mates hold, what the pose touches (contact is a stop by default; clearance in mm adds a near-miss margin), and how far each part moved from its assembled placement. Read only.',
      inputSchema: obj({ values: { type: 'object', description: 'mate id -> number' }, clearance: num, contact: { type: 'boolean' } }, ['values']),
      async handler(i, a) {
        const values = i.values as Record<string, number>;
        if (!values || !Object.keys(values).length) throw new ToolError('bad_input', 'give values like {"F3": 45}', 'call motion_list for the driver ids');
        let r;
        try { r = await a.session.solvePoses([{}, values], { clearance: i.clearance as number | undefined, contact: i.contact as boolean | undefined }); } catch (e) { bad(e, a); }
        const [home, pose] = r.poses;
        const name = nameOf(a);
        const moved = pose.places.map((p) => {
          const h = home.places.find((x) => x.id === p.id)!;
          const d = Math.hypot(p.place.o[0] - h.place.o[0], p.place.o[1] - h.place.o[1], p.place.o[2] - h.place.o[2]);
          // rotation between the two placements: R_pose * R_home^T
          const A = rotOf(p.place), B = rotOf(h.place);
          const R = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => A[row * 3] * B[col * 3] + A[row * 3 + 1] * B[col * 3 + 1] + A[row * 3 + 2] * B[col * 3 + 2]));
          return { id: p.id, name: name(p.id), moved_mm: r3(d), turned_deg: r3(turnDeg(R)), origin: p.place.o.map(r3) };
        }).filter((m) => m.moved_mm > 1e-6 || m.turned_deg > 1e-6);
        const c = pose.contact;
        const words = !pose.ok ? poseProblem(pose.error ?? '') : c ? (c.kind === 'near' ? `${name(c.a)} is within ${r3(c.distance)} mm of ${name(c.b)}` : `${name(c.a)} would hit ${name(c.b)} here: the motion cannot go this far`) : 'the pose holds and nothing touches';
        return { summary: words, data: { ok: pose.ok, ...(pose.error ? { error: pose.error, mate: pose.mate } : {}), contact: c ? { ...c, at: c.at.map(r3), a: name(c.a), b: name(c.b) } : null, moved, words } };
      },
    },
    {
      name: 'motion_sweep',
      description: 'Find where and why a driver stops: walk it from `from` (default 0) toward `to` and report the farthest value reached freely and the reason: a limits mate (named), contact with a named part (and the point), the mates failing, a closed-loop flip, or the end of the range. Contact is on by default (a stop); clearance in mm stops it earlier. hold {mateId: value} keeps other drivers at a value. Call it twice (to a very negative and a very positive value) for the travel of a slider or the swing of a door. Read only.',
      inputSchema: obj({ driver: { type: 'string' }, from: num, to: num, clearance: num, contact: { type: 'boolean' }, hold: { type: 'object', description: 'mate id -> number' } }, ['driver', 'to']),
      async handler(i, a) {
        let r;
        try { r = await a.session.sweepDriver({ driver: i.driver as string, from: i.from as number | undefined, to: i.to as number, clearance: i.clearance as number | undefined, contact: i.contact as boolean | undefined, hold: i.hold as Record<string, number> | undefined }); } catch (e) { bad(e, a); }
        const name = nameOf(a);
        const unit = features(a).find((f) => f.id === r.driver) && ['distance', 'slot'].includes(String(features(a).find((f) => f.id === r.driver)?.kind)) ? ' mm' : '°';
        const words = stopWords(r.stop, name, unit);
        const stop = { ...r.stop, ...(r.stop.at ? { at: r.stop.at.map(r3) } : {}), ...(r.stop.a ? { a: name(r.stop.a) } : {}), ...(r.stop.b ? { b: name(r.stop.b) } : {}) };
        return { summary: words, data: { driver: r.driver, from: r.from, to: r.to, reached: r3(r.reached), travel: r3(Math.abs(r.reached - r.from)), stop, words, startContacts: r.startContacts, posesSolved: r.posesSolved } };
      },
    },
    {
      name: 'motion_study_run',
      description: 'Solve a study over time and report what it touches: study is the id of a study saved in doc.motion (see motion_list) or an inline {duration, loop?, clearance?, tracks:[{driver, keys:[{t, v, ease?}]}]} (seconds; values in degrees / mm; ease linear | inOut). Returns the first contact or solver failure with its time, and for every keyframe time whether the pose holds and what it touches. No images. Read only.',
      inputSchema: obj({
        study: { oneOf: [{ type: 'string' }, obj({ duration: num, loop: { type: 'string', enum: ['once', 'loop', 'pingpong'] }, clearance: num, tracks: { type: 'array', items: obj({ driver: { type: 'string' }, keys: { type: 'array', items: obj({ t: num, v: num, ease: { type: 'string', enum: ['linear', 'inOut'] } }, ['t', 'v']) } }, ['driver', 'keys']) } }, ['duration', 'tracks'])] } as Schema,
      }, ['study']),
      async handler(i, a) {
        const m = readMotion((a.doc as unknown as { motion?: unknown }).motion);
        let study: Study | undefined;
        if (typeof i.study === 'string') {
          study = readStudies(m).find((s) => s.id === i.study || s.name === i.study);
          if (!study) throw new ToolError('no_such_study', `no study ${i.study}`, `studies: ${readStudies(m).map((s) => s.id).join(', ') || 'none'}; call motion_list`);
        } else {
          study = readStudies({ studies: [{ id: 'inline', name: 'inline', ...(i.study as object) }] })[0];
          if (!study) throw new ToolError('bad_input', 'the inline study needs duration and tracks', 'e.g. {"duration":4,"tracks":[{"driver":"F3","keys":[{"t":0,"v":0},{"t":4,"v":90}]}]}');
        }
        if (!study.tracks.some((t) => t.keys.length)) throw new ToolError('empty_study', 'the study has no keyframes', 'add tracks with keys {t, v}');
        let r;
        try { r = await a.session.solvePoses(studyFrames(study), { clearance: study.clearance }); } catch (e) { bad(e, a); }
        const name = nameOf(a);
        const solved = solvedFrom([], r.poses);
        const issue = firstIssue(solved, study.duration);
        const n = r.poses.length;
        const times = [...new Set(study.tracks.flatMap((t) => t.keys.map((k) => k.t)))].sort((x, y) => x - y);
        const at = (t: number) => Math.max(0, Math.min(n - 1, Math.round((t / study.duration) * (n - 1))));
        const keyframes = times.map((t) => {
          const p = r.poses[at(t)];
          const c = p.contact;
          return { t, ok: p.ok, ...(p.error ? { error: p.error } : {}), contact: c ? { kind: c.kind, a: name(c.a), b: name(c.b), distance: r3(c.distance) } : null };
        });
        const words = !issue ? `the study runs clear for its ${study.duration} s: every pose holds and nothing touches` : issue.kind === 'solver' ? `at ${issue.time} s the mates cannot all hold` : `at ${issue.time} s ${name(issue.a ?? '')} ${issue.kind === 'near' ? `comes within ${r3(issue.distance ?? 0)} mm of` : 'would hit'} ${name(issue.b ?? '')}`;
        return { summary: words, data: { study: study.id, duration: study.duration, frames: frameCount(study.duration), ok: !issue, issue: issue ? { ...issue, ...(issue.a ? { a: name(issue.a) } : {}), ...(issue.b ? { b: name(issue.b) } : {}) } : null, keyframes, words, frameTimeLast: frameTime(n - 1, n, study.duration) } };
      },
    },
  ];
}
