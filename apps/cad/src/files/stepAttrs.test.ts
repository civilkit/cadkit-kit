import { describe, expect, it } from 'vitest';
import { lookFor, NAME_PREFIX, type BodyRow } from '../bodies';
import { parseParts, type ImportPart } from './importReport';
import { partOfStep } from './sldprtImport';
import { hexToRgb, rgbToHex, stepExportColors, stepImportAppearance, stepPartBodyNames, stepViewLook } from './stepAttrs';

const part = (label: string, color?: [number, number, number], outcome: ImportPart['outcome'] = 'solid'): ImportPart => ({
  label,
  outcome,
  faces: 6,
  facesTotal: 6,
  ...(color ? { color } : {}),
  reasons: [],
});

describe('STEP RGB <-> hex conversion', () => {
  it('converts 0..1 RGB triples to lowercase #rrggbb and clamps out-of-range values', () => {
    expect(rgbToHex([1, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 1, 0])).toBe('#00ff00');
    expect(rgbToHex([0, 0, 1])).toBe('#0000ff');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([1, 1, 1])).toBe('#ffffff');
    expect(rgbToHex([0.2, 0.4, 0.8])).toBe('#3366cc');
    expect(rgbToHex([-0.5, 1.5, 0.5])).toBe('#00ff80');
  });

  it('rejects invalid RGB inputs', () => {
    expect(rgbToHex(null)).toBeNull();
    expect(rgbToHex(undefined)).toBeNull();
    expect(rgbToHex([1, 0])).toBeNull();
    expect(rgbToHex([Number.NaN, 0, 0])).toBeNull();
    expect(rgbToHex([Number.POSITIVE_INFINITY, 0, 0])).toBeNull();
  });

  it('converts #rrggbb and #rgb hex strings to 0..1 RGB triples and roundtrips', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb(' #3366CC ')).toEqual([0x33 / 255, 0x66 / 255, 0xcc / 255]);
    expect(hexToRgb('#f0a')).toEqual([1, 0, 0xaa / 255]);
    for (const hex of ['#000000', '#ffffff', '#c3ccd8', '#1a2b3c', '#ff8800']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });

  it('rejects invalid hex strings', () => {
    expect(hexToRgb(null)).toBeNull();
    expect(hexToRgb(undefined)).toBeNull();
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('#zzzzzz')).toBeNull();
  });
});

describe('importReport color parsing', () => {
  it('parses optional RGB colors from kernel import.parts replies', () => {
    const parsed = parseParts([
      { label: 'Housing', outcome: 'solid', faces: 6, facesTotal: 6, color: [0.8, 0.2, 0.1], reasons: [] },
      { label: 'Bracket', outcome: 'solid', faces: 6, facesTotal: 6, reasons: [] },
      { label: 'Bad', outcome: 'solid', faces: 6, facesTotal: 6, color: [0.5, 'x', 0.1], reasons: [] },
    ]);
    expect(parsed[0].color).toEqual([0.8, 0.2, 0.1]);
    expect(parsed[1].color).toBeUndefined();
    expect(parsed[2].color).toBeUndefined();
  });
});

