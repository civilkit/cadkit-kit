import { describe, expect, it } from 'vitest';
import { zipWrite } from '@kit/io';
import {
  importF3d,
  cmToMm,
  lengthToMm,
  angleToDeg,
  convertFusionExpr,
  sanitizeVarName,
  parseSatText,
} from './index';

const enc = (s: string) => new TextEncoder().encode(s);

const SAMPLE_SAT = [
  '700 0 1 0',
  '19 CadKit Synthetic F3D 11 ACIS 7.0 NT 24 Mon Nov 22 00:00:00 2026',
  '10 9.9999999999999995e-007 1e-010',
  'body $-1 $1 $-1 $-1 #',
  'lump $-1 $-1 $2 $0 #',
  'shell $-1 $-1 $-1 $3 $-1 $1 #',
  'face $-1 $-1 $-1 $-1 $2 $4 forward single #',
  'plane-surface $-1 0 0 0 0 0 1 1 0 0 forward_v I I I I #',
  'End-of-ACIS-data',
].join('\n');

const SAMPLE_STEP = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION(('Fusion 360 body'),'2;1');",
  "FILE_NAME('plate.step','2026-11-22',(''),(''),'','','');",
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
  'ENDSEC;',
  'DATA;',
  '#1 = CARTESIAN_POINT(\'Origin\',(0.,0.,0.));',
  'ENDSEC;',
  'END-ISO-10303-21;',
].join('\n');

describe('units conversion (Fusion cm -> CadKit mm)', () => {
  it('converts cm, mm, m, in, ft and angles accurately', () => {
    expect(cmToMm(2.5)).toBe(25);
    expect(cmToMm(0.3)).toBe(3);
    expect(lengthToMm(1, 'in')).toBe(25.4);
    expect(lengthToMm(0.05, 'm')).toBe(50);
    expect(lengthToMm(12, 'mm')).toBe(12);
    expect(lengthToMm(3.5)).toBe(35); // default cm
    expect(angleToDeg(Math.PI / 2, 'rad')).toBe(90);
    expect(angleToDeg(45, 'deg')).toBe(45);
  });

  it('converts scalar and compound Fusion expressions while preserving variable names', () => {
    expect(convertFusionExpr(2.5, 'cm')).toEqual({ expr: '25', numeric: 25, unit: 'mm' });
    expect(convertFusionExpr('2.5 cm', 'cm')).toEqual({ expr: '25', numeric: 25, unit: 'mm' });
    expect(convertFusionExpr('1 in', 'cm')).toEqual({ expr: '25.4', numeric: 25.4, unit: 'mm' });
    expect(convertFusionExpr('45 deg', 'cm')).toEqual({ expr: '45', numeric: 45, unit: 'deg' });
    expect(convertFusionExpr('width * 2 + 1.5 cm', 'cm')).toEqual({ expr: 'width * 2 + 15', unit: 'mm' });
    expect(sanitizeVarName(' Wall Thickness (mm) ')).toBe('Wall_Thickness_mm');
    expect(sanitizeVarName('3d_offset')).toBe('p_3d_offset');
  });
});

