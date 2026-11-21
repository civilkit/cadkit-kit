// The timeline docked along the bottom of the viewport while the Motion tab is open (on a phone: inside the bottom sheet): study, duration, loop, play /
// pause / speed, the scrubber with one track of keyframes per driver, what the study touches, and the clip export. A view of the motion store; the
// ribbon's Motion commands call the same actions.
//
// Keys: a tap on a diamond picks the key and goes to its time; a drag moves it (snapped to a frame); Delete or the Delete key button removes it; the arrow
// keys nudge it (Shift: 0.1 s). A double-click or double-tap on a track keys that driver at that time. Space plays and pauses; Shift+arrows on the scrubber
// jump a second. The sliders follow the playhead, so Key always keys what is on screen.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals-core';
import { numberAttrs } from '@kit/ui';
import { FPS, frameCount, type Ease, type LoopMode } from '@kit/motion';
import { t } from '../i18n';
import { CLIP_FORMATS, type ClipFormat } from './exportClip';
import { problemText } from './MotionPanel';
import type { MotionStore } from './store';
import { useSig } from './useStore';

const fmt = (x: number, d = 4): string => String(+x.toPrecision(d));
const studyProblemText = (code: string): string => {
  switch (code) {
    case 'cancelled': return t('motion.clip.cancelled');
    case 'mp4Unsupported': return t('motion.clip.mp4Unsupported');
    case 'webmUnsupported': return t('motion.clip.webmUnsupported');
    case 'noFrames': case 'noCanvas': case 'failed': return t('motion.clip.failed');
    default: return problemText(code);
  }
};
/** The clip format picked in the timeline (kept across redraws and studies). */
const fmtSig = signal<ClipFormat>('webm');
/** The lane is inset by half a key mark / scrubber thumb, so a key at 0 s or at the end is whole and lines up with the thumb. */
const INSET = 10;
const at = (u: number): string => `calc(${INSET}px + (100% - ${2 * INSET}px) * ${u})`;

const COMPACT = '(max-width: 700px), (max-height: 760px)';
/** A small or short screen: the secondary controls fold into a "More" row so the scrubber and the tracks stay in view. */
function useCompact(): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(COMPACT).matches;
  const [c, set] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(COMPACT);
    const f = () => set(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return c;
}

