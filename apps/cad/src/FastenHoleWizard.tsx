// "Fasten this hole": the panel. The hole is read off the part (fastenHole.ts); type, size and length start from it (fasten.ts) and the panel says how they were
// matched. Washer and nut choices, the head end of a plain through hole, and which of the other holes are fastened too (identical holes on the same plane, other
// selected holes, the holes of the pattern). Every change goes to onDraft with the resolved targets (the app previews them live, debounced by the controller);
// Add fasteners commits them as one folder and one undo step, Escape / the cross cancels.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import type { FastenHole } from './fastenHole';
import {
  autoLength, BOLT_SIZES, BOLT_TYPES, defaultParams, effectiveParams, groupsFor, matchSize, nutAllowed, planHole, resolveTargets, STANDARD_LENGTHS,
  type FastenParams, type FastenScope, type FastenTarget, type WasherChoice,
} from './fasten';

export interface FastenHoleWizardProps {
  /** the face of the picked hole (any wall of it) */
  pick: string;
  /** every hole of the part, read with its default head end */
  all: FastenHole[];
  /** read a hole again with the head on the other end (a plain through hole); null when the face is no hole */
  read(face: string, flip: boolean): FastenHole | null;
  /** the other holes selected in the view, and the holes of the pattern the picked one belongs to */
  selected?: FastenHole[];
  pattern?: FastenHole[];
  onDraft(targets: FastenTarget[]): void;
  onApply(targets: FastenTarget[]): void;
  onCancel(): void;
  /** The live preview's failure, or null when it is current. */
  hint?: string | null;
}

const g = (n: number): string => String(Math.round(n * 100) / 100);

