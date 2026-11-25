// The motion store: everything the Motion tab, the left panel and the bottom timeline share, as signals plus the actions on them (drive a slider, find
// limits, make and key a study, play it, export a clip). The components are thin views of it; the ribbon commands call the same actions. All kernel and
// viewer access comes in through `MotionDeps`, handed over by the app on every redraw (`attach`), so the store is tested with a fake.
import { signal } from '@preact/signals-core';
import {
  clampTransformToContactSets, createPlayer, describeStop, detectContactSetCollisions, FPS, firstIssue, frameTime, isSweep, latestOnly, lerpPose, newContactSetId, newStudyId, poseDeltas, poseRequestAt, rangeOf, readContactSets, readMotion, readStopOnContact, readStudies, solvedFrom, studyFrames, toggleContactSetMember as toggleMember, withContactSet, withKey, withoutContactSet, withoutKey, withoutStudy, withStudy,
  NO_MOTION, type BodyMeshMap, type ContactReply, type ContactSet, type DriverSetting, type Ease, type Frame, type KernelDriver, type MotionDoc, type Player, type Rigid, type Solved, type SolveReply, type Study, type StudyIssue, type SweepReply, type LoopMode,
} from '@kit/motion';
import { t } from '../i18n';
import { exportClip, ClipError, browserBytes, browserDecode, browserSleep, type ClipFormat, type Recorder } from './exportClip';

type Fail = { error: string; mate?: string } | null;
export interface ActiveContactBadge { setId?: string; bodyA: string; bodyB: string; penetrationMm?: number }
export interface MotionDeps {
  /** A string that changes when the document changes in a way that can change the drivers (mates, parts). */
  docKey: string;
  /** The ids and kinds of the document's features (labels of mates). */
  features: Array<{ id: string; type: string; kind?: string }>;
  /** `doc.motion` as the document has it now. */
  motion: unknown;
  solve(poses: Array<Record<string, number>>, opts?: { clearance?: number; contact?: boolean }): Promise<SolveReply | Fail>;
  sweep(req: { driver: string; from?: number; to: number; clearance?: number; hold?: Record<string, number> }): Promise<SweepReply | Fail>;
  components(): Array<{ id: string; place?: Frame }>;
  /** Optional triangle meshes per body/component for continuous BVH contact set resolution. */
  bodyMeshes?(): BodyMeshMap;
  nameOf(id: string): string;
  /** Select and frame these components (a contact, a stop). */
  show(ids: string[]): void;
  /** Add a limits mate for a driver; null when added, else why not. */
  copyToLimits(mate: string, min: number, max: number): Promise<string | null>;
  /** Keep the motion settings in the document (not an undo step). */
  save(m: MotionDoc): void;
  clip?: {
    show(pose: ReadonlyMap<string, Rigid> | null): void;
    capture(): Promise<Blob | null>;
    recorder(mime: string): Recorder | null;
    supports(mime: string): boolean;
    save(name: string, data: Uint8Array, mime: string): Promise<void>;
  };
}

export interface Found { min: SweepReply | null; max: SweepReply | null }

