import { describe, expect, it } from 'vitest';
import { zipWrite } from '@kit/io';
import {
  OLE2_MAGIC,
  isCfbBytes,
  isIptBytes,
  buildCfb,
  parseCfb,
  importIpt,
  lengthToMm,
  angleToDeg,
  convertIptExpr,
  sanitizeVarName,
  sha256Hex,
} from './index';

const enc = (s: string) => new TextEncoder().encode(s);

const SAMPLE_STEP = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION(('Autodesk Inventor BRep Body'),'2;1');",
  "FILE_NAME('housing.step','2026-11-23',(''),(''),'Autodesk Inventor 2025','','');",
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
  'ENDSEC;',
  'DATA;',
  "#1 = CARTESIAN_POINT('Origin',(0.,0.,0.));",
  "#2 = CARTESIAN_POINT('Corner',(60.,40.,25.));",
  'ENDSEC;',
  'END-ISO-10303-21;',
].join('\n');

const SAMPLE_SAT = [
  '700 0 1 0',
  '22 Autodesk Inventor 2025 11 ACIS 7.0 NT 24 Mon Nov 23 00:00:00 2026',
  '10 9.9999999999999995e-007 1e-010',
  'body $-1 $1 $-1 $-1 #',
  'lump $-1 $-1 $2 $0 #',
  'shell $-1 $-1 $-1 $3 $-1 $1 #',
  'face $-1 $-1 $-1 $-1 $2 $4 forward single #',
  'plane-surface $-1 0 0 0 0 0 1 1 0 0 forward_v I I I I #',
  'point $-1 5 3 2 #',
  'End-of-ACIS-data',
].join('\n');

describe('OLE2 / CFB container reader and builder', () => {
  it('constructs and parses real OLE2 / CFB containers with both MiniStream (<4096B) and regular FAT (>=4096B) streams', () => {
    const ufrxDoc = JSON.stringify({
      title: 'Flange Coupling',
      partNumber: 'INV-2026-042',
      inventorVersion: '2025.2',
      units: 'mm',
      material: 'Steel',
    });
    const rseDb = JSON.stringify({
      schemaVersion: 29,
      segments: ['UFRxDoc', 'RSeSegInfo', 'DcKernel', 'Parameters', 'BRep', 'iProperties'],
    });
    // Create a large BRep stream (>= 4096 bytes) so regular FAT sectors are exercised alongside MiniFAT
    const paddedStep = SAMPLE_STEP + '\n' + '/* ' + 'A'.repeat(4500) + ' */';

    const cfbBytes = buildCfb([
      { name: 'UFRxDoc', data: ufrxDoc },
      { name: 'RSeDb', data: rseDb },
      { name: 'RSeSegInfo', data: 'UFRxDoc\nDcKernel\nParameters\nBRep' },
      { name: 'BRep/MainBody', data: paddedStep },
    ]);

    expect(isCfbBytes(cfbBytes)).toBe(true);
    expect(isIptBytes(cfbBytes)).toBe(true);
    expect(Array.from(cfbBytes.subarray(0, 8))).toEqual(Array.from(OLE2_MAGIC));

    const parsed = parseCfb(cfbBytes);
    expect(parsed.majorVersion).toBe(3);
    expect(parsed.sectorSize).toBe(512);
    expect(parsed.miniSectorSize).toBe(64);
    expect(parsed.miniStreamCutoff).toBe(4096);

    const streamPaths = parsed.streams.map((s) => s.path);
    expect(streamPaths).toEqual(expect.arrayContaining(['UFRxDoc', 'RSeDb', 'RSeSegInfo', 'BRep/MainBody']));

    // Small streams use MiniStream; large stream (>= 4096B) uses regular FAT sectors
    const ufrxStream = parsed.streamMap.get('ufrxdoc')!;
    expect(ufrxStream.isMiniStream).toBe(true);
    expect(new TextDecoder().decode(ufrxStream.data)).toBe(ufrxDoc);

    const brepStream = parsed.streamMap.get('brep/mainbody')!;
    expect(brepStream.isMiniStream).toBe(false);
    expect(brepStream.size).toBe(paddedStep.length);
    expect(new TextDecoder().decode(brepStream.data)).toBe(paddedStep);
  });

  it('detects valid .ipt bytes and rejects non-ipt buffers in isIptBytes', async () => {
    const validCfb = buildCfb([{ name: 'UFRxDoc', data: '{"title":"Test"}' }]);
    expect(isIptBytes(validCfb)).toBe(true);

    const validZipIpt = await zipWrite([
      { name: 'UFRxDoc', data: enc('{"title":"ZippedIpt"}') },
      { name: 'DcKernel', data: enc('{"features":[]}') },
    ]);
    expect(isIptBytes(validZipIpt)).toBe(true);

    const unrelatedZip = await zipWrite([{ name: 'readme.txt', data: enc('hello') }]);
    expect(isIptBytes(unrelatedZip)).toBe(false);

    expect(isIptBytes(new Uint8Array(0))).toBe(false);
    expect(isIptBytes(new Uint8Array([0xd0, 0xcf, 0x11]))).toBe(false);
    expect(isIptBytes(enc('ISO-10303-21;\nHEADER;\nENDSEC;'))).toBe(false);
    expect(isIptBytes(enc('solid ascii_stl'))).toBe(false);
  });
});

