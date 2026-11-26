import { describe, expect, it } from 'vitest';
import { createMotionStore } from './store';
import { fakeDeps, frame } from './testkit';
import '../i18n';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function ready() {
  const store = createMotionStore();
  const f = fakeDeps();
  store.attach(f.deps);
  const release = store.use();
  await flush();
  return { store, ...f, release };
}

describe('motion store: drivers and sliders', () => {
  it('asks for the drivers only while a view is on screen, and again when the document changes', async () => {
    const store = createMotionStore();
    const { deps, calls } = fakeDeps();
    store.attach(deps);
    await flush();
    expect(calls.solves).toHaveLength(0);
    expect(store.drivers.value).toBeNull();
    const release = store.use();
    await flush();
    expect(store.drivers.value).toEqual([{ mate: 'F3', kind: 'distance', unit: 'mm', value: 0 }]);
    expect(calls.solves[0]).toEqual({ poses: [], opts: { contact: false } });
    // the driver requests are the solves with no poses (finding which parts move asks for poses as well)
    const asks = () => calls.solves.filter((c) => c.poses.length === 0).length;
    expect(asks()).toBe(1);
    store.attach({ ...deps, docKey: 'k2' });
    await flush();
    expect(asks()).toBe(2);
    release();
    store.attach({ ...deps, docKey: 'k3' });
    await flush();
    expect(asks()).toBe(2); // nothing on screen: not asked
    expect(calls.solves.filter((c) => c.poses.length > 0).length).toBe(4);   // and the movable-parts probe (the base pose, then the one driver) followed each of the two driver loads only
  });

  it('a slider value shows the pose; one past the stop reports what it hits; reset clears it', async () => {
    const { store, calls } = await ready();
    store.setValue('F3', 5);
    await flush();
    expect(calls.solves.at(-1)!.poses).toEqual([{ F3: 5 }]);
    expect(store.pose.value!.get('F2')!.t[0]).toBe(5);
    expect(store.contact.value).toBeNull();
    store.setValue('F3', 12);
    await flush();
    expect(store.contact.value).toMatchObject({ a: 'F1', b: 'F2', kind: 'contact' });
    store.reset();
    expect(store.pose.value).toBeNull();
    expect(store.values.value).toEqual({});
    expect(store.contact.value).toBeNull();
  });

  it('passes the clearance on, finds limits both ways, keeps them as the range and copies them to a limit', async () => {
    const { store, calls } = await ready();
    store.setClearance(0.5);
    store.setValue('F3', 3);
    await flush();
    expect((calls.solves.at(-1)!.opts as { clearance: number }).clearance).toBe(0.5);
    await store.findLimits('F3');
    expect(calls.sweeps).toEqual([{ driver: 'F3', from: 0, to: -100, clearance: 0.5 }, { driver: 'F3', from: 0, to: 100, clearance: 0.5 }]);
    store.useAsRange('F3');
    expect(store.motion.value.drivers).toEqual([{ mate: 'F3', min: -8, max: 8, value: 3 }]);
    expect((calls.saved.at(-1) as { limitsFound: unknown[] }).limitsFound).toHaveLength(1);
    expect(await store.copyToLimits('F3')).toBeNull();
    expect(calls.limits).toEqual([['F3', -8, 8]]);
  });
});

