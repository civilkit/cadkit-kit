/**
 * Constraint tools that act on picks: horizontal, vertical, coincident, equal, parallel, perpendicular, collinear,
 * midpoint, tangent, symmetric, fix, concentric. Each is the same small state machine (`makeConstraintTool`):
 * click what the constraint needs, in any order the kind allows, and ONE constraint is appended; the tool then
 * waits for the next set of picks. A click that does not fit the kind is ignored with `app.sketch.hint.pick.invalid`.
 * A constraint that would add nothing (already there, implied, or contradicting) is refused with a hint:
 * `app.sketch.hint.constraint.exists | redundant | conflict`, and nothing is added.
 *
 * The `refs` of every constraint are in CONSTRAINTS.md. Appending a constraint does not move the geometry; the
 * kernel only re-solves a sketch when asked (see CONSTRAINTS.md "Solving"), and `reportStatus` reads the result.
 *
 * `fromSelection` runs a tool on picks that already exist (the current selection), without clicks.
 */
import type { SketchDraft } from '../index';
import {
  appendSpec, pickOf, refusal, refusalHint, resolve, HINT,
  type ConstraintKind, type Pick,
} from './constraints';
import type { Tool, ToolOutput, ToolSettings } from './types';

export interface ConstraintToolState {
  /** What has been picked so far for the next constraint. */
  picks: Pick[];
}

export interface ConstraintTool extends Tool<ConstraintToolState> {
  kind: ConstraintKind;
  /** Apply the tool to an existing selection (ordered picks). */
  fromSelection(picks: readonly Pick[], draft: SketchDraft, settings: ToolSettings): ToolOutput<ConstraintToolState>;
}

const prompt = (kind: ConstraintKind, picked: number) => `app.sketch.hint.${kind}.${picked === 0 ? 'pick' : 'more'}`;

const view = (state: ConstraintToolState, draft: SketchDraft, hint: string): ToolOutput<ConstraintToolState> =>
  ({ state, draft, preview: [], fields: [], hint });

/** Feed one more pick to the tool; shared by clicks and `fromSelection`. */
function accept(kind: ConstraintKind, state: ConstraintToolState, draft: SketchDraft, pick: Pick): ToolOutput<ConstraintToolState> {
  const picks = [...state.picks, pick];
  const r = resolve(kind, draft, picks);
  if ('hint' in r) return view(state, draft, r.hint);
  if ('more' in r) return view({ picks }, draft, prompt(kind, picks.length));
  const why = refusal(draft, r.spec);
  if (why) return view({ picks: [] }, draft, refusalHint(why));
  return view({ picks: [] }, appendSpec(draft, r.spec), prompt(kind, 0));
}

export function makeConstraintTool(kind: ConstraintKind): ConstraintTool {
  return {
    id: kind,
    kind,
    start: () => ({ picks: [] }),
    step(state, ev, draft) {
      switch (ev.type) {
        case 'click': {
          const pick = pickOf(draft, ev.snap);
          if (!pick) return view(state, draft, HINT.none);
          return accept(kind, state, draft, pick);
        }
        case 'key':
          return ev.key === 'Escape' ? view({ picks: [] }, draft, prompt(kind, 0)) : view(state, draft, prompt(kind, state.picks.length));
        default: // move, field: nothing to preview or type
          return view(state, draft, prompt(kind, state.picks.length));
      }
    },
    fromSelection(picks, draft) {
      let out = view({ picks: [] }, draft, prompt(kind, 0));
      for (const pick of picks) out = accept(kind, out.state, out.draft, pick);
      return out;
    },
  };
}

export const horizontalTool = makeConstraintTool('horizontal');
export const verticalTool = makeConstraintTool('vertical');
export const coincidentTool = makeConstraintTool('coincident');
export const equalTool = makeConstraintTool('equal');
export const parallelTool = makeConstraintTool('parallel');
export const perpendicularTool = makeConstraintTool('perpendicular');
export const collinearTool = makeConstraintTool('collinear');
export const midpointTool = makeConstraintTool('midpoint');
export const tangentTool = makeConstraintTool('tangent');
export const symmetricTool = makeConstraintTool('symmetric');
export const fixTool = makeConstraintTool('fix');
export const concentricTool = makeConstraintTool('concentric');
