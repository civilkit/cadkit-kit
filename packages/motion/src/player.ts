// The transport of a study: a play clock that maps to a frame of the solved study, with play, pause, seek, speed and the loop modes. The
// scheduler and the clock are passed in (requestAnimationFrame and performance.now in the app, fakes in tests).
import { frameAt, studyTime, type LoopMode } from './studies';

export interface PlayerOpts {
  frames: number;
  duration: number;
  loop: LoopMode;
  /** Show frame `i` (study time `t`); `pos` is the position between frames (i.e. 12.4 is 40 % of the way from frame 12 to 13) for a view that blends them. */
  show(i: number, t: number, pos: number): void;
  /** Called when a `once` study reaches its end. */
  onEnd?(): void;
  schedule(cb: () => void): () => void;
  now(): number;
}

export interface Player {
  play(): void;
  pause(): void;
  /** Jump to study time `t` (seconds), playing or not. */
  seek(t: number): void;
  setSpeed(s: number): void;
  readonly playing: boolean;
  /** Study time now. */
  readonly time: number;
}

export function createPlayer(o: PlayerOpts): Player {
  let clock = 0; // seconds of play (ping-pong and loop go past the duration)
  let speed = 1;
  let playing = false;
  let last = 0;
  let cancel: (() => void) | null = null;
  const at = () => studyTime(clock, o.duration, o.loop);
  const draw = () => { const t = at(); o.show(frameAt(t, o.frames, o.duration), t, o.duration > 0 && o.frames > 1 ? Math.max(0, Math.min(o.frames - 1, (t / o.duration) * (o.frames - 1))) : 0); };
  const tick = () => {
    if (!playing) return;
    const n = o.now();
    clock += ((n - last) / 1000) * speed;
    last = n;
    draw();
    if (o.loop === 'once' && clock >= o.duration) { playing = false; cancel = null; o.onEnd?.(); return; }
    cancel = o.schedule(tick);
  };
  return {
    play() {
      if (playing) return;
      if (o.loop === 'once' && clock >= o.duration) clock = 0;
      playing = true;
      last = o.now();
      cancel = o.schedule(tick);
    },
    pause() { playing = false; cancel?.(); cancel = null; },
    seek(t) {
      clock = Math.max(0, Math.min(o.duration, t));
      last = o.now();
      draw();
    },
    setSpeed(s) { if (s > 0) speed = s; },
    get playing() { return playing; },
    get time() { return at(); },
  };
}