describe('motion store: studies', () => {
  it('make a study, key two moments, solve it once for its frames and say what it touches', async () => {
    const { store, calls } = await ready();
    store.newStudy();
    expect(store.study()!.id).toBe('s1');
    store.setAutoKey(false); // this test keys by hand
    store.addKey('F3'); // slider at 0, time 0
    store.setValue('F3', 12);
    await flush();
    store.time.value = 4;
    store.addKey('F3');
    expect(store.study()!.tracks[0].keys).toEqual([{ t: 0, v: 0, ease: 'inOut' }, { t: 4, v: 12, ease: 'inOut' }]);
    // the keys are saved in the document's motion record and the next redraw hands the same record back
    expect((calls.saved.at(-1) as { studies: unknown[] }).studies).toHaveLength(1);
    const solved = await store.build();
    const frames = calls.solves.filter((s) => s.poses.length === 121).at(-1)!.poses;
    expect(frames[0]).toEqual({ F3: 0 });
    expect(frames[120]).toEqual({ F3: 12 });
    expect(solved!.deltas).toHaveLength(121);
    expect(store.issue()).toMatchObject({ kind: 'contact', a: 'F1', b: 'F2' });
    // (eased 0 to 12 over 4 s passes 8 at t = 2.4 s: the first frame after is 2.467)
    expect(store.issue()!.time).toBeGreaterThan(2.4);
    expect(store.issue()!.time).toBeLessThan(2.5);
    // the same frames are not asked for again
    const n = calls.solves.length;
    await store.build();
    expect(calls.solves).toHaveLength(n);
    // editing the study drops them
    store.setDuration(2);
    expect(store.solved.value).toBeNull();
  });

  it('seeking shows the frame of that time; deleting the study and a document change drop what was solved', async () => {
    const { store, deps } = await ready();
    store.newStudy();
    store.addKey('F3');
    store.setValue('F3', 6);
    await flush();
    store.time.value = 2;
    store.addKey('F3');
    await store.seek(2);
    expect(store.time.value).toBe(2);
    expect(store.pose.value!.get('F2')!.t[0]).toBeCloseTo(6, 9);
    store.attach({ ...deps, docKey: 'changed' });
    expect(store.solved.value).toBeNull();
    store.deleteStudy();
    expect(store.study()).toBeNull();
    expect(store.motion.value.studies).toEqual([]);
  });

  it('takes the motion record the document hands back (opened, undone) as its own', async () => {
    const { store, deps } = await ready();
    store.attach({ ...deps, motion: { version: 1, drivers: [], studies: [{ id: 'sx', name: 'Loaded', duration: 3, loop: 'loop', clearance: 0, tracks: [{ driver: 'F3', keys: [{ t: 0, v: 1 }, { t: 3, v: 2 }] }] }] } });
    expect(store.studies().map((s) => s.name)).toEqual(['Loaded']);
    expect(store.study()!.loop).toBe('loop');
  });
});

describe('motion store: auto key', () => {
  it('a slider moved at the scrub time sets the key there, and a start key at 0 with the value it had', async () => {
    const { store } = await ready();
    store.newStudy();
    store.setDuration(4);
    store.time.value = 1.5;
    store.setValue('F3', 5);
    await flush();
    const keys = store.study()!.tracks.find((t) => t.driver === 'F3')!.keys;
    expect(keys.map((k) => [k.t, k.v])).toEqual([[0, 0], [1.5, 5]]);
  });

  it('moving the same slider again at the same time replaces the key; at another time adds one', async () => {
    const { store } = await ready();
    store.newStudy();
    store.setDuration(4);
    store.time.value = 2;
    store.setValue('F3', 3);
    store.setValue('F3', 6);
    store.time.value = 4;
    store.setValue('F3', -2);
    await flush();
    const keys = store.study()!.tracks.find((t) => t.driver === 'F3')!.keys;
    expect(keys.map((k) => [k.t, k.v])).toEqual([[0, 0], [2, 6], [4, -2]]);
  });

  it('at time 0 the first key is the only key (no extra start key)', async () => {
    const { store } = await ready();
    store.newStudy();
    store.setValue('F3', 4);
    await flush();
    expect(store.study()!.tracks.find((t) => t.driver === 'F3')!.keys.map((k) => [k.t, k.v])).toEqual([[0, 4]]);
  });

  it('with Auto key off, or without a study, a slider sets no key', async () => {
    const { store } = await ready();
    store.setValue('F3', 2);
    expect(store.study()).toBeNull();
    store.newStudy();
    store.setAutoKey(false);
    store.time.value = 1;
    store.setValue('F3', 5);
    await flush();
    expect(store.study()!.tracks).toHaveLength(0);
  });
});