export function MotionTimeline({ store, hasClip, embedded = false }: { store: MotionStore; hasClip: boolean; embedded?: boolean }): JSX.Element {
  useEffect(() => store.use(), [store]);
  const s = useSig(() => {
    const study = store.study();
    return {
      study, studies: store.studies(), drivers: store.drivers.value, values: store.values.value, time: store.time.value, playing: store.playing.value, speed: store.speed.value, ease: store.ease.value,
      computing: store.computing.value, problem: store.studyProblem.value, exporting: store.exporting.value, exported: store.exported.value, issue: store.solved.value ? store.issue() : null, solved: store.solved.value !== null,
      fmt: fmtSig.value, picked: store.selectedKey.value,
    };
  });
  const study = s.study;
  const drag = useRef<{ mate: string; index: number; lane: HTMLElement } | null>(null);
  const compact = useCompact();
  const box = useRef<HTMLDivElement>(null);
  // as an overlay the timeline starts to the right of the floating left panel (measured: the panel is not one of the overlay system's reserved edges)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || embedded) return;
    const place = () => {
      const panel = document.querySelector('.outliner') as HTMLElement | null;
      const host = el.offsetParent as HTMLElement | null;
      if (!panel || !host) { if (el.style.left) el.style.left = ''; return; }
      const pr = panel.getBoundingClientRect(), hr = host.getBoundingClientRect();
      const left = pr.width > 0 && pr.right > hr.left ? `${Math.max(12, Math.round(pr.right - hr.left + 12))}px` : '';
      if (el.style.left !== left) el.style.left = left;
    };
    place();
    // the panel can open, close or be resized at any time (the app's layout is not ours to watch): look again a few times a second
    const id = window.setInterval(place, 300);
    window.addEventListener('resize', place);
    return () => { window.clearInterval(id); window.removeEventListener('resize', place); };
  }, [embedded]);
  const dropKey = () => { store.deleteSelectedKey(); (box.current?.querySelector('.mtl-scrub') as HTMLElement | null)?.focus(); };
  const issueText = !s.solved || !study ? null
    : !s.issue ? t('motion.study.clear')
    : s.issue.kind === 'solver' ? t('motion.study.solver', { time: s.issue.time })
    : t(s.issue.kind === 'near' ? 'motion.study.near' : 'motion.study.hit', { time: s.issue.time, a: store.nameOf(s.issue.a ?? ''), b: store.nameOf(s.issue.b ?? ''), gap: +(s.issue.distance ?? 0).toFixed(3) });
  const u = (tm: number): number => (study ? Math.max(0, Math.min(1, tm / study.duration)) : 0);
  const timeAt = (lane: HTMLElement, clientX: number): number => {
    const r = lane.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left - INSET) / Math.max(1, r.width - 2 * INSET)));
    return f * (study?.duration ?? 0);
  };
  const needKeys = !study || !study.tracks.length ? t('motion.study.needKeys') : undefined;

  const onKey = (ev: KeyboardEvent) => {
    const el = ev.target as HTMLElement;
    const typing = el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    if (typing) return;
    if (ev.key === ' ' && el.tagName !== 'BUTTON') { ev.preventDefault(); if (s.playing) store.pause(); else void store.play(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && s.picked) { ev.preventDefault(); dropKey(); return; }
    if (el.classList.contains('mtl-scrub') && ev.shiftKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); void store.seek(s.time + (ev.key === 'ArrowRight' ? 1 : -1)); return; }
    if (el.classList.contains('mtl-hit') && s.picked && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      const k = study?.tracks.find((x) => x.driver === s.picked!.mate)?.keys[s.picked.index];
      if (k) store.moveKey(s.picked.mate, s.picked.index, k.t + (ev.key === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 0.1 : 1 / FPS));
    }
  };

  const secondary = study ? (
    <>
      <button class="btn" onClick={() => store.deleteStudy()}>{t('motion.study.delete')}</button>
      <label class="mtl-f"><span>{t('motion.study.duration')}</span><input {...numberAttrs('positive')} type="number" min="0.1" step="any" value={study.duration} aria-label={t('motion.study.duration')} onChange={(ev) => store.setDuration(parseFloat((ev.target as HTMLInputElement).value))} /></label>
      <label class="mtl-f"><span>{t('motion.study.loop')}</span><select value={study.loop} aria-label={t('motion.study.loop')} onChange={(ev) => store.setLoop((ev.target as HTMLSelectElement).value as LoopMode)}>{(['once', 'loop', 'pingpong'] as const).map((m) => <option key={m} value={m}>{t('motion.study.loop.' + m)}</option>)}</select></label>
      <label class="mtl-f"><span>{t('motion.study.ease')}</span><select value={s.ease} aria-label={t('motion.study.ease')} onChange={(ev) => store.setEase((ev.target as HTMLSelectElement).value as Ease)}>{(['inOut', 'linear'] as const).map((m) => <option key={m} value={m}>{t('motion.study.ease.' + m)}</option>)}</select></label>
      <button class="btn" disabled={!s.picked} title={s.picked ? undefined : t('motion.study.pickKey')} onClick={dropKey}>{t('motion.study.deleteKey')}</button>
      {hasClip ? (
        <div class="mtl-group" role="group" aria-label={t('motion.clip.title')}>
          <select value={s.fmt} aria-label={t('motion.clip.format')} disabled={!!s.exporting} onChange={(ev) => { fmtSig.value = (ev.target as HTMLSelectElement).value as ClipFormat; }}>{CLIP_FORMATS.map((f) => <option key={f} value={f}>{t('motion.clip.fmt.' + f)}</option>)}</select>
          <button class="btn" disabled={s.computing || !!s.exporting || !study.tracks.length} title={needKeys} onClick={() => void store.exportClip(fmtSig.value)}>{t('motion.clip.export')}</button>
          {s.exporting ? <span class="mtl-time" role="status">{s.exporting.done} / {s.exporting.of}</span> : null}
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div ref={box} class={'motion-tl' + (embedded ? ' embedded' : '') + (compact ? ' compact' : '')} {...(embedded ? {} : { 'data-ovr-reserve': 'bottom' })} role="region" aria-label={t('motion.study.title')} data-testid="motion-timeline" onKeyDown={onKey}>
      <div class="mtl-pin">
        <div class="mtl-bar">
          {s.studies.length ? <select value={study?.id ?? ''} aria-label={t('motion.study.pick')} onChange={(ev) => store.selectStudy((ev.target as HTMLSelectElement).value)}>{s.studies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : null}
          <button class="btn" onClick={() => store.newStudy()}>{t('motion.study.new')}</button>
          {study ? (
            <>
              <div class="mtl-group" role="group" aria-label={t('motion.study.transport')}>
                {s.playing ? <button class="btn mtl-primary" onClick={() => store.pause()}>{t('motion.study.pause')}</button> : <button class="btn mtl-primary" disabled={s.computing || !study.tracks.length} title={needKeys} onClick={() => void store.play()}>{t('motion.study.play')}</button>}
                <select value={s.speed} aria-label={t('motion.study.speed')} onChange={(ev) => store.setSpeed(parseFloat((ev.target as HTMLSelectElement).value))}>{[0.25, 0.5, 1, 2].map((v) => <option key={v} value={v}>{v}×</option>)}</select>
                <span class="mtl-time">{fmt(s.time, 3)} / {fmt(study.duration, 3)} s{s.computing ? ' ' + t('motion.study.computing') : ''}</span>
                {s.computing || s.exporting ? <button class="btn" onClick={() => store.cancel()}>{t('motion.study.cancel')}</button> : null}
              </div>
              {compact ? <details class="mtl-more"><summary class="btn">{t('motion.study.more')}</summary><div class="mtl-secondary">{secondary}</div></details> : secondary}
            </>
          ) : null}
        </div>
        {study ? (
          <div class="mtl-row mtl-ruler">
            <span class="mtl-label" />
            <div class="mtl-lane">
              <input class="mtl-scrub" type="range" min="0" max={study.duration} step={study.duration / (frameCount(study.duration) - 1)} value={s.time} aria-label={t('motion.study.scrub')} disabled={!study.tracks.length && !(s.drivers?.length)} onInput={(ev) => void store.seek(parseFloat((ev.target as HTMLInputElement).value))} />
              {Array.from({ length: Math.floor(study.duration) + 1 }, (_, i) => <span key={i} class="mtl-tick" style={{ left: at(u(i)) }}>{i}</span>)}
            </div>
          </div>
        ) : null}
      </div>
      {!study ? <div class="mtl-note">{t('motion.study.none')}</div> : (
        <>
          <div class="mtl-tracks">
            {(s.drivers ?? []).map((d) => {
              const track = study.tracks.find((tr) => tr.driver === d.mate);
              const unit = d.unit === 'deg' ? '°' : ' mm';
              return (
                <div class="mtl-row" key={d.mate} data-track={d.mate}>
                  <span class="mtl-label">
                    <span class="mtl-name">{store.label(d.mate)}</span>
                    <button class="btn mtl-key" onClick={() => store.addKey(d.mate)} title={t('motion.study.keyTip')}>{t('motion.study.key', { time: fmt(s.time, 3), value: fmt(s.values[d.mate] ?? 0) + unit })}</button>
                  </span>
                  <div class="mtl-lane" onDblClick={(ev) => { if ((ev.target as HTMLElement).closest('.mtl-hit')) return; store.addKeyAt(d.mate, timeAt(ev.currentTarget as HTMLElement, ev.clientX)); }}>
                    {track?.keys.map((k, i) => {
                      const on = s.picked?.mate === d.mate && s.picked.index === i;
                      return (
                        <button key={i} class={'mtl-hit' + (on ? ' on' : '')} data-key aria-pressed={on} style={{ left: at(u(k.t)) }} title={`${fmt(k.t, 3)} s: ${fmt(k.v)}${unit}`} aria-label={t('motion.study.go', { time: k.t })}
                          onPointerDown={(ev) => {
                            const lane = (ev.currentTarget as HTMLElement).parentElement!;
                            (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
                            drag.current = { mate: d.mate, index: i, lane };
                          }}
                          onPointerMove={(ev) => { const g = drag.current; if (g && g.mate === d.mate && ev.buttons) { g.index = store.moveKey(d.mate, g.index, timeAt(g.lane, ev.clientX)); } }}
                          onPointerUp={() => { drag.current = null; }}
                          onClick={() => store.selectKey(d.mate, i)}><span class="mtl-dot" /></button>
                      );
                    })}
                    <span class="mtl-head" style={{ left: at(u(s.time)) }} />
                  </div>
                </div>
              );
            })}
          </div>
          {issueText ? <div class="mtl-note" role="status" data-issue>{issueText}</div> : null}
          {s.problem ? <div class="mtl-note mtl-bad" role="alert">{studyProblemText(s.problem)}</div> : null}
          {s.exported ? <div class="mtl-note" role="status" data-exported>{t('motion.clip.saved', { file: s.exported })}</div> : null}
          {!study.tracks.length ? <div class="mtl-note">{t('motion.study.howto')}</div> : null}
        </>
      )}
    </div>
  );
}
