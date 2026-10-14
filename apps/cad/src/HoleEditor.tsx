// The Hole editor: Type, Size, End and Options sections with real controls (dropdowns for type, ISO size, fit and end
// condition; the resulting diameter as text) instead of the generic text / number fields. It keeps the look and the
// draft protocol of packages/ui/src/FeatureEditor.tsx: every change goes to onDraft with the whole draft, Enter / the tick
// confirm, Escape / the cross cancel. A draft value of null means "remove this field" (see holeData.ts).
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import {
  CUSTOM, DRILL_TIP_ANGLE, HOLE_ENDS, HOLE_FITS, HOLE_KINDS, ISO_SIZES, KERNEL_CUTS_CUSTOM_DIMS,
  holeDiameter, kindOf, patchEnd, patchFit, patchKind, patchSize, saveHolePrefs, sizeChoice, type HoleEnd, type HoleFit, type HoleKind,
} from './holeData';

type Wire = Record<string, unknown>;

export interface HoleEditorProps {
  feature: Wire | null;
  onDraft(next: Wire): void;
  onConfirm(next: Wire): void;
  onCancel(): void;
  hint?: string | null;
  /**
   * EXTENSION POINT for the `thread` kernel feature: the Thread section's content, shown as its own collapsible section
   * after Options. The thread agent passes its controls here (the editor knows nothing about threads); with no content
   * the section is not drawn. The section gets the hole as it is now (feature with the draft applied) through
   * `threadSection` being a function, so it can read the size.
   */
  threadSection?: JSX.Element | ((hole: Wire) => JSX.Element);
}

function Section(p: { id: string; title: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosed] = useState(false);
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" onClick={() => setClosed(!closed)}>
        <span class="fedit-sec-title">{p.title}</span>
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
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

function Num(p: { name: string; label: string; value: unknown; unit: string; onChange(v: number): void }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <span class="fedit-num">
        <input
          type="number"
          value={String(p.value ?? '')}
          onChange={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            const v = Number(raw);
            if (raw.trim() !== '' && Number.isFinite(v)) p.onChange(v);
          }}
        />
        <span class="fedit-unit">{p.unit}</span>
      </span>
    </label>
  );
}

const fmt = (d: number | null) => (d === null ? '' : String(Math.round(d * 1000) / 1000));

export function HoleEditor(p: HoleEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Wire>({});
  if (!p.feature) return <div class="fedit empty"><div class="fedit-hint">{t('ui.editor.empty', undefined, 'No feature selected.')}</div></div>;
  // the feature with the draft applied; null in the draft = field removed
  const eff: Wire = { ...p.feature, ...draft };
  for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];

  const change = (patch: Wire): void => {
    // removing a field the hole does not have is a no-op: leave it out of the draft
    const real = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || eff[k] !== undefined));
    const next = { ...draft, ...real };
    setDraft(next);
    p.onDraft(next);
  };
  const confirm = (): void => { saveHolePrefs(eff); p.onConfirm(draft); };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };

  const kind = kindOf(eff);
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

      <Section id="size" title={t('hole.section.size')}>
        <Select name="size" label={t('hole.size')} value={choice} options={sizes} onChange={(v) => change(patchSize(eff, v))} />
        {custom ? <Num name="diameter" label={t('hole.diameter')} value={eff.diameter} unit="mm" onChange={(v) => change({ diameter: v })} /> : <>
          <Select name="fit" label={t('hole.fit')} value={fits.includes(eff.fit as HoleFit) ? String(eff.fit) : 'normal'} options={fits.map((f) => [f, t('hole.fit.' + f)])} onChange={(v) => change(patchFit(eff, v as HoleFit))} />
          <div class="fedit-fld" data-path="resultDiameter">
            <span class="fedit-fld-label">{t('hole.resultDiameter')}</span>
            <span class="hole-dia" data-testid="hole-diameter">{dia === null ? t('hole.invalidSize') : `Ø ${fmt(dia)} mm`}</span>
          </div>
        </>}
      </Section>

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

      {thread ? <Section id="thread" title={t('hole.section.thread')}><div class="hole-thread-slot" data-slot="thread">{thread}</div></Section> : null}
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}