describe('motion store: dragging a part', () => {
  const top = (p: [number, number, number]): [number, number] => [p[0], p[1]];   // looking down z, one pixel per mm

  it('moves the driver so the grabbed point follows the cursor', async () => {
    const { store, release } = await ready();
    store.setAutoKey(false);
    expect(await store.beginDrag('F2', [2, 0, 0])).toBe(true);   // grabbed 2 mm along the slider part
    expect(store.dragging.value).toBe('F2');
    await store.dragMove([7, 0], top);                            // the cursor is 5 mm further along
    expect(store.values.value.F3).toBeCloseTo(5, 3);
    await store.dragMove([-3, 0], top);                           // and then 10 mm back
    expect(store.values.value.F3).toBeCloseTo(-5, 3);
    store.endDrag();
    expect(store.dragging.value).toBeNull();
    release();
  });

  it('a part that no driver moves stays where it is', async () => {
    const { store, release } = await ready();
    store.setAutoKey(false);
    expect(await store.beginDrag('F1', [0, 0, 0])).toBe(true);   // the rail
    await store.dragMove([30, 20], top);
    expect(store.values.value.F3 ?? 0).toBe(0);
    store.endDrag();
    release();
  });

  it('stops at the end of the driver range', async () => {
    const { store, release } = await ready();
    store.setAutoKey(false);
    store.setRange('F3', { min: -2, max: 3 });
    await store.beginDrag('F2', [0, 0, 0]);
    await store.dragMove([50, 0], top);
    expect(store.values.value.F3).toBe(3);
    store.endDrag();
    release();
  });

  it('a drag that ends right after its last move still finishes that move', async () => {
    const { store, release } = await ready();
    store.setAutoKey(false);
    await store.beginDrag('F2', [0, 0, 0]);
    const moving = store.dragMove([6, 0], top);   // a quick flick: the pointer is released at once
    store.endDrag();
    await moving;
    expect(store.values.value.F3).toBeCloseTo(6, 3);
    expect(store.dragging.value).toBeNull();
    release();
  });

  it('does nothing after the drag has ended, or before one began', async () => {
    const { store, release } = await ready();
    await store.dragMove([9, 0], top);
    expect(store.values.value.F3 ?? 0).toBe(0);
    await store.beginDrag('F2', [0, 0, 0]);
    store.endDrag();
    await store.dragMove([9, 0], top);
    expect(store.values.value.F3 ?? 0).toBe(0);
    release();
  });

  it('keys the move at the scrub time when Auto key is on', async () => {
    const { store, release } = await ready();
    store.newStudy();
    store.setDuration(4);
    store.time.value = 2;
    await store.beginDrag('F2', [0, 0, 0]);
    await store.dragMove([6, 0], top);
    store.endDrag();
    await flush();
    const keys = store.study()!.tracks.find((t) => t.driver === 'F3')!.keys;
    expect(keys.map((k) => k.t)).toEqual([0, 2]);              // one key at 2 s however many steps the drag took, and the start key
    expect(keys[1]!.v).toBeCloseTo(6, 3);
    release();
  });
});

describe('motion store: which parts a drag can take hold of', () => {
  it('only the parts some driver moves', async () => {
    const { store, release } = await ready();
    expect(store.isMovable('F2')).toBe(true);    // the slider part moves with the slide mate
    expect(store.isMovable('F1')).toBe(false);   // the rail never does
    release();
  });
  it('everything is allowed until it is known', () => {
    expect(createMotionStore().isMovable('F1')).toBe(true);
  });
});

