// The Hole editor: Type, Size (with the Threaded toggle and thread picker), Thread options, End and Options sections with real controls (dropdowns for type, ISO size, fit and end
// condition; the resulting diameter as text) instead of the generic text / number fields. It keeps the look and the
// draft protocol of packages/ui/src/FeatureEditor.tsx: every change goes to onDraft with the whole draft, Enter / the tick
// confirm, Escape / the cross cancel. A draft value of null means "remove this field" (see holeData.ts).
import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { EditorSection as Section, ExprInput, Icon } from '@kit/ui';
import { t } from './i18n';
import { HoleThreadOptions, HoleThreadPick, threadOptionsSummary, useHoleThread, type HoleThreadApi } from './HoleThreadSection';
import { canThreadHole, capLength, threadCfgOf, threadMaxLength, type HoleThread } from './holeThread';
import {
  CUSTOM, DRILL_TIP_ANGLE, HOLE_ENDS, HOLE_FITS, HOLE_KINDS, ISO_SIZES, KERNEL_CUTS_CUSTOM_DIMS,
  holeDiameter, kindOf, patchEnd, patchFit, patchKind, patchSize, saveHolePrefs, sizeChoice, type HoleEnd, type HoleFit, type HoleKind,
} from './holeData';

type Wire = Record<string, unknown>;

export interface HoleEditorProps {
  feature: Wire | null;
  /** `thread` is the thread the draft wants on the hole's walls (null: none); undefined when the editor has no thread support (no `threads`). */
  onDraft(next: Wire, thread?: HoleThread | null): void;
  onConfirm(next: Wire, thread?: HoleThread | null): void;
  onCancel(): void;
  hint?: string | null;
  /** A refused size the kernel named the largest working value of (`maxSize`): the sentence saying it and a button that puts it in the field. */
  fix?: { note: string; label: string; path: string; value: unknown } | null;
  /** The thread features linked to this hole (one per position), if any: the Threaded box starts checked with the first one's settings. */
  linked?: Wire[];
  /** Thread tables and what the part shows for the thread; without it the editor has no Threaded option. */
  threads?: HoleThreadApi;
  /**
   * EXTENSION POINT for the `thread` kernel feature: the Thread section's content, shown as its own collapsible section
   * after Options. The thread agent passes its controls here (the editor knows nothing about threads); with no content
   * the section is not drawn. The section gets the hole as it is now (feature with the draft applied) through
   * `threadSection` being a function, so it can read the size.
   */
  threadSection?: JSX.Element | ((hole: Wire) => JSX.Element | null | undefined);
}

