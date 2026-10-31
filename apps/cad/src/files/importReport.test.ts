import { describe, expect, it } from 'vitest';
import { allSolid, countParts, importSummary, needsRepair, parseParts, parseRepairReport, partLine, repairOp, repairSummary } from './importReport';
import { viewOfImport } from './stepImport';
import { t } from '../i18n';

// what the kernel sends for a file of three solids: one valid, one with a face the reader could not read, one with nothing readable
const PARTS = [
  { label: 'Bracket', outcome: 'solid', faces: 12, facesTotal: 12, reasons: [] },
  { label: 'Cover', outcome: 'surface', faces: 5, facesTotal: 6, surface: 'import.P2', reasons: [
    { code: 'badEntity', faces: ['#106'], message: 'face #106 could not be read: referenced entity not found' },
    { code: 'SHELL_OPEN', faces: ['I2.F3'], message: 'the faces do not close up: 4 edges belong to one face only' },
  ] },
  { label: 'solid #900', outcome: 'refused', faces: 0, facesTotal: 3, reasons: [{ code: 'unsupported', faces: ['#901'], message: 'face #901 could not be read: SWEPT_DISC_SURFACE is not supported' }] },
];

describe('import report', () => {
  it('reads every part with its outcome, faces and reasons; junk entries are dropped', () => {
    const ps = parseParts([...PARTS, { outcome: 'mesh' }, null, 7]);
    expect(ps.map((p) => p.outcome)).toEqual(['solid', 'surface', 'refused']);
    expect(ps[1]).toMatchObject({ label: 'Cover', faces: 5, facesTotal: 6, surface: 'import.P2' });
    expect(ps[1].reasons.map((r) => r.code)).toEqual(['badEntity', 'SHELL_OPEN']);
    expect(ps[2].reasons[0].faces).toEqual(['#901']);
    // the SketchUp form: counts plus a list
    expect(parseParts({ solid: 1, surface: 1, list: PARTS.slice(0, 2) })).toHaveLength(2);
    expect(parseParts(undefined)).toEqual([]);
  });

  it('counts, summary and the needs-repair test', () => {
    const ps = parseParts(PARTS);
    expect(countParts(ps)).toEqual({ solid: 1, surface: 1, refused: 1 });
    expect(needsRepair(ps)).toBe(true);
    expect(allSolid(ps)).toBe(false);
    expect(needsRepair(ps.filter((p) => p.outcome !== 'surface'))).toBe(false);
    const s = importSummary(ps, t);
    expect(s).toContain('1 of 3');
    expect(s).toContain('surface');
    expect(s).toContain('not imported');
    expect(partLine(ps[1], t)).toContain('5 of 6');
  });

  it('Repair is one repairPart feature after the import, with a free id', () => {
    expect(repairOp('F1', [{ id: 'F1' }])).toEqual({ op: 'add', feature: { type: 'repairPart', id: 'F2', target: 'F1' } });
    expect(repairOp('F1', [{ id: 'F1' }, { id: 'F3' }]).feature.id).toBe('F4');
  });

  it('the repair report in words', () => {
    const lines = parseRepairReport({ parts: [
      { surface: 'F1.P1', label: 'Cover', valid: true, rebuilt: ['#106'], sewn: 0, holes: [], volume: 6000, remaining: [] },
      { surface: 'F1.P2', label: 'Lid', valid: false, rebuilt: [], sewn: 2, holes: [{ patched: true }, { patched: false }], volume: null, remaining: [{ code: 'SHELL_OPEN', faces: [], message: 'the faces do not close up' }] },
      { surface: 'F1.P3', label: 'Pin', refused: [{ code: 'repairNothing', faces: [], message: 'nothing to repair' }] },
    ] });
    expect(lines[0]).toMatchObject({ valid: true, rebuilt: 1, volume: 6000 });
    expect(lines[1]).toMatchObject({ valid: false, sewn: 2, patched: 1, holesLeft: 1 });
    expect(lines[2].refused).toBe('nothing to repair');
    const words = repairSummary(lines, t);
    expect(words[0]).toContain('Cover');
    expect(words[1]).toContain('the faces do not close up');
    expect(words[2]).toContain('nothing to repair');
  });
});

describe('an import reply with surface bodies', () => {
  const body = { faces: [{ id: 'I1.F1' }], edges: [], box: { min: [0, 0, 0], max: [1, 1, 1] }, mesh: { positions: [], normals: [], mids: [], triFace: [] } };
  const surf = { faces: [{ id: 'I2.F1' }, { id: 'I2.F2' }], edges: [], box: { min: [0, 0, 0], max: [2, 2, 2] }, mesh: { positions: [], normals: [], mids: [], triFace: [] } };
  it('keeps the parts and counts the surface faces', () => {
    const r = viewOfImport({ errors: [], body, surfaces: [['import.P2', surf]], import: { parts: PARTS } } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts).toHaveLength(3);
    expect(r.faces).toBe(3);
  });
  it('a file whose only part is a surface body still opens (it is not "no solid in the file")', () => {
    const r = viewOfImport({ errors: [], body: { ...body, faces: [] }, surfaces: [['import.P1', surf]], import: { parts: [PARTS[1]] } } as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.faces).toBe(2);
  });
});
