import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import type { EditOp } from '@ck/session';
import { deltaBetween, type Frame } from '@kit/motion';
import { AssemblyPanel, type AsmHost, type Section } from './AssemblyPanel';
import { displayBody, type ShowBody } from './display';
import { NO_EXPLODE, type DocLike } from './model';
import {
  breakComponentLink,
  computePartHash,
  expandFlexibleSubassemblyMates,
  getComponentLinkStatus,
  getLinkedComponentStatus,
  isSubassemblyComponent,
  isSubassemblyFlexible,
  isSubassemblyPart,
  linkInsertedPart,
  setSubassemblyFlexible,
  updateLinkedComponents,
} from './linkedComponents';
import '../i18n';

afterEach(() => cleanup());

const makePart = (name: string, depth = 10, material = 'steel'): Record<string, unknown> => ({
  format: 'ck-part',
  version: 1,
  name,
  material,
  features: [
    { id: 'F1', type: 'sketch' },
    { id: 'F2', type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth },
  ],
});

const makeSubassemblyPart = (name = 'GripperSubasm'): Record<string, unknown> => ({
  format: 'ck-part',
  version: 1,
  name,
  material: 'aluminium',
  features: [
    { id: 'S1', type: 'insertPart', name: 'BaseJaw', part: makePart('BaseJaw', 12), fixed: true, dx: 0, dy: 0, dz: 0 },
    { id: 'S2', type: 'insertPart', name: 'MovingJaw', part: makePart('MovingJaw', 12), dx: 15, dy: 0, dz: 0 },
    {
      id: 'M1',
      type: 'mate',
      kind: 'revolute',
      name: 'JawHinge',
      a: { kind: 'connector', id: 'C_PIVOT', component: 'S1' },
      b: { kind: 'connector', id: 'C_PIVOT', component: 'S2' },
      min: -30,
      max: 45,
    },
    {
      id: 'M2',
      type: 'mate',
      kind: 'parallel',
      name: 'JawGuide',
      a: 'F2.C0@S1.1',
      b: 'F2.C0@S2.1',
    },
  ],
});