describe('importF3d — single .f3d design archives', () => {
  it('unpacks manifest, user parameters (cm -> mm), timeline features, and embedded SAT body', async () => {
    const manifest = JSON.stringify({
      designName: 'Mounting Bracket',
      applicationVersion: '2.0.19994',
      defaultLengthUnits: 'mm',
    });
    const parameters = JSON.stringify({
      userParameters: [
        { name: 'plate_w', expression: '8 cm', comment: 'Bracket width' },
        { name: 'plate_h', value: 4.5 }, // bare Fusion cm -> 45 mm
        { name: 'hole_d', expression: 'plate_h / 3 + 2 mm' },
        { name: 'draft_ang', expression: '15 deg', unit: 'deg' },
      ],
    });
    const timeline = JSON.stringify({
      timeline: [
        {
          type: 'SketchFeature',
          id: 'sk1',
          name: 'BaseSketch',
          plane: { name: 'XY', offset: 0.5 }, // 0.5 cm = 5 mm offset plane
          entities: [
            { type: 'rectangle', x: 0, y: 0, width: 8, height: 4.5 }, // cm -> 80 x 45 mm
            { type: 'circle', cx: 4, cy: 2.25, radius: 0.6 }, // cm -> (40, 22.5), r=6 mm
          ],
        },
        {
          type: 'ExtrudeFeature',
          name: 'BasePad',
          sketch: 'BaseSketch',
          operation: 'NewBodyFeatureOperation',
          depth: 1.2, // 1.2 cm = 12 mm
        },
        {
          type: 'RevolveFeature',
          name: 'BossRevolve',
          sketch: 'sk1',
          operation: 'JoinFeatureOperation',
          axis: 'Y',
          angle: Math.PI, // rad -> 180 deg
        },
        {
          type: 'FilletFeature',
          name: 'EdgeRound',
          radius: 0.2, // 2 mm
          edges: [],
        },
        {
          type: 'ChamferFeature',
          name: 'TopChamfer',
          distance: '1.5 mm',
          edges: ['F2.E1'],
        },
        {
          type: 'LoftFeature',
          name: 'TransitionLoft',
        },
      ],
    });

    const f3d = await zipWrite([
      { name: 'Manifest.dat', data: enc(manifest) },
      { name: 'DesignData/Parameters.json', data: enc(parameters) },
      { name: 'DesignData/Timeline.json', data: enc(timeline) },
      { name: 'FusionAssetName[Active]/Breps.BlobParts/BracketBody.sat', data: enc(SAMPLE_SAT) },
    ]);

    const res = await importF3d(f3d, 'bracket.f3d');
    expect(res.error).toBeUndefined();
    expect(res.kind).toBe('f3d');
    expect(res.name).toBe('Mounting Bracket');
    expect(res.designs).toHaveLength(1);
    expect(res.designs[0]).toMatchObject({ name: 'Mounting Bracket', satCount: 1 });

    // Parameters converted to mm/deg and placed in part.variables
    expect(res.part.variables).toEqual([
      { name: 'plate_w', expr: '80' },
      { name: 'plate_h', expr: '45' },
      { name: 'hole_d', expr: 'plate_h / 3 + 2' },
      { name: 'draft_ang', expr: '15' },
    ]);

    // Timeline features: offset plane + sketch + extrude + revolve + fillet (suppressed) + chamfer
    expect(res.part.features.map((f) => f.type)).toEqual([
      'plane',
      'sketch',
      'extrude',
      'revolve',
      'fillet',
      'chamfer',
    ]);
    expect(res.part.features[0]).toMatchObject({ type: 'plane', offset: 5, base: { kind: 'std', id: 'front' } });
    expect(res.part.features[1]).toMatchObject({ type: 'sketch', name: 'BaseSketch', plane: { kind: 'feature', id: 'F1' } });
    // Verify rectangle + circle cm -> mm conversion
    const sk = res.part.features[1] as { points: Array<{ x: number; y: number }>; entities: Array<Record<string, unknown>> };
    expect(sk.entities).toHaveLength(5); // 4 lines + 1 circle
    expect(sk.entities[4]).toMatchObject({ type: 'circle', r: 6 });
    expect(sk.points.some((p) => p.x === 80 && p.y === 45)).toBe(true);

    expect(res.part.features[2]).toMatchObject({ type: 'extrude', name: 'BasePad', sketch: 'F2', depth: 12, op: 'new' });
    expect(res.part.features[3]).toMatchObject({ type: 'revolve', name: 'BossRevolve', sketch: 'F2', angle: 180, op: 'add' });
    expect(res.part.features[4]).toMatchObject({ type: 'fillet', name: 'EdgeRound', radius: 2, suppressed: true });
    expect(res.part.features[5]).toMatchObject({ type: 'chamfer', name: 'TopChamfer', distance: 1.5, edges: ['F2.E1'] });

    // Unsupported Loft recorded in skipped + warnings; unresolved fillet edges warned
    expect(res.skipped).toEqual(['TransitionLoft']);
    expect(res.warnings.some((w) => w.code === 'unsupportedFeature' && w.object === 'TransitionLoft')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'unresolvedEdges' && w.object === 'EdgeRound')).toBe(true);

    // Embedded SAT body extracted with header mm-per-unit scale
    expect(res.satBodies).toHaveLength(1);
    expect(res.satBodies[0]).toMatchObject({ name: 'BracketBody', unitsMmPerUnit: 10 });
    expect(parseSatText(res.satBodies[0].sat).valid).toBe(true);
  });

  it('parses XML manifest & parameters and wires embedded STEP into part.blobs as importStep', async () => {
    const manifestXml = `<?xml version="1.0"?><AssetManifest><AssetName>Motor Mount</AssetName><DefaultLengthUnits>mm</DefaultLengthUnits></AssetManifest>`;
    const paramsXml = `<UserParameters><Parameter name="thickness" expression="6 mm" unit="mm" /><Parameter name="pitch" expression="2.5 cm" /></UserParameters>`;
    const f3d = await zipWrite([
      { name: 'Manifest.dat', data: enc(manifestXml) },
      { name: 'DesignData/Parameters.xml', data: enc(paramsXml) },
      { name: 'DesignData/MotorMount.step', data: enc(SAMPLE_STEP) },
    ]);

    const res = await importF3d(f3d, 'mount.f3d');
    expect(res.error).toBeUndefined();
    expect(res.name).toBe('Motor Mount');
    expect(res.stepBodies).toHaveLength(1);
    expect(res.part.variables).toEqual([
      { name: 'thickness', expr: '6' },
      { name: 'pitch', expr: '25' },
    ]);
    expect(res.part.features).toHaveLength(1);
    expect(res.part.features[0]).toMatchObject({ type: 'importStep', name: 'MotorMount', heal: true });
    const blobKey = res.part.features[0].blob as string;
    expect(blobKey).toMatch(/^[0-9a-f]{64}$/);
    expect(res.part.blobs?.[blobKey]).toBe(SAMPLE_STEP);
  });

  it('reports binary ASM/ACIS .smb bodies cleanly and promotes ASCII SAT stored as .smb', async () => {
    const fakeSmb = new Uint8Array([...enc('ASM BinaryFile 229.0'), 0, 1, 2, 3, 255, 0, 42]);
    const binaryOnlyF3d = await zipWrite([
      { name: 'Manifest.dat', data: enc('{"designName":"BinaryPart"}') },
      { name: 'FusionAssetName[Active]/Breps.BlobParts/Body1.smb', data: fakeSmb },
    ]);

    const res1 = await importF3d(binaryOnlyF3d, 'bin.f3d');
    expect(res1.error).toBeUndefined();
    expect(res1.binaryBodies).toHaveLength(1);
    expect(res1.binaryBodies[0]).toMatchObject({
      name: 'Body1',
      format: 'smb',
      header: 'ASM BinaryFile 229.0',
    });
    expect(res1.warnings.some((w) => w.code === 'binarySmbOnly')).toBe(true);

    // ASCII SAT stored inside a .smb extension should be promoted to satBodies
    const asciiSmbF3d = await zipWrite([
      { name: 'Manifest.dat', data: enc('{"designName":"AsciiSmb"}') },
      { name: 'DesignData/Solid.smb', data: enc(SAMPLE_SAT) },
    ]);
    const res2 = await importF3d(asciiSmbF3d, 'ascii.f3d');
    expect(res2.satBodies).toHaveLength(1);
    expect(res2.binaryBodies).toHaveLength(0);
  });
});

