// The Motion list in the left panel: a slider per drivable mate, the clearance, Find limits with what it found, what the pose on screen touches, Reset.
// The studies and the clip export live in the timeline along the bottom of the viewport (MotionTimeline). A view of the motion store.
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { numberAttrs } from '@kit/ui';
import { poseProblem, rangeOf } from '@kit/motion';
import { t } from '../i18n';
import type { PluginJointEntry } from '../pluginMotion';
import type { MotionStore } from './store';
import { useSig } from './useStore';

const fmt = (x: number, d = 4): string => String(+x.toPrecision(d));
export const problemText = (code: string): string => (code === 'noKernel' ? t('motion.noKernel') : poseProblem(code));

export interface MotionPanelProps {
  store: MotionStore;
  pluginJoints?: readonly PluginJointEntry[];
  pluginJointValues?: Readonly<Record<string, number>>;
  onPluginJointChange?(id: string, value: number): void;
  onPluginJointReset?(): void;
}

export function MotionPanel({ store, pluginJoints, pluginJointValues, onPluginJointChange, onPluginJointReset }: MotionPanelProps): JSX.Element {
  useEffect(() => store.use(), [store]);
  const s = useSig(() => ({
    drivers: store.drivers.value, values: store.values.value, motion: store.motion.value, found: store.found.value, finding: store.finding.value, clearance: store.clearance.value,
    problem: store.problem.value, contact: store.contact.value, posed: store.pose.value !== null,
    contactSets: store.contactSets(), parts: store.parts(), stopOnContact: store.stopOnContact.value, activeContact: store.activeContact.value,
  }));
  const say = (sw: Parameters<MotionStore['stopWords']>[0], unit: string): string => { const d = store.stopWords(sw, unit); return t(d.key, d.params); };
  const badge = s.activeContact ?? (s.contact ? { bodyA: s.contact.a, bodyB: s.contact.b } : null);
  return (
    <div class="asm-sec motion-panel">
      <section class="asm-card" aria-label={t('motion.title')}>
        <h4>{t('motion.title')}</h4>
        {s.drivers === null ? <div class="empty">{t('motion.loading')}</div>
          : !s.drivers.length ? <div class="empty">{t('motion.none')}</div>
          : (
            <>
              <label class="asm-f wide" title={t('motion.clearanceTip')}><span>{t('motion.clearance')}</span>
                <input {...numberAttrs('positive')} type="number" min="0" step="any" value={s.clearance} aria-label={t('motion.clearance')} onChange={(ev) => store.setClearance(parseFloat((ev.target as HTMLInputElement).value))} /></label>
              {s.drivers.map((d) => {
                const r = rangeOf(d, s.motion.drivers);
                const v = s.values[d.mate] ?? 0;
                const u = d.unit === 'deg' ? '°' : ' mm';
                const f = s.found[d.mate];
                return (
                  <div class="asm-f wide" key={d.mate} data-driver={d.mate}>
                    <span class="mtl-num">{store.label(d.mate)} ({v.toFixed(d.kind === 'angle' ? 1 : 2)}{u})</span>
                    <input type="range" min={r.min} max={r.max} step={d.kind === 'angle' ? 1 : 0.5} value={v} aria-label={store.label(d.mate)} onInput={(ev) => store.setValue(d.mate, parseFloat((ev.target as HTMLInputElement).value))} />
                    <input {...numberAttrs('signed')} type="number" step="any" value={v} aria-label={t('motion.value')} onInput={(ev) => store.setValue(d.mate, parseFloat((ev.target as HTMLInputElement).value))} />
                    <label class="asm-f"><span>{t('motion.min')}</span><input {...numberAttrs('signed')} type="number" step="any" value={r.min} aria-label={t('motion.min')} onChange={(ev) => store.setRange(d.mate, { min: parseFloat((ev.target as HTMLInputElement).value) })} /></label>
                    <label class="asm-f"><span>{t('motion.max')}</span><input {...numberAttrs('signed')} type="number" step="any" value={r.max} aria-label={t('motion.max')} onChange={(ev) => store.setRange(d.mate, { max: parseFloat((ev.target as HTMLInputElement).value) })} /></label>
                    <div class="asm-bar">
                      <button class="btn" disabled={s.finding !== null} onClick={() => void store.findLimits(d.mate)}>{s.finding === d.mate ? t('motion.finding') : t('motion.find')}</button>
                      <button class="btn" disabled={!f?.min || !f.max} onClick={() => store.useAsRange(d.mate)} title={t('motion.useRangeTip')}>{t('motion.useRange')}</button>
                      <button class="btn" onClick={() => void store.copyToLimits(d.mate).then((why) => { store.problem.value = why ? 'limitsFailed' : null; })} title={t('motion.toLimitsTip')}>{t('motion.toLimits')}</button>
                    </div>
                    {f ? (
                      <div class="asm-note" role="status" data-found={d.mate}>
                        {f.min ? <div><b>{t('motion.min')} {fmt(f.min.reached)}{u}</b>: {say(f.min, u)} {f.min.stop.reason === 'contact' ? <button class="btn" onClick={() => store.show([f.min!.stop.a ?? '', f.min!.stop.b ?? ''])}>{t('motion.show')}</button> : null}</div> : null}
                        {f.max ? <div><b>{t('motion.max')} {fmt(f.max.reached)}{u}</b>: {say(f.max, u)} {f.max.stop.reason === 'contact' ? <button class="btn" onClick={() => store.show([f.max!.stop.a ?? '', f.max!.stop.b ?? ''])}>{t('motion.show')}</button> : null}</div> : null}
                        {[f.min, f.max].some((x) => x?.startContacts.length) ? <div>{t('motion.startContacts')}</div> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
        {s.problem ? <div class="asm-note" role="alert">{s.problem === 'limitsFailed' ? t('motion.limitsFailed') : problemText(s.problem)}</div> : null}
        {s.contact ? (
          <div class="asm-note" role="alert" data-contact>
            {t(s.contact.kind === 'near' ? 'motion.touch.near' : 'motion.touch.contact', { a: store.nameOf(s.contact.a), b: store.nameOf(s.contact.b), gap: +s.contact.distance.toFixed(3) })}{' '}
            <button class="btn" onClick={() => store.show([s.contact!.a, s.contact!.b])}>{t('motion.show')}</button>
          </div>
        ) : null}
        <div class="asm-bar"><button class="btn" disabled={!s.posed && !Object.keys(s.values).length} onClick={() => store.reset()}>{t('motion.reset')}</button></div>
        {s.posed ? <div class="asm-note" role="status">{t('motion.banner')}</div> : null}
        <div class="asm-note">{t('motion.note')}</div>
        <div class="asm-note">{t('motion.timelineHint')}</div>
      </section>
      <section class="asm-card" aria-label={t('motion.contactSets.title')} data-testid="contact-sets-card" data-contact-sets>
        <h4>{t('motion.contactSets.title')}</h4>
        <label class="asm-chk">
          <input type="checkbox" checked={s.stopOnContact} aria-label={t('motion.contactSets.stopOnContact')} data-testid="stop-on-contact" onChange={(ev) => store.setStopOnContact((ev.target as HTMLInputElement).checked)} />{' '}
          {t('motion.contactSets.stopOnContact')}
        </label>
        <div class="asm-bar">
          <button class="btn" data-testid="add-contact-set" onClick={() => store.addContactSet()}>{t('motion.contactSets.add')}</button>
        </div>
        {s.contactSets.length === 0 ? <div class="asm-note">{t('motion.contactSets.empty')}</div> : null}
        {s.contactSets.map((cs) => (
          <div class="asm-card inner" key={cs.id} data-contact-set={cs.id} data-testid={`contact-set-${cs.id}`}>
            <div class="asm-row">
              <label class="asm-chk">
                <input type="checkbox" checked={cs.enabled} aria-label={t('motion.contactSets.enable', { name: cs.name })} data-testid={`contact-set-enabled-${cs.id}`} onChange={(ev) => store.setContactSetEnabled(cs.id, (ev.target as HTMLInputElement).checked)} />{' '}
                <span class="row-name">{cs.name}</span>
              </label>
              <span class="asm-acts">
                <button class="row-act on del" title={t('motion.contactSets.remove')} aria-label={t('motion.contactSets.removeSet', { name: cs.name })} data-testid={`remove-contact-set-${cs.id}`} onClick={() => store.removeContactSet(cs.id)}>×</button>
              </span>
            </div>
            <div class="asm-members" role="group" aria-label={t('motion.contactSets.members')}>
              {s.parts.map((partId) => {
                const partName = store.nameOf(partId);
                const active = cs.memberIds.includes(partId);
                return (
                  <label class="asm-chk" key={partId} data-member={partId}>
                    <input type="checkbox" checked={active} aria-label={partName} data-testid={`contact-set-member-${cs.id}-${partId}`} onChange={() => store.toggleContactSetMember(cs.id, partId)} />{' '}
                    {partName}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        {badge ? (
          <div class="asm-note" role="status" data-testid="active-contact-badge" data-contact-badge>
            {t('motion.contactSets.badge', { a: store.nameOf(badge.bodyA), b: store.nameOf(badge.bodyB) })}
          </div>
        ) : null}
      </section>
      {pluginJoints && pluginJoints.length > 0 ? (
        <section class="asm-card" aria-label={t('motion.plugin.title')} data-testid="plugin-joints-card">
          <h4>{t('motion.plugin.title')}</h4>
          {pluginJoints.map((entry) => {
            const { joint } = entry;
            const v = pluginJointValues?.[entry.id] ?? 0;
            const u = joint.kind === 'revolute' ? '°' : ' mm';
            return (
              <div class="asm-f wide" key={entry.id} data-plugin-joint={entry.id}>
                <span>{entry.group} · {joint.name} ({fmt(v)}{u})</span>
                <input type="range" min={joint.min} max={joint.max} step={joint.kind === 'revolute' ? 1 : 0.5} value={v} aria-label={`${entry.group} ${joint.name}`} onInput={(ev) => onPluginJointChange?.(entry.id, parseFloat((ev.target as HTMLInputElement).value))} />
                <input {...numberAttrs('signed')} type="number" step="any" value={v} aria-label={t('motion.value')} onInput={(ev) => onPluginJointChange?.(entry.id, parseFloat((ev.target as HTMLInputElement).value))} />
              </div>
            );
          })}
          <div class="asm-bar">
            <button class="btn" disabled={!Object.values(pluginJointValues ?? {}).some((v) => Math.abs(v) > 1e-9)} onClick={() => onPluginJointReset?.()}>{t('motion.plugin.reset')}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
