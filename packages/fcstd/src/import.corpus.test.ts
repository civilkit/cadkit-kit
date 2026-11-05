// The importer on the real FreeCAD 1.1.4 documents of packages/fcstd/corpus (no kernel needed): what each feature maps to, and the rule
// that nothing is dropped silently. The numbers FreeCAD measured are compared with the kernel's in corpus.kernel.test.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFcstd, resolveReferences, type FcImport } from './import';

const GEN = process.cwd() + '/packages/fcstd/corpus/generated/';
const bytes = (n: string) => new Uint8Array(readFileSync(GEN + n + '.FCStd'));
const imp = (n: string, body?: string) => importFcstd(bytes(n), n, { body });
const feat = (r: FcImport, type: string) => r.part.features.filter((f) => f.type === type) as Array<Record<string, any>>;

describe('importer on the corpus (real FreeCAD documents)', () => {
  it('every feature of every Body is imported or skipped with a warning that names it', async () => {
    for (const f of readdirSync(GEN).filter((x) => x.endsWith('.FCStd') && !x.includes('.v1.'))) {
      const n = f.slice(0, -6);
      const dump = JSON.parse(readFileSync(GEN + n + '.dump.json', 'utf8'));
      const types = Object.fromEntries(dump.objects.map((o: any) => [o.name, o.typeId]));
      for (const b of dump.bodies) {
        const r = await imp(n, b.name);
        const upto = b.group.indexOf(b.tip);
        for (const name of b.group.slice(0, upto + 1)) {
          if (!/^PartDesign::/.test(types[name]) || /^PartDesign::(Plane|Line|Point|CoordinateSystem)$/.test(types[name])) continue;
          const done = r.steps.some((s) => s.fc === name), skipped = r.skipped.includes(name);
          expect(done || skipped, `${n}/${b.name}: ${name} (${types[name]}) is neither imported nor skipped`).toBe(true);
          if (skipped) expect(r.warnings.some((w) => w.object === name), `${n}/${b.name}: ${name} was skipped without a warning`).toBe(true);
        }
      }
    }
  }, 60000);

  it('says which Part workbench objects it does not import', async () => {
    const r = await imp('60_part_primitives');
    expect(r.warnings.filter((w) => w.code === 'unsupportedObject').map((w) => w.object)).toEqual(expect.arrayContaining(['Box', 'Cylinder', 'Sphere']));
  });

  it('LinearPattern and PolarPattern are imported (a type prefix test once took LinearPattern for a datum line)', async () => {
    const lin = await imp('48_linear_pattern', 'BodyLength');
    expect(feat(lin, 'lpattern')).toMatchObject([{ count: 3, spacing: 20, dir: { kind: 'axis', axis: 'x' } }]);
    const pol = await imp('49_polar_pattern', 'BodyFull');
    expect(feat(pol, 'cpattern')).toMatchObject([{ count: 6, angle: 360, equal: true, axis: { kind: 'axis', axis: 'z' } }]);
  });

  it('origin features of the second Body (X_Axis001, YZ_Plane002 ...) are found by their role', async () => {
    const r = await imp('48_linear_pattern', 'BodyY');
    expect(feat(r, 'lpattern')).toHaveLength(1);
    const m = await imp('47_mirrored', 'BodyPlane');
    expect(feat(m, 'mirror')).toMatchObject([{ plane: { kind: 'std', id: 'right' } }]);
  });

  it('a mirror about a sketch axis becomes the plane through that line along the sketch normal', async () => {
    const r = await imp('47_mirrored', 'BodyAxis');
    expect(feat(r, 'mirror')).toMatchObject([{ plane: { kind: 'std', id: 'top' } }]);
  });

  it('the Body Tip ends the Body: features after it are reported, not imported', async () => {
    const r = await imp('70_body_tip_rolled_back');
    expect(r.steps.map((s) => s.fc)).toEqual(['Pad', 'Pocket']);
    expect(r.warnings.find((w) => w.code === 'afterTip')?.message).toContain('Fillet');
  });

  it('a shadowed sub-element name ("Axis" for Axis0) selects the construction line as the revolve axis', async () => {
    const r = await imp('30_revolution_axes', 'BodyCons');
    expect(r.skipped).toEqual([]);
    expect(feat(r, 'revolve')).toHaveLength(1);
  });

  it('Pad taper, midplane revolve, groove, chamfer types and all-edge fillets map to their kernel options', async () => {
    expect(feat(await imp('21_pad_taper', 'BodyPos'), 'extrude')[0]).toMatchObject({ end: 'blind', depth: 10, draft: 10, draftOut: true });
    expect(feat(await imp('21_pad_taper', 'BodyNeg'), 'extrude')[0]).toMatchObject({ draft: 10 });
    expect(feat(await imp('21_pad_taper', 'BodyNeg'), 'extrude')[0].draftOut).toBeUndefined();
    expect(feat(await imp('30_revolution_axes', 'BodyMid'), 'revolve')[0]).toMatchObject({ end: 'mid', angle: 90 });
    expect(feat(await imp('31_groove', 'BodyPart'), 'revolve')[0]).toMatchObject({ op: 'cut', angle: 180 });
    expect(feat(await imp('36_chamfer', 'BodyAngle'), 'chamfer')[0]).toMatchObject({ chamferType: 'angleDistance', distance: 2, angle: 45 });
    expect(feat(await imp('36_chamfer', 'BodyTwo'), 'chamfer')[0]).toMatchObject({ chamferType: 'distanceDistance', distance: 2, distance2: 3 });
    const all = await imp('35_fillet', 'BodyAll');
    expect(all.edgeRequests[0].names).toHaveLength(12);
  });

  it('Hole: diameter, depth, drill point, counterbore, countersink; the hole sketch holds the centres', async () => {
    const h = feat(await imp('42_hole_simple', 'BodyAngled'), 'hole')[0];
    expect(h).toMatchObject({ kind: 'simple', diameter: 6, end: 'blind', depth: 8, tip: true });
    expect(feat(await imp('42_hole_simple', 'BodyThrough'), 'hole')[0]).toMatchObject({ end: 'through' });
    expect(feat(await imp('43_hole_cuts', 'BodyBore'), 'hole')[0]).toMatchObject({ kind: 'cbore', cboreDiameter: 12, cboreDepth: 3 });
    expect(feat(await imp('43_hole_cuts', 'BodySink'), 'hole')[0]).toMatchObject({ kind: 'countersink', cskDiameter: 12, cskAngle: 90 });
    const sk = await imp('39_hole_sketch_points');
    const pts = (sk.part.features.filter((f) => f.type === 'sketch').pop() as any).entities.filter((e: any) => e.type === 'point');
    expect(pts).toHaveLength(4); // 3 points and the centre of one circle
  });

  it('expressions become part variables and fields that follow them; the sketch is bound by name', async () => {
    const r = await imp('80_spreadsheet_params');
    const vars = Object.fromEntries(((r.part as any).variables as Array<{ name: string; expr: string }>).map((v) => [v.name, v.expr]));
    expect(vars).toMatchObject({ width: '20', height: '30', depth: '10', hole: '6' });
    expect(Object.values(vars).some((e) => /\bhole\b/.test(e) && /\/2/.test(e))).toBe(true); // Params.hole / 2
    const pad = feat(r, 'extrude')[0];
    expect(pad.depth).toBe('=depth');
    const sk = feat(r, 'sketch')[0];
    expect(sk.constraints.filter((c: any) => c.expr).map((c: any) => c.expr).sort()).toEqual(['Sketch_Height', 'Sketch_Width']);
    expect(r.params!.map((p) => p.path)).toEqual(expect.arrayContaining(['Params.alias:width', 'Params.alias:depth']));
  });

  it('a parameter set through the importer changes the field it drives', async () => {
    const r = await imp('10_sketch_rect_pad');
    const p = r.params!.find((x) => x.path === 'Sketch.Constraints.Width')!;
    p.set(r.part, 40);
    const c = feat(r, 'sketch')[0].constraints.find((k: any) => k.expr);
    expect(c.expr).toBe('40');
    const r2 = await imp('20_pad_side_types', 'BodyTwo');
    r2.params!.find((x) => x.path === 'PadTwo.Length2')!.set(r2.part, 7);
    expect(feat(r2, 'extrude').map((f) => f.depth)).toEqual([10, 7]);
  });

  it('a conditional expression has no kernel form: the number FreeCAD computed is kept and the reason given', async () => {
    const r = await imp('83_expr_units_functions');
    expect(r.warnings.some((w) => w.code === 'expressions' && /conditional/.test(w.message))).toBe(true);
  });

  it('refuses what it cannot build instead of building something else', async () => {
    const r = await imp('14_sketch_bspline');
    expect(r.skipped).toEqual(['Pad']);
    expect(r.warnings.find((w) => w.object === 'Pad')?.message).toMatch(/BSplineCurve/);
    expect((await imp('29_pad_profile_face')).warnings.find((w) => w.code === 'profileFace')).toBeTruthy();
    expect((await imp('23_pad_custom_direction', 'BodyAxis')).warnings.find((w) => w.code === 'customVector')).toBeTruthy();
  });

  it('PartDesign primitives: a box is a constrained rectangle and an extrusion, a cone a revolved profile, a sphere the sphere feature', async () => {
    const box = await imp('55_primitives_additive', 'BodyBox');
    expect(feat(box, 'extrude')[0]).toMatchObject({ op: 'add', end: 'blind', depth: 30 });
    expect(feat(box, 'sketch')[0].constraints.map((c: any) => c.type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical', 'hdist', 'vdist']);
    expect(feat(await imp('55_primitives_additive', 'BodySphere'), 'sphere')[0]).toMatchObject({ center: [10, 20, 30], radius: 6 });
    expect(feat(await imp('55_primitives_additive', 'BodyCone'), 'revolve')).toHaveLength(1);
    expect(feat(await imp('56_primitives_subtractive', 'BodyBox'), 'extrude').pop()).toMatchObject({ op: 'cut' });
    const w = await imp('55_primitives_additive', 'BodyWedge');
    expect(w.skipped).toEqual(['AddWedge']);
    const r = await imp('55_primitives_additive', 'BodyBox');
    r.params!.find((x) => x.path === 'AddBox.Length')!.set(r.part, 20);
    expect(feat(r, 'sketch')[0].constraints.find((c: any) => c.id === 'k5').expr).toBe('20');
  });

  it('face references: Thickness, Draft, up to face and a sketch on a face wait for the kernel (resolveReferences) instead of being guessed', async () => {
    const th = await imp('41_thickness', 'BodyIn');
    expect(th.faceRequests).toHaveLength(1);
    expect(th.faceRequests![0].faces[0]).toMatchObject({ normal: [0, 0, 1] }); // Face6 is the top face
    expect(feat(th, 'shell')[0]).toMatchObject({ thickness: 2 });
    expect(feat(th, 'shell')[0].outward).toBeUndefined();
    expect(feat(await imp('41_thickness', 'BodyOut'), 'shell')[0].outward).toBe(true);
    expect((await imp('41_thickness', 'BodyArc')).warnings.find((w) => w.code === 'thicknessJoin')).toBeTruthy();
    const dr = await imp('40_draft', 'BodyIn');
    expect(dr.faceRequests![0].names).toEqual(['Face1', 'Face2', 'Face3', 'Face4', 'Face5']); // four sides and the neutral face
    const up = await imp('25_pocket_types', 'BodyUpToFace');
    expect(feat(up, 'extrude').pop()).toMatchObject({ op: 'cut', end: 'upToFace' });
    expect(feat(await imp('25_pocket_types', 'BodyUpToFace'), 'extrude').length).toBe(2);
    const onFace = await imp('19_sketch_on_face');
    expect(onFace.faceRequests!.some((q) => q.optional && q.needFrame)).toBe(true);
    // without a resolver the features that need faces are removed again and reported
    const left = await resolveReferences(await imp('41_thickness', 'BodyIn'));
    expect(left.skipped).toEqual(['ThickIn']);
    expect(left.warnings.find((w) => w.object === 'ThickIn' && w.code === 'faceReferences')).toBeTruthy();
  });

  it('a sketch moved onto its face by the kernel: the points are written in the kernel frame and the pad direction is kept', async () => {
    const r = await imp('19_sketch_on_face');
    const rq = r.faceRequests!.find((q) => q.optional && q.needFrame)!;
    const sk = r.part.features.find((f) => f.type === 'sketch' && (f.id as string) === rq.feature) as any;
    const p0 = { ...sk.points.find((p: any) => p.id !== 'O') };
    // a frame turned 90 degrees about the face normal (x -> y), origin moved to (5, 0, 10)
    rq.apply(r.part, ['F2.S.top'], [{ o: [5, 0, 10], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] }]);
    const p1 = (r.part.features.find((f) => f.id === rq.feature) as any).points.find((p: any) => p.id === p0.id);
    expect(p1.x).toBeCloseTo(p0.y, 9);
    expect(p1.y).toBeCloseTo(5 - p0.x, 9);
    expect((r.part.features.find((f) => f.id === rq.feature) as any).plane).toEqual({ kind: 'face', id: 'F2.S.top' });
  });

  it('a Part workbench primitive is imported by name (opts.object), turned about Z or not; other Part objects are refused by name', async () => {
    const box = await importFcstd(bytes('60_part_primitives'), 'x', { object: 'Box' });
    expect(box.steps.map((s) => s.fc)).toEqual(['Box']);
    const sk = feat(box, 'sketch')[0];
    expect(sk.points.filter((p: any) => /^p\d$/.test(p.id)).map((p: any) => Math.round(p.x * 1000) / 1000)).toEqual([0, 9.659, 4.483, -5.176]); // 10 x 20 rectangle turned 15 degrees about Z
    expect(feat(box, 'extrude')[0]).toMatchObject({ depth: 30 });
    const cut = await importFcstd(bytes('61_part_boolean'), 'x', { object: 'Cut' });
    expect(cut.skipped).toEqual(['Cut']);
    expect(cut.warnings.find((w) => w.object === 'Cut')?.code).toBe('unsupportedObject');
    expect(feat(await importFcstd(bytes('86_spreadsheet_formulas'), 'x', { object: 'Box' }), 'extrude')[0].depth).toBeTypeOf('string'); // bound to Data.* cells
  });
});
