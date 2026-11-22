import { describe, it, expect } from 'vitest';
import type { MeshBody } from '@kit/io';
import {
  buildEmbeddedScene,
  bytesToBase64,
  exportHtmlViewer,
  meshToHtmlViewer,
  type EmbeddedScene,
} from './exportHtmlViewer';

function boxMesh(dx = 10, dy = 20, dz = 30): Float32Array {
  const v = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const tris = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [2, 3, 7], [2, 7, 6],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5],
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

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe('Standalone Shareable HTML Viewer export', () => {
  it('encodes binary buffers to valid base64 round-tripping all byte values', () => {
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    const decoded = decodeBase64(bytesToBase64(src));
    expect(Array.from(decoded)).toEqual(Array.from(src));
  });

  it('produces a single offline HTML file with zero external network dependencies', () => {
    const bodies: MeshBody[] = [
      { name: 'Base Plate', positions: boxMesh(40, 20, 5), color: '#2b6cb0', metallic: 0.7, roughness: 0.3, opacity: 1 },
      { name: 'Cover', positions: boxMesh(40, 20, 15), color: '#e53e3e', metallic: 0.1, roughness: 0.5, opacity: 0.6 },
    ];
    const res = exportHtmlViewer(bodies, 'Motor Mount');
    expect(res.file).toBeDefined();
    expect(res.file!.name).toBe('Motor Mount.html');
    expect(res.file!.mime).toBe('text/html;charset=utf-8');
    expect(res.notices).toEqual([
      { level: 'info', key: 'io.doneHtml', params: { name: 'Motor Mount.html', triangles: 24, bodies: 2 } },
    ]);

    const html = res.file!.data as string;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    // Zero external network references
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    // Interactive viewer controls present
    expect(html).toContain('data-view="iso"');
    expect(html).toContain('data-view="front"');
    expect(html).toContain('data-view="top"');
    expect(html).toContain('data-view="right"');
    expect(html).toContain('data-view="reset"');
    expect(html).toContain('id="clip-on"');
    expect(html).toContain('id="clip-slider"');
    expect(html).toContain('id="body-list"');
    expect(html).toContain('id="theme-btn"');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('webgl2');
  });

  it('embeds valid scene JSON and decodable typed-array geometry buffers', () => {
    const bodies: MeshBody[] = [
      { name: 'Housing', positions: boxMesh(10, 20, 30), color: '#11aa44', opacity: 0.85, metallic: 0.2, roughness: 0.4 },
    ];
    const { html, triangles, vertices, bodies: bodyCount } = meshToHtmlViewer(bodies, { name: 'Gearbox' });
    expect(bodyCount).toBe(1);
    expect(triangles).toBe(12);
    expect(vertices).toBeGreaterThan(0);

    const m = html.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const scene = JSON.parse(m![1]) as EmbeddedScene;
    expect(scene.title).toBe('Gearbox');
    expect(scene.units).toBe('mm');
    expect(scene.upAxis).toBe('Z');
    expect(scene.bounds.min).toEqual([0, 0, 0]);
    expect(scene.bounds.max).toEqual([10, 20, 30]);
    expect(scene.bodies).toHaveLength(1);

    const b = scene.bodies[0];
    expect(b.name).toBe('Housing');
    expect(b.color).toBe('#11aa44');
    expect(b.opacity).toBeCloseTo(0.85, 5);
    expect(b.triangles).toBe(12);

    const posBytes = decodeBase64(b.positionsB64);
    const norBytes = decodeBase64(b.normalsB64);
    const idxBytes = decodeBase64(b.indicesB64);
    const pos = new Float32Array(posBytes.buffer);
    const nor = new Float32Array(norBytes.buffer);
    const idx = new Uint32Array(idxBytes.buffer);
    expect(pos.length).toBe(b.vertices * 3);
    expect(nor.length).toBe(b.vertices * 3);
    expect(idx.length).toBe(12 * 3);
  });

  it('emits syntactically valid inline JavaScript for the WebGL viewer', () => {
    const { html } = meshToHtmlViewer([{ name: 'Cube', positions: boxMesh(10, 10, 10) }], { name: 'Cube' });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    // Parsing with Function constructor verifies zero syntax errors in the generated inline viewer JS
    expect(() => new Function(scripts[0][1])).not.toThrow();
  });

  it('escapes HTML and script-closing sequences in part and body names', () => {
    const nasty = '</script><img src=x onerror=alert(1)>';
    const { html } = meshToHtmlViewer(
      [{ name: nasty, positions: boxMesh(5, 5, 5) }],
      { name: nasty },
    );
    // Must not inject an unescaped closing script tag or raw <img> tag
    expect(html).not.toContain('<img src=x');
    const jsonMatch = html.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]) as EmbeddedScene;
    expect(parsed.title).toBe(nasty);
    expect(parsed.bodies[0].name).toBe(nasty);
  });

  it('returns io.noBody when given empty or null bodies and includes reference meshes when provided', () => {
    expect(exportHtmlViewer(null, 'Empty').file).toBeUndefined();
    expect(exportHtmlViewer(null, 'Empty').notices).toEqual([{ level: 'error', key: 'io.noBody' }]);

    const part: MeshBody[] = [{ name: 'Part', positions: boxMesh(10, 10, 10) }];
    const ref: MeshBody[] = [{ name: 'Scan', positions: boxMesh(5, 5, 5) }];
    const res = exportHtmlViewer(part, 'WithRef', ref);
    expect(res.file).toBeDefined();
    expect(res.notices).toHaveLength(2);
    expect(res.notices[1]).toEqual({
      level: 'info',
      key: 'io.refMeshesIncluded',
      params: { name: 'WithRef.html', count: 1, triangles: 12 },
    });
    const built = buildEmbeddedScene([...part, ...ref], { name: 'WithRef' });
    expect(built.scene.bodies).toHaveLength(2);
    expect(built.triangles).toBe(24);
  });
});