describe('motion store: dragging with two drivers on one part', () => {
  // The slider part moves along x by the slide F3 and turns about y by the hinge F4 (degrees), as one rigid frame.
  const twoDrivers = () => {
    const seen: Array<Array<Record<string, number>>> = [];   // the poses of every request (the fake's own solve replaces the one that records)
    const f = fakeDeps({
    solve: async (poses) => { seen.push(poses); return {
      drivers: [{ mate: 'F3', kind: 'distance' as const, unit: 'mm' as const, value: 0 }, { mate: 'F4', kind: 'angle' as const, unit: 'deg' as const, value: 0 }],
      poses: poses.map((p) => ({ ok: true, places: [{ id: 'F1', place: frame(0) }, { id: 'F2', place: frame(p.F3 ?? 0, p.F4 ?? 0) }] })),
    }; },
    });
    return { ...f, seen };
  };
  const topXZ = (p: [number, number, number]): [number, number] => [p[0], p[2]];   // looking down the hinge axis (y): x right, z down
  async function ready2() {
    const store = createMotionStore();
    const f = twoDrivers();
    store.attach(f.deps);
    const release = store.use();
    await flush();
    return { store, seen: f.seen, release };
  }

  it('a pull along the slide uses the slide and leaves the hinge alone', async () => {
    const { store, release } = await ready2();
    store.setAutoKey(false);
    await store.beginDrag('F2', [10, 0, 0]);
    await store.dragMove([15, 0], topXZ);
    expect(store.values.value.F3).toBeCloseTo(5, 2);
    expect(store.values.value.F4 ?? 0).toBeCloseTo(0, 2);
    store.endDrag();
    release();
  });

  it('a pull across the part turns the hinge and leaves the slide alone', async () => {
    const { store, release } = await ready2();
    store.setAutoKey(false);
    await store.beginDrag('F2', [10, 0, 0]);
    await store.dragMove([10, -5], topXZ);   // straight up the screen from the grabbed point: the point can only follow its circle about the hinge
    expect(Math.abs(store.values.value.F4 ?? 0)).toBeGreaterThan(20);
    expect(Math.abs(store.values.value.F4 ?? 0)).toBeLessThan(35);   // about atan(5/10), the nearest point of the circle to the cursor
    expect(store.values.value.F3 ?? 0).toBeCloseTo(0, 1);
    store.endDrag();
    release();
  });

  it('once a driver is chosen only that driver is tried: at most the pose and one nudge per step', async () => {
    const { store, seen, release } = await ready2();
    store.setAutoKey(false);
    await store.beginDrag('F2', [10, 0, 0]);
    await store.dragMove([10, -8], topXZ);        // the first move chooses the hinge (and may try both drivers)
    seen.length = 0;
    await store.dragMove([14, -6], topXZ);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((poses) => poses.length <= 2)).toBe(true);
    expect(seen.flat().every((p) => !('F3' in p))).toBe(true);   // the slide is never named again
    store.endDrag();
    release();
  });

  it('after the first movement the drag stays with the driver it chose', async () => {
    const { store, release } = await ready2();
    store.setAutoKey(false);
    await store.beginDrag('F2', [10, 0, 0]);
    await store.dragMove([10, -8], topXZ);        // across: the hinge
    const hinge = store.values.value.F4 ?? 0;
    await store.dragMove([30, -8], topXZ);        // now mostly along x, which the slide could take: the drag must not switch
    expect(store.values.value.F3 ?? 0).toBeCloseTo(0, 1);
    expect(store.values.value.F4 ?? 0).not.toBe(hinge);
    store.endDrag();
    release();
  });
});

describe('motion store: dragging a mechanism whose drivers are coupled', () => {
  // Like a gear mate with its two hinges: a pose that specifies more than one driver conflicts, so only the driver being tried (and what is already set) may be given.
  const coupled = () => {
    const seen: Array<Array<Record<string, number>>> = [];
    const f = fakeDeps({
    solve: async (poses) => { seen.push(poses); return {
      drivers: [{ mate: 'F3', kind: 'distance' as const, unit: 'mm' as const, value: 0 }, { mate: 'F4', kind: 'angle' as const, unit: 'deg' as const, value: 0 }],
      poses: poses.map((p) => Object.keys(p).length > 1
        ? { ok: false, places: [], error: 'mateConflict' }
        : { ok: true, places: [{ id: 'F1', place: frame(0) }, { id: 'F2', place: frame(p.F3 ?? 0, p.F4 ?? 0) }] }),
    }; },
    });
    return { ...f, seen };
  };
  const topXZ = (p: [number, number, number]): [number, number] => [p[0], p[2]];
  async function readyCoupled() {
    const store = createMotionStore();
    const f = coupled();
    store.attach(f.deps);
    const release = store.use();
    await flush();
    return { store, seen: f.seen, release };
  }

  it('still finds which parts move (each driver is tried on its own)', async () => {
    const { store, release } = await readyCoupled();
    expect(store.isMovable('F2')).toBe(true);
    expect(store.isMovable('F1')).toBe(false);
    release();
  });

  it('drags with one driver already set, never specifying a second one', async () => {
    const { store, seen, release } = await readyCoupled();
    store.setAutoKey(false);
    store.setValue('F3', 2);
    await flush();
    await store.beginDrag('F2', [12, 0, 0]);
    await store.dragMove([17, 0], topXZ);                         // 5 mm further along: the slide takes it
    expect(store.values.value.F3).toBeCloseTo(7, 2);
    expect(store.values.value.F4).toBeUndefined();                // the hinge was never set
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((poses) => poses.length > 0).every((poses) => Object.keys(poses[0]!).length <= 1)).toBe(true);   // the pose that is used (the first of each request) never names two drivers; a nudge of the other one on top of it conflicts and is simply ignored
    store.endDrag();
    release();
  });
});