describe('Linked External Components & Shared Instances', () => {
  it('links an inserted part to a tab/file/library source and computes deterministic hashes', () => {
    const boltV1 = makePart('Bolt', 20);
    const asm: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Plate', part: makePart('Plate', 5), fixed: true },
        { id: 'F2', type: 'insertPart', name: 'Bolt 1', part: boltV1, dx: 10, dy: 20, dz: 0 },
      ],
    };

    const linked = linkInsertedPart(asm, 'F2', {
      sourceKind: 'tab',
      sourceUri: 'tab:bolt-m6',
    });

    const f2 = linked.features.find((f) => f.id === 'F2')!;
    expect(f2.linkedRef).toMatchObject({
      sourceKind: 'tab',
      sourceUri: 'tab:bolt-m6',
      sourceHash: computePartHash(boltV1),
      outOfDate: false,
    });

    // When available source matches the embedded snapshot hash, outOfDate is false
    const statusClean = getLinkedComponentStatus(linked, [
      { sourceKind: 'tab', sourceUri: 'tab:bolt-m6', part: boltV1 },
    ]);
    expect(statusClean).toHaveLength(1);
    expect(statusClean[0]).toMatchObject({
      featureId: 'F2',
      linked: true,
      sourceKind: 'tab',
      sourceUri: 'tab:bolt-m6',
      sourceAvailable: true,
      outOfDate: false,
    });
  });

  it('detects out-of-date status when the external source changes and updates all shared instances while preserving transforms and mates', () => {
    const boltV1 = makePart('Bolt', 20, 'steel');
    const boltV2 = makePart('Bolt', 35, '');
    let asm: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Base', part: makePart('Base', 10), fixed: true },
        { id: 'F2', type: 'insertPart', name: 'Bolt Left', part: boltV1, dx: -25, dy: 10, dz: 5, axis: { kind: 'axis', axis: 'z' }, angle: 90 },
        { id: 'F3', type: 'insertPart', name: 'Bolt Right', part: { ...boltV1, material: 'brass' }, dx: 25, dy: 10, dz: 5 },
        { id: 'F4', type: 'mate', kind: 'concentric', name: 'LeftHole', a: 'F2.C1@F2.1', b: 'F2.C1@F1.1' },
        { id: 'F5', type: 'mate', kind: 'concentric', name: 'RightHole', a: 'F2.C1@F3.1', b: 'F2.C2@F1.1' },
      ],
    };

    asm = linkInsertedPart(asm, 'F2', { sourceKind: 'library', sourceUri: 'library:iso-4762-m6' });
    asm = linkInsertedPart(asm, 'F3', { sourceKind: 'library', sourceUri: 'library:iso-4762-m6' });

    const sources = [{ sourceKind: 'library' as const, sourceUri: 'library:iso-4762-m6', part: boltV2 }];
    const statuses = getLinkedComponentStatus(asm, sources);
    expect(statuses).toHaveLength(2);
    expect(statuses[0].outOfDate).toBe(true);
    expect(statuses[1].outOfDate).toBe(true);
    expect(statuses[0].sharedInstanceIds).toEqual(['F2', 'F3']);
    expect(statuses[1].sharedInstanceIds).toEqual(['F2', 'F3']);

    // Updating just F2 also syncs shared instance F3 referencing the same sourceUri
    const synced = updateLinkedComponents(asm, sources, ['F2']);
    expect(synced.updatedIds).toEqual(['F2', 'F3']);

    const nextF2 = synced.features.find((f) => f.id === 'F2')!;
    const nextF3 = synced.features.find((f) => f.id === 'F3')!;

    // Geometry updated to depth 35
    expect(((nextF2.part as { features: Array<{ depth?: number }> }).features[1]).depth).toBe(35);
    expect(((nextF3.part as { features: Array<{ depth?: number }> }).features[1]).depth).toBe(35);

    // Transforms, feature IDs, and custom material fallback preserved
    expect(nextF2.dx).toBe(-25);
    expect(nextF2.dy).toBe(10);
    expect(nextF2.dz).toBe(5);
    expect(nextF2.angle).toBe(90);
    expect(nextF3.dx).toBe(25);
    expect((nextF3.part as { material?: string }).material).toBe('brass');

    // Mates preserved
    const mates = synced.features.filter((f) => f.type === 'mate');
    expect(mates.map((m) => [m.id, m.a, m.b])).toEqual([
      ['F4', 'F2.C1@F2.1', 'F2.C1@F1.1'],
      ['F5', 'F2.C1@F3.1', 'F2.C2@F1.1'],
    ]);

    // Status is now up-to-date
    const afterStatus = getLinkedComponentStatus(synced, sources);
    expect(afterStatus.every((s) => !s.outOfDate)).toBe(true);
  });

  it('breaks a component link to make a standalone embedded copy without affecting other shared instances', () => {
    const bolt = makePart('Bolt', 20);
    let asm: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Bolt 1', part: bolt, dx: 10 },
        { id: 'F2', type: 'insertPart', name: 'Bolt 2', part: bolt, dx: 30 },
      ],
    };
    asm = linkInsertedPart(asm, 'F1', { sourceKind: 'file', sourceUri: 'file://bolt.ckpart' });
    asm = linkInsertedPart(asm, 'F2', { sourceKind: 'file', sourceUri: 'file://bolt.ckpart' });

    const unlinked = breakComponentLink(asm, 'F1');
    const f1 = unlinked.features.find((f) => f.id === 'F1')!;
    const f2 = unlinked.features.find((f) => f.id === 'F2')!;

    expect('linkedRef' in f1).toBe(false);
    expect(f1.part).toEqual(bolt);
    expect(f1.dx).toBe(10);
    expect(getComponentLinkStatus(unlinked, 'F1')?.linked).toBe(false);
    expect(getComponentLinkStatus(unlinked, 'F2')?.linked).toBe(true);
  });
});