function Select(p: { name: string; label: string; value: string; options: Array<[string, string]>; onChange(v: string): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Num(p: { name: string; label: string; value: unknown; unit: string; onChange(v: number | string): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <ExprInput value={typeof p.value === 'number' || typeof p.value === 'string' ? p.value : ''} unit={p.unit} label={p.label} onValue={p.onChange} />
      </span>
    </label>
  );
}

const NO_THREADS: HoleThreadApi = { loadStandards: async () => [], loadSizes: async () => [] };
const fmt = (d: number | null) => (d === null ? '' : String(Math.round(d * 1000) / 1000));

export function HoleEditor(p: HoleEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Wire>({});
  const [th, setTh] = useState<HoleThread | null>(() => (p.linked?.length ? threadCfgOf(p.linked[0]) : null));
  const eff0: Wire = { ...(p.feature ?? {}), ...draft };
  for (const k of Object.keys(eff0)) if (eff0[k] === null) delete eff0[k];
  const applyRef = useRef<(patch: Wire, thread: HoleThread | null) => void>(() => {});
  const ts = useHoleThread({ api: p.threads ?? NO_THREADS, hole: eff0, th, onApply: (patch, next) => applyRef.current(patch, next) });
  if (!p.feature) return <div class="fedit empty"><div class="fedit-hint">{t('ui.editor.empty', undefined, 'No feature selected.')}</div></div>;
  // the feature with the draft applied; null in the draft = field removed
  const eff: Wire = { ...p.feature, ...draft };
  for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];

  // one draft carries the hole and its thread: a thread patch can change the hole (tap drill) and a hole patch the thread (length cap)
  const apply = (patch: Wire, thread: HoleThread | null = th): void => {
    // removing a field the hole does not have is a no-op: leave it out of the draft
    const real = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || eff[k] !== undefined));
    const next = { ...draft, ...real };
    const after: Wire = { ...p.feature!, ...next };
    for (const k of Object.keys(after)) if (after[k] === null) delete after[k];
    // a thread needs a plain hole; a blind hole caps its length at the depth
    const t2 = thread && canThreadHole(after) ? capLength(thread, threadMaxLength(after, p.threads?.wallLength ?? null)) : null;
    setDraft(next);
    setTh(t2);
    p.onDraft(next, p.threads ? t2 : undefined);
  };
  applyRef.current = (patch, next) => apply(patch, next);
  const change = (patch: Wire): void => apply(patch);
  const confirm = (): void => { saveHolePrefs(eff); p.onConfirm(draft, p.threads ? th : undefined); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };

  const kind = kindOf(eff);
  const threaded = p.threads !== undefined && th !== null;
  const choice = sizeChoice(eff);
  const custom = choice === CUSTOM;
  const end = (HOLE_ENDS as string[]).includes(String(eff.end)) ? String(eff.end) : 'through';
  const dia = holeDiameter(eff);
  const sizes: Array<[string, string]> = ISO_SIZES.map((s) => [s, s]);
  if (!ISO_SIZES.includes(choice) && choice !== CUSTOM) sizes.unshift([choice, choice]);   // keep an unknown size visible (the kernel reports it)
  if (kind === 'simple') sizes.push([CUSTOM, t('hole.size.custom')]);
  const fits = HOLE_FITS.filter((f) => f !== 'tap' || kind === 'simple');
  const thread = typeof p.threadSection === 'function' ? p.threadSection(eff) : p.threadSection;
  const title = t('feature.hole') + (p.feature.name ? ` — ${String(p.feature.name)}` : '');

  return (
    <div class="fedit hole-editor" data-feature={String(p.feature.id ?? '')} tabIndex={0} onKeyDown={onKey}>
      <div class="fedit-head">
        <Icon name="add-hole" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-confirm" onClick={confirm} title={t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>

      <Section id="type" title={t('hole.section.type')}>
        <Select name="kind" label={t('hole.type')} value={kind} options={HOLE_KINDS.map((k) => [k, t('hole.type.' + k)])} onChange={(v) => change(patchKind(eff, v as HoleKind))} />
        {kind === 'cbore' ? <>
          <Num name="cboreDiameter" label={t('hole.cboreDiameter')} value={eff.cboreDiameter} unit="mm" onChange={(v) => change({ cboreDiameter: v })} />
          <Num name="cboreDepth" label={t('hole.cboreDepth')} value={eff.cboreDepth} unit="mm" onChange={(v) => change({ cboreDepth: v })} />
        </> : null}
        {kind === 'csink' ? <>
          <Num name="cskDiameter" label={t('hole.cskDiameter')} value={eff.cskDiameter} unit="mm" onChange={(v) => change({ cskDiameter: v })} />
          <Num name="cskAngle" label={t('hole.cskAngle')} value={eff.cskAngle} unit="°" onChange={(v) => change({ cskAngle: v })} />
        </> : null}
        {kind !== 'simple' && !KERNEL_CUTS_CUSTOM_DIMS ? <div class="fedit-shapes-note" data-note="dims">{t(kind === 'cbore' ? 'hole.note.cbore' : 'hole.note.csink')}</div> : null}
      </Section>

      <Section id="size" title={t('hole.section.size')} summary={threaded && th ? `${th.size} · ${th.standard}` : `${choice} · Ø ${dia === null ? '?' : fmt(dia)}`}>
        {p.threads ? <HoleThreadPick s={ts} /> : null}
        {threaded ? null : <>
          <Select name="size" label={t('hole.size')} value={choice} options={sizes} onChange={(v) => change(patchSize(eff, v))} />
          {custom ? <Num name="diameter" label={t('hole.diameter')} value={eff.diameter} unit="mm" onChange={(v) => change({ diameter: v })} /> : <>
            <Select name="fit" label={t('hole.fit')} value={fits.includes(eff.fit as HoleFit) ? String(eff.fit) : 'normal'} options={fits.map((f) => [f, t('hole.fit.' + f)])} onChange={(v) => change(patchFit(eff, v as HoleFit))} />
            <div class="fedit-fld" data-path="resultDiameter">
              <span class="fedit-fld-label">{t('hole.resultDiameter')}</span>
              <span class="hole-dia" data-testid="hole-diameter">{dia === null ? t('hole.invalidSize') : `Ø ${fmt(dia)} mm`}</span>
            </div>
          </>}
        </>}
      </Section>

      {threaded && th ? <Section id="thread" title={t('hole.section.thread')} summary={threadOptionsSummary(th)}><HoleThreadOptions s={ts} /></Section> : null}

      <Section id="end" title={t('hole.section.end')}>
        <Select name="end" label={t('hole.end')} value={end} options={HOLE_ENDS.map((e) => [e, t('hole.end.' + e)])} onChange={(v) => change(patchEnd(eff, v as HoleEnd))} />
        {end === 'blind' ? <Num name="depth" label={t('hole.depth')} value={eff.depth} unit="mm" onChange={(v) => change({ depth: v })} /> : null}
      </Section>

      <Section id="options" title={t('hole.section.options')}>
        {end === 'blind' ? (
          <label class="fedit-fld bool" data-path="tip">
            <input type="checkbox" checked={Boolean(eff.tip)} onChange={(e) => change({ tip: (e.currentTarget as HTMLInputElement).checked })} />
            <span class="fedit-fld-label">{t('hole.tip', { angle: DRILL_TIP_ANGLE })}</span>
          </label>
        ) : null}
        <label class="fedit-fld bool" data-path="flip">
          <input type="checkbox" checked={Boolean(eff.flip)} onChange={(e) => change({ flip: (e.currentTarget as HTMLInputElement).checked })} />
          <span class="fedit-fld-label">{t('hole.flip')}</span>
        </label>
      </Section>

      {thread && !p.threads ? <Section id="thread" title={t('hole.section.thread')}><div class="hole-thread-slot" data-slot="thread">{thread}</div></Section> : null}
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
      {p.fix ? (
        <div class="fedit-fix">
          <p class="fedit-fix-note">{p.fix.note}</p>
          <button type="button" class="btn diag-fix" data-fix="maxSize" onClick={() => change({ [p.fix!.path]: p.fix!.value })}>{p.fix.label}</button>
        </div>
      ) : null}
    </div>
  );
}