export function FastenHoleWizard(p: FastenHoleWizardProps): JSX.Element {
  const first = useMemo(() => p.read(p.pick, false) ?? p.all.find((h) => h.face === p.pick) ?? p.all[0], [p.pick]);
  const [flip, setFlip] = useState(false);
  const ref = useMemo(() => (flip ? p.read(p.pick, true) ?? first : first), [flip, p.pick]);
  const [params, setParams] = useState<FastenParams>(() => defaultParams(first));
  const all = useMemo(() => (flip ? p.all.map((h) => (h.bothOpen ? p.read(h.face, true) ?? h : h)) : p.all), [flip, p.all]);
  const groups = useMemo(() => groupsFor(ref, all, p.selected ?? [], p.pattern ?? []), [ref, all, p.selected, p.pattern]);
  const [scope, setScope] = useState<FastenScope>({ identical: groups.identical.length > 0, selected: true, pattern: true });

  const match = matchSize(ref.diameter);
  const nutWhy = nutAllowed(ref);
  const eff = effectiveParams(ref, params);
  const auto = autoLength(ref, eff);
  const targets = useMemo(() => resolveTargets(ref, eff, groups, scope), [ref, JSON.stringify(eff), groups, scope.identical, scope.selected, scope.pattern]);
  const issues = targets.flatMap((x, i) => planHole(x.hole, x.params).issues.map((is) => ({ ...is, i })));
  const issue = issues[0] ?? null;
  const key = JSON.stringify([targets.map((x) => [x.hole.face, x.hole.seat, x.hole.out, x.params])]);
  useEffect(() => { if (!issue) p.onDraft(targets); }, [key]);

  const change = (patch: Partial<FastenParams>): void => setParams({ ...params, ...patch });
  const apply = (): void => { if (!issue) p.onApply(targets); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  const count = targets.length;
  const matchText = match.exact
    ? t(match.fit === 'tap' ? 'fasten.match.tap' : 'fasten.match.clearance', { size: match.size, diameter: g(match.diameter), reference: g(match.reference) })
    : t('fasten.match.nearest', { size: match.size, fit: t('fasten.fit.' + match.fit), diameter: g(match.diameter), delta: g(Math.abs(match.diameter - match.reference)) });
  const holeLine = t('fasten.holeLine', { kind: t('fasten.kind.' + ref.kind), diameter: g(ref.diameter), depth: ref.through ? t('fasten.depth.through', { thickness: g(ref.thickness) }) : t('fasten.depth.blind', { depth: g(ref.thickness) }) });
  const field = (path: string, label: string, body: JSX.Element, tip?: string): JSX.Element => (
    <label class="fedit-fld" data-path={path} title={tip}><span class="fedit-fld-label">{label}</span>{body}</label>
  );
  const check = (path: string, label: string, on: boolean, set: (v: boolean) => void, tip?: string): JSX.Element => (
    <label class="fedit-fld fasten-check" data-path={path} title={tip}>
      <input type="checkbox" checked={on} onChange={(e) => set((e.currentTarget as HTMLInputElement).checked)} aria-label={label} />
      <span class="fedit-fld-label">{label}</span>
    </label>
  );
  const nIdent = groups.identical.length, nSel = groups.selected.length, nPat = groups.pattern.length;
  return (
    <div class="fedit thread-editor prop-wizard screw-wizard fasten-wizard" tabIndex={0} onKeyDown={onKey} data-testid="fasten-wizard">
      <div class="fedit-head">
        <Icon name="fasten-hole" size={22} class="fedit-icon" />
        <div class="fedit-title">{t('fasten.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <div class="thread-hint" data-testid="fasten-hole">{holeLine}</div>
        {field('type', t('fasten.type'), (
          <select value={params.type} aria-label={t('fasten.type')} title={t('fasten.typeFrom.' + ref.kind)} onChange={(e) => change({ type: (e.currentTarget as HTMLSelectElement).value as FastenParams['type'] })}>
            {BOLT_TYPES.map((v) => <option key={v} value={v}>{t('fasten.type.' + v)}</option>)}
          </select>
        ))}
        <div class="thread-hint" data-testid="fasten-type-why">{t('fasten.typeFrom.' + ref.kind)}</div>
        {field('size', t('fasten.size'), (
          <select value={params.size} aria-label={t('fasten.size')} onChange={(e) => change({ size: (e.currentTarget as HTMLSelectElement).value })}>
            {BOLT_SIZES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <div class={'thread-hint' + (match.exact ? '' : ' warn')} data-testid="fasten-match" data-fit={match.fit}>{matchText}</div>
        {field('length', t('fasten.length'), (
          <span class="fedit-num">
            <input type="number" inputMode="decimal" enterKeyHint="done" step="any" min={1} list="fasten-lengths" value={String(params.length ?? auto)} aria-label={t('fasten.length')}
              onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v) && v > 0) change({ length: v === auto ? null : v }); }} />
            <datalist id="fasten-lengths">{STANDARD_LENGTHS.map((l) => <option key={l} value={l} />)}</datalist>
            <span class="fedit-unit">mm</span>
            {params.length !== null ? <button type="button" class="fedit-card-btn" data-testid="fasten-length-auto" onClick={() => change({ length: null })}>{t('fasten.lengthReset')}</button> : null}
          </span>
        ))}
        <div class="thread-hint" data-testid="fasten-length-why">
          {params.length === null
            ? t(ref.through ? 'fasten.lengthAuto' : 'fasten.lengthAutoBlind', { length: auto, grip: g(ref.grip) })
            : t('fasten.lengthCustom', { length: auto })}
        </div>
        {field('washer', t('fasten.washer'), (
          <select value={eff.washer} aria-label={t('fasten.washer')} disabled={ref.kind === 'csink'} onChange={(e) => change({ washer: (e.currentTarget as HTMLSelectElement).value as WasherChoice })}>
            <option value="none">{t('fasten.washer.none')}</option>
            <option value="head">{t('fasten.washer.head')}</option>
            <option value="both" disabled={!eff.nut}>{t('fasten.washer.both')}</option>
          </select>
        ))}
        {field('nut', t('fasten.nut'), (
          <select value={eff.nut ? 'hex' : 'none'} aria-label={t('fasten.nut')} disabled={nutWhy !== null} onChange={(e) => change({ nut: (e.currentTarget as HTMLSelectElement).value === 'hex' })}>
            <option value="none">{t('fasten.nut.none')}</option>
            <option value="hex">{t('fasten.nut.hex')}</option>
          </select>
        ))}
        {nutWhy ? <div class="thread-hint" data-testid="fasten-nut-why">{t(nutWhy === 'blind' ? 'fasten.nutWhy.blind' : 'fasten.nutWhy.tap')}</div> : null}
        {ref.bothOpen ? check('flip', t('fasten.flip'), flip, setFlip, t('fasten.flipTip')) : null}
        {nIdent + nSel + nPat > 0 ? <div class="thread-hint">{t('fasten.scope')}</div> : null}
        {nIdent > 0 ? check('identical', t(nIdent === 1 ? 'fasten.scope.identical1' : 'fasten.scope.identical', { count: nIdent }), scope.identical, (v) => setScope({ ...scope, identical: v }), t('fasten.scope.identicalTip')) : null}
        {nSel > 0 ? check('selected', t(nSel === 1 ? 'fasten.scope.selected1' : 'fasten.scope.selected', { count: nSel }), scope.selected, (v) => setScope({ ...scope, selected: v })) : null}
        {nPat > 0 ? check('pattern', t(nPat === 1 ? 'fasten.scope.pattern1' : 'fasten.scope.pattern', { count: nPat }), scope.pattern, (v) => setScope({ ...scope, pattern: v })) : null}
        <div class="thread-hint" data-testid="fasten-count" data-count={count}>{count > 1 ? t('fasten.scope.total', { count }) : t('fasten.scope.one')}</div>
        {issue ? <div class="thread-fit bad" role="alert" data-issue={issue.code}>{t('fasten.issue.' + issue.code, { ...issue.params, message: issue.message }, issue.message)}</div> : null}
        {p.hint ? <div class="fedit-hint" role="alert" data-testid="fasten-hint">{p.hint}</div> : null}
      </div>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="fasten-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="fasten-apply" disabled={!!issue} aria-disabled={!!issue} title={issue ? t('fasten.blockedTip') : t('fasten.applyTip')} onClick={apply}>{t('fasten.apply')}</button>
      </div>
    </div>
  );
}
