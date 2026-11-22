import { describe, it, expect } from 'vitest';
import { zipRead, type MeshBody } from '@kit/io';
import { buildUsdzZip, exportUsdz, meshToUsda, meshToUsdz, toUsdPoint, usdIdentifier } from './exportUsdz';

/** A simple right-handed 10 x 20 x 30 mm box (12 triangles) for testing. */
function boxMesh(dx = 10, dy = 20, dz = 30): Float32Array {
  const v = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const tris = [
    [0, 2, 1], [0, 3, 2], // -Z
    [4, 5, 6], [4, 6, 7], // +Z
    [0, 1, 5], [0, 5, 4], // -Y
    [2, 3, 7], [2, 7, 6], // +Y
    [0, 4, 7], [0, 7, 3], // -X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(tris.length * 9);
  let o = 0;
  for (const [a, b, c] of tris) {
    out.set(v[a], o); o += 3;
    out.set(v[b], o); o += 3;
    out.set(v[c], o); o += 3;
  }
  return out;
}

/** Inspect every local file header in a ZIP buffer and return its compression method and payload offset. */
function inspectZipEntries(bytes: Uint8Array): Array<{ name: string; method: number; dataOffset: number; extraLen: number; extraHeaderId: number | null }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const nl = dv.getUint16(p + 28, true);
    const el = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    expect(dv.getUint32(lo, true)).toBe(0x04034b50);
    const method = dv.getUint16(lo + 8, true);
    const lnl = dv.getUint16(lo + 26, true);
    const lel = dv.getUint16(lo + 28, true);
    const dataOffset = lo + 30 + lnl + lel;
    const extraHeaderId = lel >= 4 ? dv.getUint16(lo + 30 + lnl, true) : null;
    entries.push({ name, method, dataOffset, extraLen: lel, extraHeaderId });
    p += 46 + nl + el + cl;
  }
  return entries;
}