describe('importF3d — multi-design .f3z assembly archives', () => {
  it('recursively unpacks nested .f3d designs and merges features, variables, and SAT bodies', async () => {
    const childA = await zipWrite([
      { name: 'Manifest.dat', data: enc(JSON.stringify({ designName: 'Housing' })) },
      { name: 'DesignData/Parameters.json', data: enc(JSON.stringify({ parameters: [{ name: 'depth', value: 3 }] })) },
      {
        name: 'DesignData/Timeline.json',
        data: enc(
          JSON.stringify({
            timeline: [
              { type: 'Sketch', name: 'S1', plane: 'XY', entities: [{ type: 'circle', cx: 0, cy: 0, radius: 2 }] },
              { type: 'Extrude', name: 'E1', sketch: 'S1', depth: 3 },
            ],
          }),
        ),
      },
    ]);

    const childB = await zipWrite([
      { name: 'Manifest.dat', data: enc(JSON.stringify({ designName: 'Shaft' })) },
      { name: 'DesignData/Parameters.json', data: enc(JSON.stringify({ parameters: [{ name: 'diam', expression: '12 mm' }] })) },
      { name: 'Breps.BlobParts/ShaftBody.sat', data: enc(SAMPLE_SAT) },
    ]);

    const f3z = await zipWrite([
      { name: 'Manifest.dat', data: enc(JSON.stringify({ designName: 'Gearbox Assembly', references: ['Housing.f3d', 'Shaft.f3d'] })) },
      { name: 'Housing.f3d', data: childA },
      { name: 'Shaft.f3d', data: childB },
    ]);

    const res = await importF3d(f3z, 'gearbox.f3z');
    expect(res.error).toBeUndefined();
    expect(res.kind).toBe('f3z');
    expect(res.name).toBe('Gearbox Assembly');
    expect(res.designs).toHaveLength(2);
    expect(res.designs.map((d) => d.name)).toEqual(['Housing', 'Shaft']);

    // Variables prefixed per component to avoid collisions
    expect(res.part.variables).toEqual([
      { name: 'Housing_depth', expr: '30' },
      { name: 'Shaft_diam', expr: '12' },
    ]);
    expect(res.part.features.map((f) => f.type)).toEqual(['sketch', 'extrude']);
    expect(res.satBodies).toHaveLength(1);
    expect(res.satBodies[0]).toMatchObject({ name: 'ShaftBody', design: 'Shaft' });
  });
});

