// Session-level helper: pull the body (and, for section views, the exact loops) out of a kernel session and render it.
import { renderSnapshot } from './render.js';
import type { SectionLike, SnapshotInput, SnapshotOpts, SnapshotResult, V3 } from './types.js';

/** The part of a @ck/session Session this helper needs (structural, so tests and the MCP daemon can pass any equivalent). */
export interface SessionLike {
  bodyForView(): Promise<{ mesh: SnapshotInput['mesh']; edges: NonNullable<SnapshotInput['edges']>; box: NonNullable<SnapshotInput['box']> } | null>;
  section?(plane: { origin: number[]; normal: number[] }): Promise<SectionLike>;
  massProps?(): Promise<{ volume?: number | null }>;
  document?: { name?: string };
}

export type SectionRequest = { origin: number[]; normal: number[] } | { axis: 'x' | 'y' | 'z'; at: number };

export interface SessionSnapshotOpts extends SnapshotOpts {
  /** cut plane: {origin, normal} or {axis, at}; the exact loops are drawn on the 3D view and on the 'section' sheet */
  section?: SectionRequest;
  /** override the part name shown on drawing sheets */
  name?: string;
}

export function planeOf(s: SectionRequest): { origin: number[]; normal: number[] } {
  if ('origin' in s) return s;
  const i = s.axis === 'x' ? 0 : s.axis === 'y' ? 1 : 2;
  const origin = [0, 0, 0], normal = [0, 0, 0];
  origin[i] = s.at; normal[i] = 1;
  return { origin, normal };
}

/** Gather a SnapshotInput from a session (mesh, edges, box, name, volume, and a section when asked). */
export async function inputOf(session: SessionLike, opts: SessionSnapshotOpts = {}): Promise<SnapshotInput> {
  const body = await session.bodyForView();
  if (!body) throw new Error('snapshot: the document has no body to draw');
  const input: SnapshotInput = { mesh: body.mesh, edges: body.edges, box: body.box, name: opts.name ?? session.document?.name };
  const wantsVolume = (opts.sheet ?? 'single').startsWith('drawing');
  if (wantsVolume && session.massProps) {
    try { const m = await session.massProps(); if (typeof m.volume === 'number') input.volume = m.volume; } catch { /* the title block shows N/A */ }
  }
  if (opts.section) {
    if (!session.section) throw new Error('snapshot: this session cannot compute sections');
    input.section = await session.section(planeOf(opts.section));
  } else if (opts.sheet === 'section') throw new Error("snapshot: sheet 'section' needs opts.section");
  return input;
}

/** Render a session's current body: `renderSnapshot(await inputOf(session), opts)`. */
export async function snapshotOf(session: SessionLike, opts: SessionSnapshotOpts = {}): Promise<SnapshotResult> {
  const { section: _s, name: _n, ...rest } = opts;
  void _s; void _n;
  return renderSnapshot(await inputOf(session, opts), rest);
}

export type { V3 };