describe('USDZ 64-byte aligned ZIP container', () => {
  it('aligns every entry payload to a 64-byte boundary across all filename-length remainders', async () => {
    // Test filename lengths hitting rem = 0, 1, 61, 62, 63 (where 64 - rem is 0, 63, 3, 2, 1)
    const lengths = [1, 10, 31, 32, 33, 34, 35, 64];
    for (const len of lengths) {
      const name = `${'a'.repeat(len)}.usda`;
      const payload = new TextEncoder().encode(`#usda 1.0\n# len=${len}\n`);
      const zip = buildUsdzZip([{ name, data: payload }]);
      const meta = inspectZipEntries(zip);
      expect(meta).toHaveLength(1);
      expect(meta[0].method).toBe(0);
      expect(meta[0].dataOffset % 64, `name len ${name.length}, offset ${meta[0].dataOffset}`).toBe(0);
      if (meta[0].extraLen > 0) {
        expect(meta[0].extraLen).toBeGreaterThanOrEqual(4);
        expect(meta[0].extraHeaderId).toBe(0x1986);
      }
      const decoded = await zipRead(zip);
      expect(decoded).toHaveLength(1);
      expect(decoded[0].name).toBe(name);
      expect(new TextDecoder().decode(decoded[0].data)).toBe(new TextDecoder().decode(payload));
    }
  });

  it('aligns multiple entries in a single USDZ archive to 64-byte boundaries', async () => {
    const files = [
      { name: 'scene.usda', data: new TextEncoder().encode('#usda 1.0\n') },
      { name: 'tex_0.bin', data: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'a'.repeat(33) + '.dat', data: new Uint8Array(77).fill(42) },
    ];
    const zip = buildUsdzZip(files);
    const meta = inspectZipEntries(zip);
    expect(meta).toHaveLength(3);
    for (const entry of meta) {
      expect(entry.method).toBe(0);
      expect(entry.dataOffset % 64, `${entry.name} offset ${entry.dataOffset}`).toBe(0);
    }
    const decoded = await zipRead(zip);
    expect(decoded.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(decoded[2].data.length).toBe(77);
  });
});

describe('USDA scene generation and USDZ export', () => {
  it('converts mm Z-up to cm Y-up with determinant +1', () => {
    expect(toUsdPoint(10, 20, 30)).toEqual([1, 3, -2]);
  });

  it('sanitizes and deduplicates USD prim identifiers', () => {
    const used = new Set<string>();
    expect(usdIdentifier('Body 1', used)).toBe('Body_1');
    expect(usdIdentifier('Body 1', used)).toBe('Body_1_2');
    expect(usdIdentifier('123-part', used)).toBe('_123_part');
    expect(usdIdentifier('   ', used)).toBe('Body');
  });

  it('generates valid USDA with per-body Mesh prims, normals, extent, and UsdPreviewSurface PBR materials', () => {
    const bodies: MeshBody[] = [
      { name: 'Main Housing', positions: boxMesh(10, 20, 30), color: '#ff8000', metallic: 0.8, roughness: 0.25, opacity: 1 },
      { name: 'Glass Lid', positions: boxMesh(10, 20, 2), color: '#88ccff', metallic: 0, roughness: 0.1, opacity: 0.4 },
    ];
    const r = meshToUsda(bodies, { name: 'Enclosure' });
    expect(r.bodies).toBe(2);
    expect(r.triangles).toBe(24);
    expect(r.vertices).toBeGreaterThan(0);

    expect(r.usda).toContain('#usda 1.0');
    expect(r.usda).toContain('defaultPrim = "Root"');
    expect(r.usda).toContain('metersPerUnit = 0.01');
    expect(r.usda).toContain('upAxis = "Y"');
    expect(r.usda).toContain('uniform token info:id = "UsdPreviewSurface"');
    expect(r.usda).toContain('uniform token subdivisionScheme = "none"');
    expect(r.usda).toContain('interpolation = "vertex"');
    expect(r.usda).toContain('def Mesh "Main_Housing"');
    expect(r.usda).toContain('displayName = "Main Housing"');
    expect(r.usda).toContain('def Mesh "Glass_Lid"');
    expect(r.usda).toContain('float inputs:metallic = 0.8');
    expect(r.usda).toContain('float inputs:roughness = 0.25');
    expect(r.usda).toContain('float inputs:opacity = 0.4');
    // Extent of 10x20x30 mm box in cm Y-up: x in [0, 1], y in [0, 3], z in [-2, 0]
    expect(r.usda).toContain('float3[] extent = [(0, 0, -2), (1, 3, 0)]');
  });

  it('packages a valid 64-byte-aligned .usdz archive via exportUsdz', async () => {
    const bodies: MeshBody[] = [
      { name: 'Bracket', positions: boxMesh(10, 10, 10), color: '#336699' },
    ];
    const res = exportUsdz(bodies, 'My Bracket');
    expect(res.file).toBeDefined();
    expect(res.file!.name).toBe('My Bracket.usdz');
    expect(res.file!.mime).toBe('model/vnd.usdz+zip');
    expect(res.notices).toEqual([
      { level: 'info', key: 'io.doneUsdz', params: { name: 'My Bracket.usdz', triangles: 12, bodies: 1 } },
    ]);

    const bytes = res.file!.data as Uint8Array;
    const meta = inspectZipEntries(bytes);
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe('My_Bracket.usda');
    expect(meta[0].method).toBe(0);
    expect(meta[0].dataOffset % 64).toBe(0);

    const entries = await zipRead(bytes);
    const usdaText = new TextDecoder().decode(entries[0].data);
    expect(usdaText.startsWith('#usda 1.0')).toBe(true);
    expect(usdaText).toContain('def Mesh "Bracket"');
  });

  it('returns io.noBody when given empty or null bodies', () => {
    expect(exportUsdz(null, 'Empty').file).toBeUndefined();
    expect(exportUsdz(null, 'Empty').notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
    expect(exportUsdz([{ name: 'Degenerate', positions: [] }], 'Empty').file).toBeUndefined();
  });

  it('includes reference meshes and emits io.refMeshesIncluded notice', () => {
    const part: MeshBody[] = [{ name: 'Part', positions: boxMesh(10, 10, 10) }];
    const ref: MeshBody[] = [{ name: 'Scan', positions: boxMesh(5, 5, 5) }];
    const res = exportUsdz(part, 'Assembly', ref);
    expect(res.file).toBeDefined();
    expect(res.notices).toHaveLength(2);
    expect(res.notices[1]).toEqual({
      level: 'info',
      key: 'io.refMeshesIncluded',
      params: { name: 'Assembly.usdz', count: 1, triangles: 12 },
    });
    const raw = meshToUsdz([...part, ...ref], { name: 'Assembly' });
    expect(raw.bodies).toBe(2);
    expect(raw.triangles).toBe(24);
  });
});
