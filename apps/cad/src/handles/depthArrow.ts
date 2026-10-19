// The depth arrow of an open Extrude / Cut card. While the card is open the user sees the preview body; this adds ONE simple
// arrow on it (like Onshape): at the centre of the profile, on the end cap, pointing the way the extrusion goes. Dragging it
// sets `depth` live through the same preview path the card's Depth field uses; releasing does NOT edit the document, it hands
// the value to the open card as a draft patch (`HandleCommit.draft`), so OK / Esc stay the card's. The full size box is for
// after the commit (plan.ts / sizeBox.ts).
//
// Direction: a boss goes along the sketch normal, a cut against it, `flip` reverses either (see defaultFlip in @kit/sketch). Mid-plane
// (symmetric) extrudes both ways: the arrow sits on the far face on the normal's side and the total changes twice as fast.
// 'through' and the up-to ends have no depth to drag, so no arrow.
import type { EditOp } from '@ck/session';
import { V, type HandleSpec, type Vec3 } from '@kit/viewport';
import { t } from '../i18n';
import { clampToTip } from '../taperLimit';
import { MIN_SIZE, type HandleSession } from './session';
import { niceStep, worldOf, type Frame3 } from './sizeBox';

export interface DepthArrowCtx {
  /** The extrude being edited. */
  id: string;
  /** The feature with the card's draft applied (what the card shows now). */
  op: 'add' | 'cut';
  end: string;
  depth: number | null;
  flip: boolean;
  frame: Frame3;
  /** The centre of the profile in the sketch plane. */
  centre: { u: number; v: number; hu?: number };
  /** The depth at which a tapered extrude closes to a tip. */
  tipLimit?: number;
  /** The ops that preview this draft patch (depth, flip) together with the rest of the card's draft. */
  ops(patch: Record<string, unknown>): EditOp[];
}

const ACCENT = '#e5484d';
const round2 = (v: number): number => Math.round(v * 100) / 100;
const fmt = (v: number): string => String(round2(v));

/** +1 when the extrusion goes along the frame's z, -1 against it. */
export const extrudeSign = (op: 'add' | 'cut', flip: boolean): 1 | -1 => ((op === 'cut' ? -1 : 1) * (flip ? -1 : 1)) as 1 | -1;

export function depthArrowSession(c: DepthArrowCtx): HandleSession | null {
  const mid = c.end === 'mid';
  if (c.end !== 'blind' && !mid) return null;
  if (c.depth === null || !(c.depth > 0)) return null;
  const sign = mid ? 1 : extrudeSign(c.op, c.flip);
  const axis: Vec3 = V.mul(c.frame.z, sign).map((x) => x + 0) as Vec3;   // + 0: no negative zeros
  const k = mid ? 2 : 1;                 // a mid-plane total moves twice as far as the far face does
  const capAt = (q: number): Vec3 => worldOf(c.frame, c.centre.u, c.centre.v, sign * (mid ? q / 2 : q));
  const arrow: HandleSpec = { id: 'depth', kind: 'arrow', origin: capAt(c.depth), axis, base: c.depth, scale: k, sizePx: 90, unit: 'mm', color: ACCENT, hoverReadout: true, label: t('handles.depthArrow.label') };
  // the number sits at the profile's edge on the end cap, off the arrow it belongs to
  const labelAt = (q: number): Vec3 => worldOf(c.frame, c.centre.u + (c.centre.hu ?? 0), c.centre.v, sign * (mid ? q / 2 : q));
  const label = (q: number): HandleSpec => ({ id: 'depthLabel', kind: 'label', origin: labelAt(q), axis, text: t('handles.depth', { v: fmt(Math.abs(q)) }), forId: 'depth', color: ACCENT, label: t('sizebox.label.tip') });

  /** The draft patch for a dragged total: a drag back through the sketch plane is the same extrude the other way round. */
  const patch = (q0: number): Record<string, unknown> | null => {
    const q = clampToTip(q0, c.tipLimit).value;
    if (Math.abs(q) < MIN_SIZE) return null;
    if (q > 0) return { depth: round2(q) };
    return mid ? { depth: round2(-q) } : { depth: round2(-q), flip: c.flip ? null : true };
  };
  return {
    kind: 'extrude-depth', target: c.id, specs: [arrow, label(c.depth)],
    preview: (_id, q) => { const p = patch(q); return p ? c.ops(p) : null; },
    commit: (_id, q) => { const p = patch(q); return p ? { ops: [], create: false, draft: p, ...(clampToTip(q, c.tipLimit).clamped ? { notice: t('tip.limited', { h: fmt(c.tipLimit!) }) } : {}) } : null; },
    format: (_id, q) => { const c2 = clampToTip(q, c.tipLimit); return t(c2.atTip ? 'handles.depth.tip' : 'handles.depth', { v: fmt(Math.abs(c2.value)) }); },
    live: (_id, q) => [label(clampToTip(q, c.tipLimit).value)],
    step: () => niceStep(c.depth!),
  };
}

/** A string that changes whenever the arrow must be rebuilt (the value, the direction, the profile). */
export const depthArrowKey = (c: DepthArrowCtx | null | undefined): string =>
  c ? [c.id, c.op, c.end, c.depth, c.flip, c.centre.u, c.centre.v, c.centre.hu ?? '', c.frame.o.join(','), c.frame.z.join(','), c.tipLimit ?? ''].join('|') : '';