describe('Flexible Subassemblies', () => {
  it('identifies subassemblies and defaults to Rigid (flexible: false)', () => {
    const singleBody = makePart('Bracket', 15);
    const subasm = makeSubassemblyPart('Gripper');
    expect(isSubassemblyPart(singleBody)).toBe(false);
    expect(isSubassemblyPart(subasm)).toBe(true);

    const asm: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Mount', part: singleBody, fixed: true },
        { id: 'F2', type: 'insertPart', name: 'Gripper', part: subasm, dx: 50, dy: 10, dz: 0 },
        { id: 'F3', type: 'mate', kind: 'coincident', name: 'MountMate', a: 'F2.C0@F2.1', b: 'F2.C0@F1.1' },
      ],
    };

    expect(isSubassemblyComponent(asm, 'F1')).toBe(false);
    expect(isSubassemblyComponent(asm, 'F2')).toBe(true);
    expect(isSubassemblyFlexible(asm, 'F2')).toBe(false);

    // When Rigid, internal mates are NOT lifted into the parent assembly solver
    const rigidMates = expandFlexibleSubassemblyMates(asm);
    expect(rigidMates.map((m) => m.id)).toEqual(['F3']);
    expect(rigidMates.liftedMates).toHaveLength(0);
  });

  it('lifts internal mates with namespace prefix ${featureId}: and composes sub-component transforms when marked Flexible', () => {
    const subasm = makeSubassemblyPart('Gripper');
    let asm: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Mount', part: makePart('Mount'), fixed: true },
        { id: 'F2', type: 'insertPart', name: 'Gripper', part: subasm, dx: 100, dy: 20, dz: 5 },
        { id: 'F3', type: 'mate', kind: 'coincident', name: 'MountMate', a: 'F2.C0@F2.1', b: 'F2.C0@F1.1' },
      ],
    };

    asm = setSubassemblyFlexible(asm, 'F2', true);
    expect(isSubassemblyFlexible(asm, 'F2')).toBe(true);

    const expanded = expandFlexibleSubassemblyMates(asm);
    expect(expanded.map((m) => m.id)).toEqual(['F3', 'F2:M1', 'F2:M2']);
    expect(expanded.liftedMates).toHaveLength(2);

    const hinge = expanded.liftedMates[0];
    expect(hinge).toMatchObject({
      id: 'F2:M1',
      kind: 'revolute',
      subassemblyId: 'F2',
      sourceMateId: 'M1',
      a: { kind: 'connector', id: 'C_PIVOT', component: 'F2:S1' },
      b: { kind: 'connector', id: 'C_PIVOT', component: 'F2:S2' },
      min: -30,
      max: 45,
      parentTransform: { dx: 100, dy: 20, dz: 5, axis: null, angle: 0 },
    });

    const guide = expanded.liftedMates[1];
    expect(guide).toMatchObject({
      id: 'F2:M2',
      kind: 'parallel',
      subassemblyId: 'F2',
      sourceMateId: 'M2',
      a: 'F2:F2.C0@S1.1',
      b: 'F2:F2.C0@S2.1',
    });

    // Sub-components carry composed world translations
    expect(expanded.subComponents.map((c) => [c.id, c.worldTranslation, c.flexible])).toEqual([
      ['F2:S1', [100, 20, 5], true],
      ['F2:S2', [115, 20, 5], true],
    ]);

    // Toggling back to Rigid stops lifting internal mates
    const backToRigid = setSubassemblyFlexible(asm, 'F2', false);
    expect(isSubassemblyFlexible(backToRigid, 'F2')).toBe(false);
    expect(expandFlexibleSubassemblyMates(backToRigid).liftedMates).toHaveLength(0);
  });

  it('displayBody moves sub-bodies as one rigid group when Rigid, and articulates sub-components when Flexible', () => {
    const frame = (o: number[]): Frame => ({ o, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    const body: ShowBody = {
      mesh: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        triFace: new Int32Array([0, 1]),
        faceIds: ['F1.C0@S1.1@F2.1', 'F1.C0@S2.1@F2.1'],
      },
      edges: [],
      box: { min: [0, 0, 0], max: [11, 1, 0] },
    };
    const parentShift = deltaBetween(frame([0, 0, 0]), frame([5, 0, 0]));
    const jawShift = deltaBetween(frame([0, 0, 0]), frame([25, 0, 0]));
    const pose = new Map([
      ['F2', parentShift],
      ['F2:S2', jawShift],
    ]);

    const rigidDoc: DocLike = {
      features: [{ id: 'F2', type: 'insertPart', flexible: false, part: makeSubassemblyPart() }],
    };
    const rigidShown = displayBody(body, {
      inserts: new Set(['F2']),
      hidden: new Set(),
      explode: NO_EXPLODE,
      pose,
      doc: rigidDoc,
    });
    // Both S1 and S2 move by parentShift (+5 in X) when F2 is Rigid
    expect(rigidShown.mesh.positions[0]).toBeCloseTo(5);
    expect(rigidShown.mesh.positions[9]).toBeCloseTo(15);

    const flexDoc = setSubassemblyFlexible(rigidDoc, 'F2', true);
    const flexShown = displayBody(body, {
      inserts: new Set(['F2']),
      hidden: new Set(),
      explode: NO_EXPLODE,
      pose,
      doc: flexDoc,
    });
    // S1 moves by parentShift (+5), while S2 articulates by jawShift (+25) when F2 is Flexible
    expect(flexShown.mesh.positions[0]).toBeCloseTo(5);
    expect(flexShown.mesh.positions[9]).toBeCloseTo(35);
  });
});