describe('importF3d — graceful error handling on corrupt/malformed archives', () => {
  it('never throws on empty, non-ZIP, truncated, empty-ZIP, or encrypted archives', async () => {
    const emptyRes = await importF3d(new Uint8Array(0), 'empty.f3d');
    expect(emptyRes.error).toMatch(/empty/i);
    expect(emptyRes.part.features).toEqual([]);

    const garbageRes = await importF3d(enc('not a zip file at all'), 'bad.f3d');
    expect(garbageRes.error).toMatch(/not a valid/i);

    const validZip = await zipWrite([{ name: 'Manifest.dat', data: enc('{"designName":"X"}') }]);
    const truncatedRes = await importF3d(validZip.subarray(0, Math.floor(validZip.length / 2)), 'trunc.f3d');
    expect(truncatedRes.error).toBeTruthy();

    const emptyZip = await zipWrite([]);
    const emptyZipRes = await importF3d(emptyZip, 'zero.f3d');
    expect(emptyZipRes.error).toMatch(/no files/i);

    // Flip general purpose bit 0 (encrypted) in both local header (offset 6) and central directory header
    const encryptedZip = validZip.slice();
    encryptedZip[6] |= 0x01;
    // Locate central directory header signature 0x02014b50
    for (let i = 0; i < encryptedZip.length - 10; i++) {
      if (encryptedZip[i] === 0x50 && encryptedZip[i + 1] === 0x4b && encryptedZip[i + 2] === 0x01 && encryptedZip[i + 3] === 0x02) {
        encryptedZip[i + 8] |= 0x01;
        break;
      }
    }
    const encRes = await importF3d(encryptedZip, 'locked.f3d');
    expect(encRes.error).toMatch(/encrypted/i);
  });

  it('guards against excessive .f3z nesting depth', async () => {
    const inner = await zipWrite([{ name: 'Manifest.dat', data: enc('{"designName":"Leaf"}') }]);
    const mid = await zipWrite([{ name: 'leaf.f3d', data: inner }]);
    const outer = await zipWrite([{ name: 'mid.f3z', data: mid }]);

    const res = await importF3d(outer, 'deep.f3z', { maxDepth: 1 });
    expect(res.warnings.some((w) => w.code === 'maxDepthExceeded')).toBe(true);
  });
});
