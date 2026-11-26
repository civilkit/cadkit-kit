import { describe, expect, it } from 'vitest';
import type { Frame } from '@kit/motion';
import { dragStep, localOf, screenVelocities, worldOf, type DragInput, type Projector, type V3 } from './dragSolve';

// A hinge turning about the world z axis through the origin (angle in degrees) with a slider along x (mm): the frame of the moving component.
const frame = (deg: number, slide = 0): Frame => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { o: [slide, 0, 0], x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1] };
};
// Looking straight down z: one pixel per mm, screen y pointing down.
const top: Projector = (p) => [p[0], -p[1]];

describe('frame maths', () => {
  it('worldOf and localOf are inverse', () => {
    const f = frame(37, 12);
    const l: V3 = [40, -5, 9];
    const back = localOf(f, worldOf(f, l));
    back.forEach((v, i) => expect(v).toBeCloseTo(l[i]!, 9));
  });
});

describe('dragging a hinge', () => {
  const local: V3 = [100, 0, 0];
  const nudge = 1;
  const input = (angle: number, pointer: [number, number], locked?: string | null): DragInput => ({
    frames: [frame(angle), frame(angle + nudge)], drivers: [{ mate: 'hinge', step: nudge }], local, pointer, project: top, locked,
  });

  it('moves the angle towards the cursor and converges in a few steps', () => {
    const target = [100 * Math.cos(Math.PI / 6), -100 * Math.sin(Math.PI / 6)] as [number, number];   // the point at 30 degrees
    let angle = 0;
    const errs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const st = dragStep(input(angle, target));
      if (!st) break;
      errs.push(st.errorPx);
      angle += st.delta;
    }
    expect(angle).toBeCloseTo(30, 1);
    expect(errs[errs.length - 1]!).toBeLessThan(errs[0]!);
  });

  it('turns the right way (a cursor below the point turns the angle negative)', () => {
    const st = dragStep(input(0, [100, 40]))!;
    expect(st.delta).toBeLessThan(0);
  });

  it('does nothing inside the dead zone', () => {
    expect(dragStep(input(0, [100.2, 0.1]))).toBeNull();
  });

  it('does nothing when the point is behind the camera or the nudged pose failed', () => {
    const behind: Projector = () => null;
    expect(dragStep({ ...input(0, [50, 50]), project: behind })).toBeNull();
    expect(dragStep({ ...input(0, [50, 50]), frames: [frame(0), null] })).toBeNull();
  });
});

describe('choosing between drivers', () => {
  const local: V3 = [100, 0, 0];
  const mk = (pointer: [number, number], locked?: string | null): DragInput => ({
    // driver 0: the hinge (1 degree nudge); driver 1: the slide along x (1 mm nudge)
    frames: [frame(0, 0), frame(1, 0), frame(0, 1)],
    drivers: [{ mate: 'hinge', step: 1 }, { mate: 'slide', step: 1 }], local, pointer, project: top, locked,
  });

  it('reports a velocity per driver', () => {
    const v = screenVelocities(mk([0, 0]));
    expect(v[0]![1]).toBeCloseTo(-Math.PI / 180 * 100, 1);   // the hinge moves the point up the screen (y down), about 1.75 px per degree
    expect(v[1]![0]).toBeCloseTo(1, 6);                      // the slide moves it along x, one pixel per mm
  });

  it('a sideways pull slides, an up-and-down pull turns', () => {
    expect(dragStep(mk([130, 0]))!.mate).toBe('slide');
    expect(dragStep(mk([130, 0]))!.delta).toBeCloseTo(30, 6);
    expect(dragStep(mk([100, -30]))!.mate).toBe('hinge');
  });

  it('stays with the locked driver', () => {
    expect(dragStep(mk([130, 5], 'hinge'))!.mate).toBe('hinge');      // the sideways pull would slide, but the hinge is locked
    expect(dragStep(mk([130, -30], 'slide'))!.mate).toBe('slide');    // the slide takes its sideways part
  });

  it('a locked driver that cannot take any of the pull leaves the part where it is', () => {
    expect(dragStep(mk([100, -30], 'slide'))).toBeNull();             // a vertical pull is no use to a slide along x
  });

  it('ignores a driver that does not move the grabbed point', () => {
    const st = dragStep({ ...mk([130, 0]), frames: [frame(0), frame(0), frame(0, 1)] })!;   // the hinge nudge left the component where it was
    expect(st.mate).toBe('slide');
    expect(dragStep({ ...mk([100, -30]), frames: [frame(0), frame(0), frame(0, 1)] })).toBeNull();   // and nothing else can take a vertical pull
  });
});