export function createMotionStore() {
  let deps: MotionDeps | null = null;
  let docKey = '';
  let motionKey = '';
  // ---- the pose on screen
  const pose = signal<ReadonlyMap<string, Rigid> | null>(null);
  const values = signal<Record<string, number>>({});
  const problem = signal<string | null>(null);
  const contact = signal<ContactReply | null>(null);
  const stopOnContact = signal(false);
  const activeContact = signal<ActiveContactBadge | null>(null);
  const bodyMeshes = signal<BodyMeshMap | null>(null);
  // ---- drivers
  const drivers = signal<KernelDriver[] | null>(null);
  const clearance = signal(0);
  const finding = signal<string | null>(null);
  const found = signal<Record<string, Found>>({});
  const motion = signal<MotionDoc>(NO_MOTION);
  // ---- studies
  const studyId = signal<string | null>(null);
  const time = signal(0);
  const playing = signal(false);
  const speed = signal(1);
  const ease = signal<Ease>('inOut');
  const solved = signal<Solved | null>(null);
  const computing = signal(false);
  const studyProblem = signal<string | null>(null);
  const exporting = signal<{ done: number; of: number } | null>(null);
  const exported = signal<string | null>(null);
  /** The key picked in the timeline (a tap on its mark): what Delete, the arrow keys and the Delete key button act on. */
  const selectedKey = signal<{ mate: string; index: number } | null>(null);
  let player: Player | null = null;
  let token = 0;
  let stopExport = false;
  let active = 0;

  const need = (): MotionDeps => { if (!deps) throw new Error('motion store: not attached'); return deps; };
  const studies = (): Study[] => readStudies(motion.value);
  const study = (): Study | null => { const all = studies(); return all.find((s) => s.id === studyId.value) ?? all[0] ?? null; };
  const contactSets = (): ContactSet[] => readContactSets(motion.value);
  const parts = (): string[] => {
    if (!deps) return [];
    const ids = new Set<string>();
    for (const c of deps.components()) if (c.id) ids.add(c.id);
    for (const f of deps.features) if (f.type === 'insertPart' && f.id) ids.add(f.id);
    return [...ids];
  };
  const matchesContactSet = (a: string, b: string): ContactSet | null => {
    const sets = contactSets();
    const enabled = sets.filter((s) => s.enabled && s.memberIds.length >= 2);
    if (enabled.length > 0) {
      return enabled.find((s) => s.memberIds.includes(a) && s.memberIds.includes(b)) ?? null;
    }
    if (sets.length > 0) return null;
    return { id: 'default', name: 'Default', enabled: true, memberIds: [a, b] };
  };
  const studyKey = (): string => { const s = study(); return s ? JSON.stringify([s.duration, s.loop, s.clearance, s.tracks]) : ''; };
  const showPose = (p: ReadonlyMap<string, Rigid> | null) => { pose.value = p && p.size ? p : null; };

  const dropSolved = () => { player?.pause(); player = null; token++; solved.value = null; playing.value = false; studyProblem.value = null; computing.value = false; };
  const refreshDrivers = async () => {
    const d = need();
    const r = await d.solve([], { contact: false });
    drivers.value = r && 'drivers' in r ? r.drivers : [];
  };
  const reset = () => { pose.value = null; values.value = {}; problem.value = null; contact.value = null; activeContact.value = null; };

  const save = (m: MotionDoc) => { motion.value = m; need().save(m); };
  const saveStudy = (s: Study) => { save({ ...motion.value, studies: withStudy(motion.value, s) } as MotionDoc); };

  const store = {
    // state
    pose, values, problem, contact, stopOnContact, activeContact, bodyMeshes, drivers, clearance, finding, found, motion, studyId, time, playing, speed, ease, solved, computing, studyProblem, exporting, exported, selectedKey,
    /** The saved motion record is the app's copy plus what was saved here since. */
    studies, study, contactSets, parts,

    /** Called on every redraw of the app: hands over the document and the services. Refreshes what depends on the document when it changed. */
    attach(d: MotionDeps) {
      deps = d;
      const mk = JSON.stringify(d.motion ?? null);
      if (mk !== motionKey) {
        motionKey = mk;
        motion.value = readMotion(d.motion);
        stopOnContact.value = readStopOnContact(d.motion);
      }
      if (d.docKey !== docKey) {
        const first = docKey === '';
        docKey = d.docKey;
        found.value = {};
        dropSolved();
        if (!first) reset();
        drivers.value = null;
        if (active > 0) void refreshDrivers();
      }
    },
    /** A view that shows the motion calls this when it appears (and the returned function when it goes): the drivers are only asked for while one is on screen. */
    use(): () => void {
      active++;
      if (drivers.value === null && deps) void refreshDrivers();
      return () => { active = Math.max(0, active - 1); };
    },
    refreshDrivers,
    set: showPose,
    reset,
    setBodyMeshes(m: BodyMeshMap | null) { bodyMeshes.value = m; },

    // ---- contact sets
    addContactSet(init?: Partial<ContactSet>): ContactSet {
      const all = contactSets();
      const id = init?.id ?? newContactSetId(all);
      const next: ContactSet = {
        id,
        name: init?.name ?? t('motion.contactSets.setName', { n: id.replace(/^cs/, '') }),
        enabled: init?.enabled ?? true,
        memberIds: init?.memberIds ? [...init.memberIds] : [],
        ...(init?.clearanceMm !== undefined ? { clearanceMm: init.clearanceMm } : {}),
      };
      save({ ...motion.value, contactSets: withContactSet(motion.value, next) } as MotionDoc);
      return next;
    },
    removeContactSet(id: string) {
      save({ ...motion.value, contactSets: withoutContactSet(motion.value, id) } as MotionDoc);
      if (activeContact.value?.setId === id) activeContact.value = null;
    },
    setContactSetEnabled(id: string, enabled: boolean) {
      const s = contactSets().find((x) => x.id === id);
      if (!s) return;
      save({ ...motion.value, contactSets: withContactSet(motion.value, { ...s, enabled }) } as MotionDoc);
      if (!enabled && activeContact.value?.setId === id) activeContact.value = null;
    },
    toggleContactSetMember(id: string, memberId: string) {
      const s = contactSets().find((x) => x.id === id);
      if (!s) return;
      save({ ...motion.value, contactSets: withContactSet(motion.value, toggleMember(s, memberId)) } as MotionDoc);
    },
    setStopOnContact(on: boolean) {
      stopOnContact.value = on;
      save({ ...motion.value, stopOnContact: on } as MotionDoc);
    },

    // ---- sliders
    drive: latestOnly(async (v: Record<string, number>) => {
      const d = need();
      const r = await d.solve([v], { clearance: clearance.value });
      if (!r || !('poses' in r)) { problem.value = 'noKernel'; return; }
      const p = r.poses[0];
      if (!p) return;
      if (!p.ok) { problem.value = p.error ?? 'error'; contact.value = null; activeContact.value = null; return; }
      problem.value = null;

      let nextDeltas = poseDeltas(d.components(), p);
      const meshes = bodyMeshes.value ?? d.bodyMeshes?.() ?? null;
      const enabledSets = contactSets().filter((s) => s.enabled && s.memberIds.length >= 2);

      if (meshes && enabledSets.length > 0) {
        const prevMap = pose.value ?? new Map<string, Rigid>();
        const prevXfs: Record<string, Rigid> = {};
        const nextXfs: Record<string, Rigid> = {};
        for (const id of parts()) {
          prevXfs[id] = prevMap.get(id) ?? { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
          nextXfs[id] = nextDeltas.get(id) ?? { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
        }
        if (stopOnContact.value) {
          let clampedAny = false;
          const clampedDeltas = new Map(nextDeltas);
          for (const [id, targetRig] of nextDeltas) {
            const startRig = prevXfs[id] ?? { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
            const res = clampTransformToContactSets(id, startRig, targetRig, enabledSets, meshes, prevXfs);
            if (res.clamped && res.contact) {
              clampedDeltas.set(id, res.clampedTransform);
              activeContact.value = { setId: res.contact.setId, bodyA: res.contact.bodyA, bodyB: res.contact.bodyB, penetrationMm: res.contact.penetrationMm };
              contact.value = { a: res.contact.bodyA, b: res.contact.bodyB, kind: 'contact', distance: 0, at: res.contact.contactPoint };
              clampedAny = true;
            }
          }
          if (clampedAny) {
            showPose(clampedDeltas);
            return;
          }
          activeContact.value = null;
        } else {
          const hits = detectContactSetCollisions(enabledSets, meshes, nextXfs);
          if (hits.length > 0) {
            activeContact.value = { setId: hits[0].setId, bodyA: hits[0].bodyA, bodyB: hits[0].bodyB, penetrationMm: hits[0].penetrationMm };
            contact.value = { a: hits[0].bodyA, b: hits[0].bodyB, kind: 'contact', distance: 0, at: hits[0].contactPoint };
            showPose(nextDeltas);
            return;
          }
          activeContact.value = null;
        }
      }

      if (p.contact) {
        const matched = matchesContactSet(p.contact.a, p.contact.b);
        if (matched) {
          contact.value = p.contact;
          activeContact.value = { setId: matched.id, bodyA: p.contact.a, bodyB: p.contact.b };
          if (stopOnContact.value) {
            const mates = Object.keys(v);
            if (mates.length === 1) {
              const mate = mates[0];
              const sw = await d.sweep({ driver: mate, from: 0, to: v[mate], clearance: clearance.value });
              if (isSweep(sw) && sw.stop.reason === 'contact') {
                values.value = { ...values.value, [mate]: sw.reached };
                const clampedSolve = await d.solve([{ [mate]: sw.reached }], { clearance: clearance.value });
                if (clampedSolve && 'poses' in clampedSolve && clampedSolve.poses[0]?.ok) {
                  nextDeltas = poseDeltas(d.components(), clampedSolve.poses[0]);
                }
              }
            }
          }
        } else {
          contact.value = null;
          activeContact.value = null;
        }
      } else {
        contact.value = null;
        activeContact.value = null;
      }
      showPose(nextDeltas);
    }),
    setValue(mate: string, x: number) {
      if (!Number.isFinite(x)) return;
      const next = { ...values.value, [mate]: x };
      values.value = next;
      void store.drive(next);
    },
    setClearance(c: number) { clearance.value = Number.isFinite(c) && c >= 0 ? c : 0; },
    setRange(mate: string, patch: Partial<DriverSetting>) {
      const d = drivers.value?.find((x) => x.mate === mate);
      if (!d) return;
      const cur = rangeOf(d, motion.value.drivers);
      const next: DriverSetting = { mate, min: cur.min, max: cur.max, value: values.value[mate] ?? 0, ...patch };
      if (!(next.min < next.max)) return;
      save({ ...motion.value, drivers: [...motion.value.drivers.filter((x) => x.mate !== mate), next] });
    },
    async findLimits(mate: string) {
      const d = drivers.value?.find((x) => x.mate === mate);
      if (!d) return;
      finding.value = mate;
      try {
        const r = rangeOf(d, motion.value.drivers);
        const ask = (to: number) => need().sweep({ driver: mate, from: 0, to, clearance: clearance.value });
        const lo = await ask(Math.min(r.min, -1));
        const hi = await ask(Math.max(r.max, 1));
        found.value = { ...found.value, [mate]: { min: isSweep(lo) ? lo : null, max: isSweep(hi) ? hi : null } };
      } finally { finding.value = null; }
    },
    useAsRange(mate: string) {
      const f = found.value[mate];
      if (!f?.min || !f.max || !(f.min.reached < f.max.reached)) return;
      save({
        ...motion.value,
        drivers: [...motion.value.drivers.filter((x) => x.mate !== mate), { mate, min: f.min.reached, max: f.max.reached, value: values.value[mate] ?? 0 }],
        limitsFound: [...((motion.value.limitsFound as unknown[] | undefined) ?? []).filter((x) => (x as { driver?: string }).driver !== mate), { driver: mate, min: f.min.stop, max: f.max.stop }],
      } as MotionDoc);
    },
    async copyToLimits(mate: string): Promise<string | null> {
      const d = drivers.value?.find((x) => x.mate === mate);
      if (!d) return null;
      const r = rangeOf(d, motion.value.drivers);
      return need().copyToLimits(mate, r.min, r.max);
    },
    /** "Hinge Door on pin": the kind of mate and the name the user gave it. */
    label(mate: string): string {
      const d = need();
      const f = d.features.find((x) => x.id === mate);
      return `${f?.kind ? t('asm.mate.kind.' + f.kind) : t('motion.mate')} ${d.nameOf(mate)}`;
    },
    nameOf(id: string): string { return need().nameOf(id); },
    stopWords(s: SweepReply, unit: string): { key: string; params: Record<string, string | number> } { return describeStop(s.stop, need().nameOf, unit); },
    show(ids: string[]) { need().show(ids); },

    // ---- studies
    newStudy() {
      const all = studies();
      const id = newStudyId(all);
      saveStudy({ id, name: t('motion.study.name', { n: id.slice(1) }), duration: 4, loop: 'once', clearance: 0, tracks: [] });
      studyId.value = id;
      time.value = 0;
      dropSolved();
    },
    selectStudy(id: string) { studyId.value = id; time.value = 0; selectedKey.value = null; dropSolved(); },
    deleteStudy() {
      const s = study();
      if (!s) return;
      const next = { ...motion.value, studies: withoutStudy(motion.value, s.id) } as MotionDoc;
      studyId.value = null;
      save(next);
      dropSolved();
    },
    editStudy(patch: Partial<Study>) {
      const s = study();
      if (!s) return;
      const before = studyKey();
      saveStudy({ ...s, ...patch });
      if (JSON.stringify([patch.duration ?? s.duration, patch.loop ?? s.loop, patch.clearance ?? s.clearance, patch.tracks ?? s.tracks]) !== before) dropSolved();
    },
    setEase(e: Ease) { ease.value = e; },
    setLoop(l: LoopMode) { store.editStudy({ loop: l }); },
    setDuration(x: number) { if (Number.isFinite(x) && x > 0) store.editStudy({ duration: x }); },
    /** A key for `mate` at the scrub time, at the value its slider holds now. */
    addKey(mate: string) {
      const s = study();
      if (s) store.editStudy(withKey(s, mate, time.value, values.value[mate] ?? 0, ease.value));
    },
    /** A key at time `t` (a click on the timeline), at the slider's value. */
    addKeyAt(mate: string, t: number) {
      const s = study();
      if (s) store.editStudy(withKey(s, mate, Math.max(0, Math.min(s.duration, t)), values.value[mate] ?? 0, ease.value));
    },
    removeKey(mate: string, index: number) {
      const s = study();
      if (s) store.editStudy(withoutKey(s, mate, index));
      selectedKey.value = null;
    },
    /** Pick a key (and go to its time). */
    selectKey(mate: string, index: number) {
      selectedKey.value = { mate, index };
      const k = study()?.tracks.find((x) => x.driver === mate)?.keys[index];
      if (k) void store.seek(k.t);
    },
    deleteSelectedKey() { const k = selectedKey.value; if (k) store.removeKey(k.mate, k.index); },
    /** Move a key to time `t` (snapped to a frame, kept inside the study). */
    moveKey(mate: string, index: number, t: number): number {
      const s = study();
      const tr = s?.tracks.find((x) => x.driver === mate);
      const k = tr?.keys[index];
      if (!s || !tr || !k) return index;
      const nt = +Math.max(0, Math.min(s.duration, Math.round(t * FPS) / FPS)).toFixed(3);
      if (nt === k.t) return index;
      const keys = tr.keys.map((x, i) => (i === index ? { ...x, t: nt } : x)).sort((a, b) => a.t - b.t);
      store.editStudy({ tracks: s.tracks.map((x) => (x === tr ? { ...x, keys } : x)) });
      const ni = keys.findIndex((x) => x.t === nt && x.v === k.v);
      selectedKey.value = { mate, index: ni >= 0 ? ni : index };
      time.value = nt; // the playhead goes with the key (the frames are solved again when it is played or scrubbed)
      return ni >= 0 ? ni : index;
    },

    // ---- playback
    async build(): Promise<Solved | null> {
      const s = study();
      if (!s) return null;
      if (solved.value) return solved.value;
      const mine = ++token;
      computing.value = true;
      studyProblem.value = null;
      const r = await need().solve(studyFrames(s), { clearance: s.clearance });
      if (mine !== token) return null;
      computing.value = false;
      if (!r || !('poses' in r)) { studyProblem.value = 'noKernel'; return null; }
      const out = solvedFrom(need().components(), r.poses);
      solved.value = out;
      return out;
    },
    cancel() { token++; computing.value = false; stopExport = true; },
    async ensurePlayer(): Promise<Player | null> {
      const s = study();
      if (!s) return null;
      const sv = await store.build();
      if (!sv) return null;
      if (!player) {
        player = createPlayer({
          frames: sv.deltas.length, duration: s.duration, loop: s.loop,
          // between two solved frames the pose is blended, so the motion is smooth at the display's rate, not stepped at the frame rate of the solve
          show: (_i, tm, pos) => {
            let effPos = pos;
            let effTm = tm;
            if (stopOnContact.value) {
              let hitFrame = -1;
              let hitInfo: { setId?: string; bodyA: string; bodyB: string; distance: number } | null = null;
              for (let k = 0; k <= Math.min(sv.contacts.length - 1, Math.ceil(pos)); k++) {
                const c = sv.contacts[k];
                if (c) {
                  const matched = matchesContactSet(c.a, c.b);
                  if (matched) {
                    hitFrame = k;
                    hitInfo = { setId: matched.id, bodyA: c.a, bodyB: c.b, distance: c.distance };
                    break;
                  }
                }
              }
              if (hitFrame >= 0 && hitInfo) {
                const safeFrame = Math.max(0, hitFrame - 1);
                effPos = Math.min(pos, safeFrame);
                effTm = frameTime(safeFrame, sv.deltas.length, s.duration);
                activeContact.value = { setId: hitInfo.setId, bodyA: hitInfo.bodyA, bodyB: hitInfo.bodyB };
                contact.value = { a: hitInfo.bodyA, b: hitInfo.bodyB, kind: 'contact', distance: hitInfo.distance, at: [0, 0, 0] };
                if (player?.playing) {
                  player.pause();
                  playing.value = false;
                }
              } else {
                activeContact.value = null;
                contact.value = null;
              }
            }
            const lo = Math.floor(effPos);
            showPose(lerpPose(sv.deltas[lo], sv.deltas[Math.min(lo + 1, sv.deltas.length - 1)], effPos - lo));
            time.value = +effTm.toFixed(3);
            // the sliders (and so the next Key) follow the playhead: what is shown is what gets keyed
            values.value = { ...values.value, ...poseRequestAt(s, effTm) };
          },
          onEnd: () => { playing.value = false; },
          schedule: (cb) => { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); },
          now: () => performance.now(),
        });
        player.setSpeed(speed.value);
      }
      return player;
    },
    async play() { const p = await store.ensurePlayer(); if (!p) return; p.play(); playing.value = p.playing; },
    pause() { player?.pause(); playing.value = false; },
    async seek(t: number) { const p = await store.ensurePlayer(); if (!p) return; p.pause(); playing.value = false; p.seek(t); },
    setSpeed(v: number) { speed.value = v; player?.setSpeed(v); },
    issue(): StudyIssue | null { const s = study(); const sv = solved.value; return s && sv ? firstIssue(sv, s.duration) : null; },

    // ---- export
    async exportClip(format: ClipFormat): Promise<void> {
      const d = need();
      const c = d.clip;
      const s = study();
      if (!c || !s) return;
      const sv = await store.build();
      if (!sv) return;
      player?.pause(); playing.value = false;
      stopExport = false; exported.value = null; studyProblem.value = null;
      exporting.value = { done: 0, of: sv.deltas.length };
      try {
        exported.value = await exportClip(format, s.name, {
          frames: sv.deltas.length, duration: s.duration,
          show: (i) => c.show(sv.deltas[i] ?? null),
          capture: () => c.capture(), recorder: (m) => c.recorder(m), supports: (m) => c.supports(m),
          decode: browserDecode, bytes: browserBytes, sleep: browserSleep, save: (n, data, m) => c.save(n, data, m),
          progress: (done, of) => { exporting.value = { done, of }; }, cancelled: () => stopExport,
        });
      } catch (e) {
        studyProblem.value = e instanceof ClipError ? e.code : 'failed';
      } finally { exporting.value = null; c.show(null); showPose(null); }
    },
  };
  return store;
}
export type MotionStore = ReturnType<typeof createMotionStore>;
