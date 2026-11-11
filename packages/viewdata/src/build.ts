// What the viewer shows of a built part, as one value (`ViewData`), from the parts of a kernel reply. The app controller and the
// agent tools both call these, so a view stored by either is the same thing. Pure: no kernel, no DOM.
import { diagnose, type DiagFeature, type Diagnosis } from './errorSummary';
import { adviceOf } from './diagnosticsText';
import { limitsOf, mayHaveTip } from './taperLimit';
import { hasSurfaceFeatures, toViewSurfaces, withSurfaces } from './surfaces';
import type { FeatureStatus } from '@kit/store';
import type { ViewData } from './viewCache';

export type RegenError = [string, { code?: string; params?: Record<string, unknown> }];
export interface RegenHint { feature: string; code: string; hint: string }

/** The surface bodies to show: those of the reply when the document has a feature that makes a sheet, else none. */
export function surfacesForView(features: Array<{ type?: string }>, raw: unknown): ReturnType<typeof toViewSurfaces> {
  return hasSurfaceFeatures(features as never) ? toViewSurfaces(raw) : [];
}

/** The body handed to the viewer: the solid's view body with its surface bodies attached (null: nothing to show). */
export function shownBody<B extends { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] } }>(body: B | null, features: Array<{ type?: string }>, rawSurfaces: unknown) {
  return withSurfaces(body, surfacesForView(features, rawSurfaces));
}

/** Errors sorted into causes and consequences, with the kernel's repair hints. */
export function diagnoseErrors(errors: Array<[string, { code: string; params?: Record<string, unknown> }]>, hints: RegenHint[], features: unknown): Diagnosis {
  return diagnose(errors.map(([id, e]) => ({ id, code: e.code, params: e.params, hint: hints.find((h) => h.feature === id && h.code === e.code)?.hint })), features as DiagFeature[]);
}

/** One status per feature, in document order: built, or the error with its hint (the plain advice where the kernel's text is only a pointer to the field table). */
export function featureStatuses(features: Array<{ id: string }>, errors: ReadonlyArray<readonly [string, { code?: string; params?: Record<string, unknown> }]>, hints: RegenHint[], diag: Diagnosis): FeatureStatus[] {
  const byId = new Map(errors);
  return features.map((f) => {
    const err = byId.get(f.id);
    if (!err) return { id: f.id, ok: true };
    const hint = hints.find((h) => h.feature === f.id && h.code === err.code);
    const root = diag.roots.find((r) => r.id === f.id);
    const text = root && (!hint?.hint || hint.hint.includes('see the features field table')) ? adviceOf(root) : hint?.hint;
    // a reference that no longer resolves: the kernel says which name is gone and what the model has instead (face ids to pick from)
    const own = (err.code === 'missingReference' || err.code === 'missingEdge') && root && typeof err.params?.hint === 'string' ? err.params.hint : '';
    return { id: f.id, ok: false, code: err.code, hint: own ? (text ? `${text} ${own}` : own) : text, params: err.params, blockedBy: diag.blockedBy[f.id] };
  });
}

/** What a regen of the document hands the view, as the Session reports it. */
export interface BuiltReply {
  /** `Session.bodyForView()` */
  body: (ViewBodyLike & { surfaces?: unknown }) | null;
  /** `Session.regenReport()` */
  report: { errors: RegenError[]; hints: RegenHint[]; threads: unknown[]; warnings: unknown[]; surfaces: unknown };
  /** `limits` of a regen reply (only asked for when `mayHaveTip(features)`), else undefined */
  limits?: unknown;
  /** `components` of a regen reply made with `dofReport` */
  components: unknown[];
}
type ViewBodyLike = { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] } };

/** The view of a built document: what the app controller shows after a rebuild. */
export function buildViewData(features: Array<{ id: string; type?: string }>, r: BuiltReply): ViewData {
  const errors = r.report.errors;
  const diag = diagnoseErrors(errors as never, r.report.hints, features);
  return {
    body: shownBody(r.body, features, r.report.surfaces),
    status: featureStatuses(features, errors, r.report.hints, diag),
    extras: { threads: r.report.threads, warnings: r.report.warnings },
    errors,
    diag,
    limits: mayHaveTip(features as never) ? [...limitsOf(r.limits)] : [],
    components: r.components,
  };
}