describe('units & parameter conversion (Inventor cm / mm / in / deg / rad -> CadKit mm / deg)', () => {
  it('converts lengths, angles, and compound parameter expressions accurately', () => {
    expect(lengthToMm(5, 'cm')).toBe(50);
    expect(lengthToMm(25.4, 'mm')).toBe(25.4);
    expect(lengthToMm(2, 'in')).toBe(50.8);
    expect(lengthToMm(0.1, 'm')).toBe(100);
    expect(angleToDeg(Math.PI / 2, 'rad')).toBe(90);
    expect(angleToDeg(60, 'deg')).toBe(60);

    expect(convertIptExpr('4.5 cm', 'mm')).toEqual({ expr: '45', numeric: 45, unit: 'mm' });
    expect(convertIptExpr('1 in', 'mm')).toEqual({ expr: '25.4', numeric: 25.4, unit: 'mm' });
    expect(convertIptExpr('width * 2 + 1.5 cm', 'mm')).toEqual({ expr: 'width * 2 + 15', unit: 'mm' });
    expect(sanitizeVarName(' Flanged Width (mm) ')).toBe('Flanged_Width_mm');
    expect(sanitizeVarName('1st_hole')).toBe('p_1st_hole');
  });
});

describe('importIpt — parametric history conversion to CadKit PartDoc', () => {
  it('converts user & model parameters, sketches, extrudes, revolves, holes, fillets, and chamfers', () => {
    const ufrxDoc = JSON.stringify({
      title: 'Bearing Block',
      partNumber: 'BB-100',
      author: 'Engineering',
      material: 'Aluminium',
      inventorVersion: '2025',
      units: { length: 'cm', angle: 'deg' }, // Inventor internal cm
    });

    const rseDb = JSON.stringify({
      segments: ['UFRxDoc', 'RSeDb', 'Parameters', 'DcKernel', 'BRep', 'iProperties'],
    });

    const parameters = JSON.stringify({
      userParameters: [
        { name: 'block_w', expression: '8 cm', comment: 'Block width' },
        { name: 'block_h', expression: '5 cm', comment: 'Block height' },
        { name: 'pad_t', expression: '15 mm' },
        { name: 'bore_d', expression: '20 mm' },
      ],
      modelParameters: [
        { name: 'd0', value: 8, unit: 'cm' },
        { name: 'd1', value: 5, unit: 'cm' },
        { name: 'd2', expression: 'block_w / 4', unit: 'mm' },
      ],
    });

    const dcKernel = JSON.stringify({
      features: [
        {
          type: 'Sketch',
          id: 'sk1',
          name: 'BaseSketch',
          plane: { name: 'XY', offset: 0.4 }, // 0.4 cm = 4 mm offset plane
          entities: [
            { type: 'rectangle', x: 0, y: 0, width: 8, height: 5 }, // cm -> 80 x 50 mm
            { type: 'circle', cx: 4, cy: 2.5, radius: 1.0 }, // cm -> (40, 25), r=10 mm
            { type: 'arc', cx: 1, cy: 1, radius: 0.5, startAngle: 0, endAngle: Math.PI / 2 },
          ],
        },
        {
          type: 'ExtrudeFeature',
          name: 'BaseExtrude',
          sketch: 'BaseSketch',
          operation: 'add',
          depth: 'pad_t', // references parameter pad_t = 15 mm
          end: 'blind',
        },
        {
          type: 'RevolveFeature',
          name: 'CollarRevolve',
          sketch: 'sk1',
          operation: 'add',
          axis: 'Y',
          angle: '180 deg',
        },
        {
          type: 'HoleFeature',
          name: 'MountHole',
          holeType: 'cbore',
          diameter: '8 mm',
          depth: '12 mm',
          cboreDiameter: '14 mm',
          cboreDepth: '4 mm',
          center: [2, 1.5], // cm -> (20, 15) mm
          plane: 'XY',
        },
        {
          type: 'FilletFeature',
          name: 'OuterFillet',
          radius: '3 mm',
          edges: [{ faces: ['F3.side.1', 'F3.top'], at: [40, 0, 15] }],
        },
        {
          type: 'ChamferFeature',
          name: 'TopChamfer',
          distance: '1.5 mm',
          edges: [], // unresolved edges -> kept suppressed with warning
        },
      ],
    });

    const iptBytes = buildCfb([
      { name: 'UFRxDoc', data: ufrxDoc },
      { name: 'RSeDb', data: rseDb },
      { name: 'Parameters', data: parameters },
      { name: 'DcKernel', data: dcKernel },
      { name: 'BRep', data: SAMPLE_STEP },
    ]);

    const res = importIpt(iptBytes, 'bearing_block.ipt');
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('ipt');
    expect(res.name).toBe('Bearing Block');
    expect(res.properties.partNumber).toBe('BB-100');
    expect(res.properties.material).toBe('Aluminium');
    expect(res.part.material).toBe('aluminium');

    // All 6 timeline features were recognized, so B-rep fallback was NOT needed
    expect(res.report.container).toBe('cfb');
    expect(res.report.totalFeatures).toBe(6);
    expect(res.report.recognizedCount).toBe(6);
    expect(res.report.fallbackCount).toBe(0);
    expect(res.report.usedBrepFallback).toBe(false);
    expect(res.report.recognizedFeatures).toEqual([
      'BaseSketch',
      'BaseExtrude',
      'CollarRevolve',
      'MountHole',
      'OuterFillet',
      'TopChamfer',
    ]);
    expect(res.report.segments).toEqual(
      expect.arrayContaining(['UFRxDoc', 'RSeDb', 'Parameters', 'DcKernel', 'BRep']),
    );

    // Parameters converted to mm
    expect(res.part.variables).toEqual([
      { name: 'block_w', expr: '80' },
      { name: 'block_h', expr: '50' },
      { name: 'pad_t', expr: '15' },
      { name: 'bore_d', expr: '20' },
      { name: 'd0', expr: '80' },
      { name: 'd1', expr: '50' },
      { name: 'd2', expr: 'block_w / 4' },
    ]);

    // Check generated CadKit features:
    // F1: offset plane (4 mm), F2: BaseSketch, F3: BaseExtrude, F4: CollarRevolve,
    // F5: MountHoleSketch, F6: MountHole, F7: OuterFillet, F8: TopChamfer
    expect(res.part.features.map((f) => f.type)).toEqual([
      'plane',
      'sketch',
      'extrude',
      'revolve',
      'sketch',
      'hole',
      'fillet',
      'chamfer',
    ]);

    expect(res.part.features[0]).toMatchObject({ type: 'plane', offset: 4, base: { kind: 'std', id: 'front' } });
    expect(res.part.features[1]).toMatchObject({
      type: 'sketch',
      name: 'BaseSketch',
      plane: { kind: 'feature', id: 'F1' },
    });
    const sk1 = res.part.features[1] as { points: Array<{ x: number; y: number }>; entities: Array<Record<string, unknown>> };
    expect(sk1.entities).toHaveLength(6); // 4 rectangle lines + 1 circle + 1 arc
    expect(sk1.points.some((p) => p.x === 80 && p.y === 50)).toBe(true);
    expect(sk1.entities[4]).toMatchObject({ type: 'circle', r: 10 });

    expect(res.part.features[2]).toMatchObject({
      type: 'extrude',
      name: 'BaseExtrude',
      sketch: 'F2',
      depth: 15,
      op: 'add',
      end: 'blind',
    });
    expect(res.part.features[3]).toMatchObject({
      type: 'revolve',
      name: 'CollarRevolve',
      sketch: 'F2',
      axis: 'Y',
      angle: 180,
      op: 'add',
    });
    expect(res.part.features[5]).toMatchObject({
      type: 'hole',
      name: 'MountHole',
      sketch: 'F5',
      kind: 'cbore',
      diameter: 8,
      end: 'blind',
      depth: 12,
      cboreDiameter: 14,
      cboreDepth: 4,
    });
    expect(res.part.features[6]).toMatchObject({
      type: 'fillet',
      name: 'OuterFillet',
      radius: 3,
    });
    expect(res.part.features[7]).toMatchObject({
      type: 'chamfer',
      name: 'TopChamfer',
      distance: 1.5,
      suppressed: true,
    });
  });

  it('converts Box and Cylinder primitives and XML / text stream records into CadKit sketches and extrudes', () => {
    const paramsText = [
      'units = mm',
      'box_l = 40 mm',
      'box_w = 25 mm',
      'box_h = 12 mm',
      'cyl_r = 6 mm',
    ].join('\n');

    const dcKernelXml = [
      '<Features>',
      '  <Box name="BaseBox" length="box_l" width="box_w" height="box_h" operation="add" />',
      '  <Cylinder name="BossCyl" radius="cyl_r" height="20 mm" x="20" y="12.5" z="12" operation="add" />',
      '</Features>',
    ].join('\n');

    const iptBytes = buildCfb([
      { name: 'Parameters', data: paramsText },
      { name: 'DcKernel', data: dcKernelXml },
    ]);

    const res = importIpt(iptBytes, 'primitive_part.ipt');
    expect(res.ok).toBe(true);
    expect(res.report.recognizedCount).toBe(2);
    expect(res.report.fallbackCount).toBe(0);
    expect(res.report.recognizedFeatures).toEqual(['BaseBox', 'BossCyl']);

    // BaseBox -> sketch + extrude; BossCyl (at z=12) -> offset plane + sketch + extrude
    expect(res.part.features.map((f) => f.type)).toEqual([
      'sketch',
      'extrude',
      'plane',
      'sketch',
      'extrude',
    ]);
    expect(res.part.features[1]).toMatchObject({ type: 'extrude', name: 'BaseBox', depth: 12, op: 'add' });
    expect(res.part.features[2]).toMatchObject({ type: 'plane', offset: 12 });
    expect(res.part.features[4]).toMatchObject({ type: 'extrude', name: 'BossCyl', depth: 20, op: 'add' });
  });
});

