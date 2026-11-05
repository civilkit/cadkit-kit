import { parseHexColor, weld, type MeshBody } from './mesh';
import { zipRead, zipWrite } from './zip';

const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const num = (v: number) => (Object.is(v, -0) ? 0 : v).toPrecision(9).replace(/\.?0+(e|$)/, '$1');
const hex2 = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();

export interface ThreeMfResult { data: Uint8Array; triangles: number; vertices: number; bodies: number }

/** 3MF (a zip of the model XML): units in millimetres, Z up as the kernel has it, one `<object>` and one build item per body,
 *  welded vertices, counter-clockwise triangles. A body with a colour gets a base material (with its opacity as alpha). */
export async function meshToThreeMf(bodies: readonly MeshBody[], opts: { title?: string; deflate?: boolean } = {}): Promise<ThreeMfResult> {
  const mats: string[] = [];
  const matOf = new Map<string, number>();
  const objects: string[] = [];
  const items: string[] = [];
  let triangles = 0, vertices = 0;
  const live = bodies.filter((b) => Math.floor(b.positions.length / 9) > 0);
  live.forEach((b, bi) => {
    const { index, verts } = weld(b.positions);
    const tri: string[] = [];
    for (let t = 0; t < index.length / 3; t++) {
      const a = index[t * 3], c = index[t * 3 + 1], d = index[t * 3 + 2];
      if (a === c || c === d || a === d) continue;
      tri.push(`<triangle v1="${a}" v2="${c}" v3="${d}"/>`);
    }
    if (!tri.length) return;
    const rgb = parseHexColor(b.color);
    let pid = '';
    if (rgb) {
      const alpha = Math.round(Math.min(1, Math.max(0, b.opacity ?? 1)) * 255);
      const col = `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}${hex2(alpha)}`;
      if (!matOf.has(col)) { matOf.set(col, mats.length); mats.push(`<base name="${esc(b.name)}" displaycolor="${col}"/>`); }
      pid = ` pid="1" pindex="${matOf.get(col)}"`;
    }
    const id = objects.length + 2;
    const vs: string[] = [];
    for (let i = 0; i < verts.length; i += 3) vs.push(`<vertex x="${num(verts[i])}" y="${num(verts[i + 1])}" z="${num(verts[i + 2])}"/>`);
    objects.push(`<object id="${id}" name="${esc(b.name || `Body ${bi + 1}`)}" type="model"${pid}><mesh><vertices>${vs.join('')}</vertices><triangles>${tri.join('')}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
    triangles += tri.length; vertices += verts.length / 3;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${NS}">` +
    `<metadata name="Title">${esc(opts.title ?? 'part')}</metadata><metadata name="Application">CAD Kit</metadata>` +
    `<resources>${mats.length ? `<basematerials id="1">${mats.join('')}</basematerials>` : ''}${objects.join('')}</resources>` +
    `<build>${items.join('')}</build></model>\n`;
  const enc = new TextEncoder();
  const data = await zipWrite([
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n') },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ], { deflate: opts.deflate });
  return { data, triangles, vertices, bodies: objects.length };
}

export interface ParsedThreeMf {
  unit: string;
  objects: Array<{ id: number; name: string; color: string | null; positions: Float32Array }>;
  /** Object ids in the build. */
  build: number[];
}

/** Read a 3MF written by `meshToThreeMf` back: the reader the tests (and anything checking a file we wrote) use. */
export async function parseThreeMf(bytes: Uint8Array): Promise<ParsedThreeMf> {
  const files = await zipRead(bytes);
  const f = files.find((x) => x.name === '3D/3dmodel.model');
  if (!f) throw new Error('no 3D/3dmodel.model in the 3MF');
  const xml = new TextDecoder().decode(f.data);
  const unit = /<model[^>]*\bunit="([^"]*)"/.exec(xml)?.[1] ?? 'millimeter';
  const bases = [...xml.matchAll(/<base [^>]*displaycolor="([^"]*)"/g)].map((m) => m[1]);
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const objects: ParsedThreeMf['objects'] = [];
  for (const m of xml.matchAll(/<object ([^>]*)>([\s\S]*?)<\/object>/g)) {
    const attrs = m[1], body = m[2];
    const vs = [...body.matchAll(/<vertex x="([^"]*)" y="([^"]*)" z="([^"]*)"\/>/g)].map((v) => [+v[1], +v[2], +v[3]]);
    const tris = [...body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((v) => [+v[1], +v[2], +v[3]]);
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => t.forEach((vi, k) => { pos.set(vs[vi], i * 9 + k * 3); }));
    const pi = /\bpindex="(\d+)"/.exec(attrs)?.[1];
    objects.push({ id: +/\bid="(\d+)"/.exec(attrs)![1], name: unesc(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? ''), color: pi !== undefined ? bases[+pi] ?? null : null, positions: pos });
  }
  const build = [...xml.matchAll(/<item objectid="(\d+)"/g)].map((m) => +m[1]);
  return { unit, objects, build };
}
