// Keeps hole callouts off other dimension text: a callout whose text would land on a dimension (or on another callout) is turned around
// its circle to the nearest angle where it is clear. The dimensions that are not callouts stay where they are.
import type { DDim, DrawingDoc, ViewData } from './model';
import { dimTextBoxes, type RenderCtx } from './render';

type Box = [number, number, number, number];
const PAD = 0.6;
const hit = (a: Box, b: Box): boolean => a[0] < b[2] + PAD && b[0] < a[2] + PAD && a[1] < b[3] + PAD && b[1] < a[3] + PAD;
/** 0, +15, -15, +30, -30 ... degrees from the angle the callout has. */
const TURNS = Array.from({ length: 24 }, (_x, i) => (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12)));

/** The drawing with its callouts moved clear of the dimension text and of each other (per view). `callout` gives the text of a hole feature. */
export function settleCallouts(doc: DrawingDoc, data: Record<string, ViewData | undefined>, callout?: (feature: string) => string | null): DrawingDoc {
  const ctx: RenderCtx = { doc, data, callout };
  let changed = false;
  const dims = doc.dims.slice();
  for (const v of doc.views) {
    const g = data[v.id];
    if (!g) continue;
    const taken: Box[] = [];
    for (const d of dims) if (d.view === v.id && d.kind !== 'callout') taken.push(...dimTextBoxes(ctx, d, v, g));
    dims.forEach((d, i) => {
      if (d.view !== v.id || d.kind !== 'callout') return;
      const base = d.angle ?? Math.PI / 4;
      let best: { d: DDim; boxes: Box[]; bad: number } | null = null;
      for (const turn of TURNS) {
        const cand: DDim = turn === 0 ? d : { ...d, angle: base + turn };
        const boxes = dimTextBoxes(ctx, cand, v, g);
        const bad = boxes.filter((b) => taken.some((o) => hit(b, o))).length;
        if (!best || bad < best.bad) best = { d: cand, boxes, bad };
        if (bad === 0) break;
      }
      taken.push(...best!.boxes);
      if (best!.d !== d) { dims[i] = best!.d; changed = true; }
    });
  }
  return changed ? { ...doc, dims } : doc;
}
