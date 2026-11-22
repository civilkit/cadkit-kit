import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './i18n';
import { Icon } from './icons';

/** Playback speeds: features per second. */
export const PLAY_SPEEDS = [1, 2, 4, 8] as const;

/** The marker position after one step: `at` is the features the model shows (null = all of `total`). Starting from the end restarts from the first feature. Null when it has reached the end. */
export function nextStep(at: number | null, total: number): number | null {
  if (total <= 0) return null;
  const cur = at === null || at >= total ? 0 : at;
  const n = cur + 1;
  return n >= total ? null : n;
}

/** Play the history: the rollback marker steps through the features one at a time, then stops at the end.
 *  A step waits for the previous rebuild to finish, so a slow model plays slower, never piles up. */
export function HistoryPlayer(p: { total: number; rollback: number | null; onRollback(count: number | null): unknown }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(2);
  const at = useRef(p.rollback);
  at.current = p.rollback;
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    if (!playing) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const { total, onRollback } = live.current;
      const n = nextStep(at.current, total);
      try { await onRollback(n); } catch { dead = true; }
      if (dead) return;
      at.current = n;   // the prop may not have re-rendered yet
      if (n === null) { setPlaying(false); return; }
      timer = setTimeout(() => void tick(), 1000 / speed);
    };
    void tick();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [playing, speed]);

  if (p.total < 2) return null;
  const label = playing ? t('ui.history.pause', undefined, 'Pause') : t('ui.history.play', undefined, 'Play the history');
  return (
    <div class="hist-play" role="group" aria-label={t('ui.history.playback', undefined, 'History playback')}>
      <button type="button" class={'tree-search-btn' + (playing ? ' on' : '')} data-testid="hist-play" aria-pressed={playing} title={label} aria-label={label}
        onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} size={15} /></button>
      <select class="hist-speed" aria-label={t('ui.history.speed', undefined, 'Playback speed')} value={String(speed)}
        onChange={(e) => setSpeed(Number((e.currentTarget as HTMLSelectElement).value))}>
        {PLAY_SPEEDS.map((s) => <option key={s} value={String(s)}>{s} / s</option>)}
      </select>
    </div>
  );
}