describe('importIpt — embedded STEP, ACIS SAT, and mesh fallback when history cannot be fully replayed', () => {
  it('falls back to embedded STEP B-rep when unsupported Inventor features (Coil, Loft) are present', () => {
    const dcKernel = JSON.stringify({
      features: [
        {
          type: 'Sketch',
          name: 'ProfileSketch',
          plane: 'XY',
          entities: [{ type: 'circle', cx: 0, cy: 0, radius: 15 }],
        },
        {
          type: 'Extrude',
          name: 'BaseCyl',
          sketch: 'ProfileSketch',
          depth: 30,
        },
        {
          type: 'CoilFeature',
          name: 'HelicalCoil1',
          pitch: 5,
          revolutions: 6,
        },
        {
          type: 'LoftFeature',
          name: 'TransitionLoft1',
        },
      ],
    });

    const iptBytes = buildCfb([
      { name: 'UFRxDoc', data: JSON.stringify({ title: 'Spring Housing', units: 'mm' }) },
      { name: 'DcKernel', data: dcKernel },
      { name: 'BRep', data: SAMPLE_STEP },
    ]);

    const res = importIpt(iptBytes, 'spring_housing.ipt');
    expect(res.ok).toBe(true);
    expect(res.report.totalFeatures).toBe(4);
    expect(res.report.recognizedCount).toBe(2);
    expect(res.report.fallbackCount).toBe(2);
    expect(res.report.recognizedFeatures).toEqual(['ProfileSketch', 'BaseCyl']);
    expect(res.report.fallbackFeatures).toEqual(['HelicalCoil1', 'TransitionLoft1']);
    expect(res.report.usedBrepFallback).toBe(true);
    expect(res.report.brepSource).toBe('step');
    expect(res.report.summary).toContain('2 of 4');
    expect(res.report.summary).toContain('HelicalCoil1');
    expect(res.warnings.some((w) => w.code === 'unsupportedFeature' && w.object === 'HelicalCoil1')).toBe(true);

    // Verify embedded STEP blob is wired as an importStep feature
    const importStepFeat = res.part.features.find((f) => f.type === 'importStep') as Record<string, unknown> | undefined;
    expect(importStepFeat).toBeDefined();
    const blobKey = importStepFeat!.blob as string;
    expect(blobKey).toBe(sha256Hex(SAMPLE_STEP));
    expect(res.part.blobs?.[blobKey]).toBe(SAMPLE_STEP);
  });

  it('reconstructs B-rep fallback from ACIS SAT stream when no parametric features or STEP stream exist', () => {
    const iptBytes = buildCfb([
      { name: 'UFRxDoc', data: 'Title = AcisBodyPart\nUnits = mm' },
      { name: 'Acis/Body1', data: SAMPLE_SAT },
    ]);

    const res = importIpt(iptBytes, 'acis_part.ipt');
    expect(res.ok).toBe(true);
    expect(res.satBodies).toHaveLength(1);
    expect(res.satBodies[0]).toMatchObject({ name: 'Body1', unitsMmPerUnit: 10 });
    expect(res.report.usedBrepFallback).toBe(true);
    expect(res.report.brepSource).toBe('sat');
    expect(res.part.features).toHaveLength(1);
    expect(res.part.features[0]).toMatchObject({ type: 'importStep', name: 'Body1', heal: true });
    const blobKey = (res.part.features[0] as Record<string, unknown>).blob as string;
    expect(res.part.blobs?.[blobKey]).toContain('ISO-10303-21;');
  });

  it('falls back to display mesh when only Graphics / DisplayMesh stream is available', () => {
    const meshStream = JSON.stringify({
      name: 'PreviewMesh',
      positions: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
      indices: [0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3],
    });

    const iptBytes = buildCfb([
      { name: 'UFRxDoc', data: JSON.stringify({ title: 'MeshOnlyPart' }) },
      { name: 'Graphics/DisplayMesh', data: meshStream },
    ]);

    const res = importIpt(iptBytes, 'mesh_only.ipt');
    expect(res.ok).toBe(true);
    expect(res.meshBodies).toHaveLength(1);
    expect(res.meshBodies[0].triangleCount).toBe(4);
    expect(res.report.usedBrepFallback).toBe(true);
    expect(res.report.brepSource).toBe('mesh');
    expect(res.part.meshes).toHaveLength(1);
    expect(res.part.features).toHaveLength(1);
    expect(res.part.features[0].type).toBe('importStep');
  });
});