describe('AssemblyPanel Linked & Flexible Subassembly UI', () => {
  function createHost(doc: DocLike, over: Partial<AsmHost> = {}) {
    const calls = { edits: [] as EditOp[][], notes: [] as string[] };
    const host: AsmHost = {
      doc: doc as never,
      dof: new Map([['F1', 0], ['F2', 1]]),
      errors: new Map(),
      hidden: [],
      explode: NO_EXPLODE,
      selection: [],
      faceNames: () => [],
      bodyFaces: (n) => [n],
      select: () => {},
      frame: () => {},
      edit: async (ops) => {
        calls.edits.push(ops);
        return true;
      },
      preview: async () => ({ ok: true }),
      cancelPreview: async () => {},
      samples: async () => [],
      readUrl: async () => '',
      openFile: async () => null,
      saveFile: async () => {},
      partVolume: async () => 1000,
      notify: (msg) => {
        calls.notes.push(msg);
      },
      toggleHidden: () => {},
      setExplode: () => {},
      interference: { data: null, stale: false, busy: false, run: () => {} },
      ...over,
    };
    return { host, calls };
  }

  const mountPanel = (host: AsmHost, section: Section = 'parts') =>
    render(h(AssemblyPanel, { host, section, onSection: () => {} }));

  it('renders Link to tab/file control, Linked badge, Update link when out-of-date, and Break link button', async () => {
    const boltV1 = makePart('Bolt', 20);
    const boltV2 = makePart('Bolt', 30);
    const unlinkedDoc: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Bolt', part: boltV1, dx: 12 },
      ],
    };

    const sources = [{ sourceKind: 'tab' as const, sourceUri: 'tab:bolt', name: 'Bolt', part: boltV1 }];
    const { host, calls } = createHost(unlinkedDoc, { linkedSources: sources });
    const view = mountPanel(host);

    // Initially unlinked: shows "Link to tab/file" button
    const linkBtn = view.getByTestId('link-component-F1');
    expect(linkBtn.textContent).toBe('Link to tab/file');
    fireEvent.click(linkBtn);
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0][0]).toMatchObject({
      op: 'set',
      id: 'F1',
      path: 'linkedRef',
      value: { sourceKind: 'tab', sourceUri: 'tab:bolt', sourceHash: computePartHash(boltV1) },
    });

    // Now render with linked component where external source has changed (out-of-date)
    cleanup();
    const linkedDoc = linkInsertedPart(unlinkedDoc, 'F1', { sourceKind: 'tab', sourceUri: 'tab:bolt' });
    const staleHost = createHost(linkedDoc, {
      linkedSources: [{ sourceKind: 'tab', sourceUri: 'tab:bolt', name: 'Bolt', part: boltV2 }],
    });
    const staleView = mountPanel(staleHost.host);

    const badge = staleView.getByTestId('linked-badge-F1');
    expect(badge.textContent).toContain('Linked (out of date)');

    const updateBtn = staleView.getByTestId('update-link-F1');
    fireEvent.click(updateBtn);
    await waitFor(() => expect(staleHost.calls.edits.length).toBe(1));
    expect(staleHost.calls.edits[0]).toEqual([
      { op: 'set', id: 'F1', path: 'part', value: boltV2 },
      {
        op: 'set',
        id: 'F1',
        path: 'linkedRef',
        value: expect.objectContaining({
          sourceKind: 'tab',
          sourceUri: 'tab:bolt',
          sourceHash: computePartHash(boltV2),
          outOfDate: false,
        }),
      },
    ]);

    const breakBtn = staleView.getByTestId('break-link-F1');
    fireEvent.click(breakBtn);
    await waitFor(() => expect(staleHost.calls.edits.length).toBe(2));
    expect(staleHost.calls.edits[1][0]).toMatchObject({
      op: 'replace',
      id: 'F1',
    });
    expect('linkedRef' in (staleHost.calls.edits[1][0] as { feature: Record<string, unknown> }).feature).toBe(false);
  });

  it('renders Flexible / Rigid toggle for subassembly components and shows lifted mates in Mates section', async () => {
    const subasm = makeSubassemblyPart('Gripper');
    const doc: DocLike = {
      features: [
        { id: 'F1', type: 'insertPart', name: 'Plate', part: makePart('Plate'), fixed: true },
        { id: 'F2', type: 'insertPart', name: 'Gripper', part: subasm, dx: 20 },
      ],
    };

    const { host, calls } = createHost(doc);
    const view = mountPanel(host, 'parts');

    // Single-body part F1 does not show a flexible toggle; subassembly F2 shows Rigid toggle button
    expect(view.queryByTestId('toggle-flexible-F1')).toBeNull();
    const toggleBtn = view.getByTestId('toggle-flexible-F2');
    expect(toggleBtn.textContent).toBe('Rigid');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggleBtn);
    await waitFor(() => expect(calls.edits.length).toBe(1));
    expect(calls.edits[0]).toEqual([{ op: 'set', id: 'F2', path: 'flexible', value: true }]);

    // Re-render with F2 marked flexible
    cleanup();
    const flexDoc = setSubassemblyFlexible(doc, 'F2', true);
    const flexHost = createHost(flexDoc);
    const flexPartsView = mountPanel(flexHost.host, 'parts');
    const flexToggleBtn = flexPartsView.getByTestId('toggle-flexible-F2');
    expect(flexToggleBtn.textContent).toBe('Flexible');
    expect(flexToggleBtn.getAttribute('aria-pressed')).toBe('true');

    // Mates section lists lifted internal mates of the flexible subassembly
    cleanup();
    const matesView = mountPanel(flexHost.host, 'mates');
    expect(matesView.getByTestId('lifted-mate-F2:M1').textContent).toContain('F2:JawHinge');
    expect(matesView.getByTestId('lifted-mate-F2:M2').textContent).toContain('F2:JawGuide');
  });
});