describe('STEP import appearances and body names', () => {
  it('deduplicates solid names like kernel sort_step and ignores synthetic solid #N labels', () => {
    const names = stepPartBodyNames([
      part('Bolt', [1, 0, 0]),
      part('Bolt', [0, 1, 0]),
      part('solid #42', [0, 0, 1]),
      part('Sheet', [1, 1, 0], 'surface'),
      part('Bolt', [0, 0, 0]),
    ]);
    expect(names).toEqual(['Bolt', 'Bolt 2', null, null, 'Bolt 3']);
  });

  it('maps named STEP solids to @name:<bodyName> appearances that survive rebuilds', () => {
    const parts = [
      part('Housing', [0.8, 0.2, 0.1]),
      part('Cover', [0.1, 0.4, 0.8]),
      part('Uncolored'),
      part('SurfaceOnly', [0, 1, 0], 'surface'),
    ];
    const app = stepImportAppearance(parts, 'F1');
    expect(app).toEqual({
      [`${NAME_PREFIX}Housing`]: { color: '#cc331a' },
      [`${NAME_PREFIX}Cover`]: { color: '#1a66cc' },
    });
    expect(lookFor({ appearance: app }, '@body:F1.I1F1', 'F1', `${NAME_PREFIX}Housing`)).toEqual({ color: '#cc331a' });
    expect(lookFor({ appearance: app }, '@body:F1.I2F1', 'F1', `${NAME_PREFIX}Cover`)).toEqual({ color: '#1a66cc' });
    expect(lookFor({ appearance: app }, '@body:F1.I3F1', 'F1', `${NAME_PREFIX}Uncolored`)).toEqual({});
  });

  it('uses featureId fallback for an unnamed colored solid while named solids override it', () => {
    const app = stepImportAppearance([
      part('solid #10', [1, 0, 0]),
      part('Lid', [0, 0, 1]),
    ], 'F1');
    expect(app).toEqual({
      F1: { color: '#ff0000' },
      [`${NAME_PREFIX}Lid`]: { color: '#0000ff' },
    });
    expect(lookFor({ appearance: app }, '@body:F1.I1F1', 'F1', null)).toEqual({ color: '#ff0000' });
    expect(lookFor({ appearance: app }, '@body:F1.I2F1', 'F1', `${NAME_PREFIX}Lid`)).toEqual({ color: '#0000ff' });
  });

  it('attaches STEP appearance to partOfStep documents only when colors exist', async () => {
    const withCol = await partOfStep('ISO-10303-21;', 'Asm', 'asm.step', { '@name:Housing': { color: '#cc331a' } });
    expect((withCol as unknown as { appearance?: unknown }).appearance).toEqual({ '@name:Housing': { color: '#cc331a' } });
    const plain = await partOfStep('ISO-10303-21;', 'Plain', 'plain.step', {});
    expect((plain as unknown as { appearance?: unknown }).appearance).toBeUndefined();
  });

  it('builds a view-only look spec for view-only STEP imports', () => {
    const look = stepViewLook(
      { faceBody: [0, 0, 1], bodyNames: ['Housing', 'Lid'] },
      ['I1.F1', 'I1.F2', 'I2.F1'],
      [part('Housing', [1, 0, 0]), part('Lid', [0, 0, 1])],
    );
    expect(look).toEqual({
      bodies: [
        { key: 'step:0', faces: ['I1.F1', 'I1.F2'], edges: [] },
        { key: 'step:1', faces: ['I2.F1'], edges: [] },
      ],
      looks: {
        'step:0': { color: '#ff0000' },
        'step:1': { color: '#0000ff' },
      },
      faces: {},
    });
    expect(stepViewLook({ faceBody: [0], bodyNames: ['Plain'] }, ['I1.F1'], [part('Plain')])).toBeNull();
  });
});

describe('STEP export colors payload', () => {
  const row = (key: string, name: string, color?: string, docName?: string): Pick<BodyRow, 'key' | 'name' | 'docName' | 'look'> => ({
    key,
    name,
    ...(docName ? { docName } : {}),
    look: color ? { color } : {},
  });

  it('builds kernel colors map by body name and respects user overrides over @name: defaults', () => {
    const rows = [
      row('@body:F1.I1F1', 'Housing', '#00ff00', 'Housing'), // user changed Housing from red to green
      row('@body:F1.I2F1', 'Cover', '#0000ff', 'Cover'),
      row('@body:F1.I3F1', 'Plain', undefined, 'Plain'),
    ];
    const colors = stepExportColors(rows, {
      appearance: {
        '@name:Housing': { color: '#ff0000' },
        '@name:Cover': { color: '#0000ff' },
      },
    });
    expect(colors).toEqual({
      Housing: [0, 1, 0],
      Cover: [0, 0, 1],
    });
  });

  it('keys unnamed bodies by their kernel lump index (using lumpIndexByKey when order differs)', () => {
    const rows = [
      row('@body:F2.S1', 'Extrude 2', '#ff0000'),
      row('@body:F1.S1', 'Extrude 1', '#0000ff'),
    ];
    const lumpIndexByKey = new Map([
      ['@body:F1.S1', 0],
      ['@body:F2.S1', 1],
    ]);
    const colors = stepExportColors(rows, undefined, lumpIndexByKey);
    expect(colors).toEqual({
      'Extrude 2': [1, 0, 0],
      '1': [1, 0, 0],
      'Extrude 1': [0, 0, 1],
      '0': [0, 0, 1],
    });
  });

  it('returns an empty object when no bodies have colors', () => {
    expect(stepExportColors([row('@body:F1.S1', 'Box')])).toEqual({});
  });
});