describe('importIpt — invalid and corrupt buffer handling', () => {
  it('never throws on empty, non-CFB, truncated CFB header, or corrupt sector chains', () => {
    const emptyRes = importIpt(new Uint8Array(0), 'empty.ipt');
    expect(emptyRes.ok).toBe(false);
    expect(emptyRes.error).toMatch(/empty/i);
    expect(emptyRes.part.features).toEqual([]);

    const badMagicRes = importIpt(enc('not an inventor file'), 'bad.ipt');
    expect(badMagicRes.ok).toBe(false);
    expect(badMagicRes.error).toMatch(/not a valid/i);
    expect(badMagicRes.report.container).toBe('invalid');

    // Truncated OLE2 CFB header (has magic 8 bytes + 40 bytes, less than 512 bytes)
    const shortHeader = new Uint8Array(48);
    shortHeader.set(OLE2_MAGIC, 0);
    const truncHeaderRes = importIpt(shortHeader, 'short.ipt');
    expect(truncHeaderRes.ok).toBe(false);
    expect(truncHeaderRes.error).toMatch(/truncated/i);

    // Valid CFB container truncated in the middle
    const fullCfb = buildCfb([
      { name: 'UFRxDoc', data: '{"title":"Truncated"}' },
      { name: 'BRep', data: SAMPLE_STEP },
    ]);
    const halfCfb = fullCfb.subarray(0, 600);
    const halfRes = importIpt(halfCfb, 'half.ipt');
    expect(halfRes.ok).toBe(false);
    expect(halfRes.error).toBeTruthy();

    // Corrupt byte-order mark in CFB header
    const badByteOrder = fullCfb.slice();
    badByteOrder[0x1c] = 0x12;
    badByteOrder[0x1d] = 0x34;
    const bomRes = importIpt(badByteOrder, 'bom.ipt');
    expect(bomRes.ok).toBe(false);
    expect(bomRes.error).toMatch(/byte order/i);
  });
});
