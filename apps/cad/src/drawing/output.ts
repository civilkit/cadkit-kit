// Sheet output: PDF (written here, no library), DXF (R12 text), and print through the browser. All from the primitive list.
import type { Prim } from './render';
import type { V2 } from './model';

const MM = 72 / 25.4;
const f = (n: number): string => String(+n.toFixed(3));

function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out.push(c === 0x2026 ? 0x85 : c < 256 ? c : 0x3f);
  }
  return out;
}
/** Rough Helvetica advance: enough to centre and right-align short labels. */
function textWidth(s: string, size: number, bold?: boolean): number {
  let w = 0;
  for (const ch of s) w += /[ijl.,:;'|!]/.test(ch) ? 0.25 : /[mwMW]/.test(ch) ? 0.83 : /[A-ZØ]/.test(ch) ? 0.68 : 0.556;
  return w * size * (bold ? 1.06 : 1);
}

/** A one-page PDF of the sheet at its real size (vector lines, Helvetica text). */
export function toPdf(prims: Prim[], size: V2): Uint8Array {
  const [W, H] = size;
  const H_ = H * MM;
  const px = (x: number) => f(x * MM), py = (y: number) => f(H_ - y * MM);
  const c: string[] = ['0 G 0 g 1 J 1 j'];
  const path = (pts: number[], close: boolean) => {
    let s = '';
    for (let i = 0; i < pts.length; i += 2) s += `${px(pts[i])} ${py(pts[i + 1])} ${i === 0 ? 'm' : 'l'}\n`;
    return s + (close ? 'h\n' : '');
  };
  const texts: string[] = [];
  for (const p of prims) {
    if (p.t === 'poly') {
      if (p.fill) { c.push(path(p.pts, true) + 'f'); continue; }
      c.push(`${f(p.w * MM)} w ${p.dash ? `[${p.dash.map((d) => f(d * MM)).join(' ')}] 0 d` : '[] 0 d'}\n${path(p.pts, !!p.closed)}S`);
    } else if (p.t === 'circle' || p.t === 'arc') {
      const a0 = p.t === 'arc' ? p.a0 : 0, a1 = p.t === 'arc' ? p.a1 : Math.PI * 2;
      const n = Math.max(12, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 96));
      const pts: number[] = [];
      for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(p.c[0] + Math.cos(a) * p.r, p.c[1] - Math.sin(a) * p.r); }
      c.push(`${f(p.w * MM)} w [] 0 d\n${path(pts, p.t === 'circle')}S`);
    } else {
      const w = textWidth(p.s, p.size, p.bold);
      const off = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
      const rad = (-p.rot * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
      // text origin moved along the baseline by `off`
      const ox = p.x + off * Math.cos((p.rot * Math.PI) / 180), oy = p.y + off * Math.sin((p.rot * Math.PI) / 180);
      const bytes = winAnsi(p.s).map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : String.fromCharCode(b))).join('');
      texts.push(`BT /${p.bold ? 'F2' : 'F1'} ${f(p.size * MM)} Tf ${f(cs)} ${f(sn)} ${f(-sn)} ${f(cs)} ${px(ox)} ${py(oy)} Tm (${bytes}) Tj ET`);
    }
  }
  const stream = c.join('\n') + '\n' + texts.join('\n');
  const objs: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W * MM)} ${f(H_)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // every character is one byte (latin1): the stream was built from WinAnsi byte values
  const u = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 0xff;
  return u;
}

const LAYERS: Record<string, { color: number; ltype: string }> = {
  border: { color: 7, ltype: 'CONTINUOUS' }, visible: { color: 7, ltype: 'CONTINUOUS' }, hidden: { color: 8, ltype: 'HIDDEN' },
  thin: { color: 7, ltype: 'CONTINUOUS' }, center: { color: 1, ltype: 'CENTER' }, dim: { color: 3, ltype: 'CONTINUOUS' },
  text: { color: 7, ltype: 'CONTINUOUS' }, hatch: { color: 9, ltype: 'CONTINUOUS' },
};

/** DXF (R2000 ASCII, LWPOLYLINE) of the sheet, millimetres, y up, one layer per line style. */
export function toDxf(prims: Prim[], size: V2): string {
  const H = size[1];
  const o: string[] = [];
  const g = (code: number, v: string | number) => o.push(String(code), typeof v === 'number' ? String(+v.toFixed(5)) : v);
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1015'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'HIDDEN'); g(70, 0); g(3, 'Hidden'); g(72, 65); g(73, 2); g(40, 3.6); g(49, 2.4); g(49, -1.2);
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center'); g(72, 65); g(73, 4); g(40, 12.5); g(49, 8); g(49, -1.5); g(49, 1.5); g(49, -1.5);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  for (const [n, l] of Object.entries(LAYERS)) { g(0, 'LAYER'); g(2, n.toUpperCase()); g(70, 0); g(62, l.color); g(6, l.ltype); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const Y = (y: number) => H - y;
  for (const p of prims) {
    const layer = p.layer.toUpperCase();
    if (p.t === 'poly') {
      if (p.fill) continue;                      // arrow heads: leave out, the lines carry the dimension
      g(0, 'LWPOLYLINE'); g(8, layer); g(90, p.pts.length / 2); g(70, p.closed ? 1 : 0);
      for (let i = 0; i < p.pts.length; i += 2) { g(10, p.pts[i]); g(20, Y(p.pts[i + 1])); }
    } else if (p.t === 'circle') {
      g(0, 'CIRCLE'); g(8, layer); g(10, p.c[0]); g(20, Y(p.c[1])); g(30, 0); g(40, p.r);
    } else if (p.t === 'arc') {
      g(0, 'ARC'); g(8, layer); g(10, p.c[0]); g(20, Y(p.c[1])); g(30, 0); g(40, p.r); g(50, (p.a0 * 180) / Math.PI); g(51, (p.a1 * 180) / Math.PI);
    } else {
      const w = textWidth(p.s, p.size, p.bold), off = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
      const rad = (p.rot * Math.PI) / 180;
      g(0, 'TEXT'); g(8, layer); g(10, p.x + off * Math.cos(rad)); g(20, Y(p.y - off * Math.sin(rad))); g(30, 0); g(40, p.size); g(1, p.s.replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/…/g, '...')); g(50, -p.rot);
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\n') + '\n';
}

/** Print the sheet: a hidden frame holding the SVG, sized to the page, printed and removed. */
export function printSvg(svg: string, size: V2): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><title>Drawing</title><style>@page{size:${size[0]}mm ${size[1]}mm;margin:0}html,body{margin:0}svg{display:block;width:${size[0]}mm;height:${size[1]}mm}</style></head><body>${svg}</body></html>`);
  d.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow!.addEventListener('afterprint', done);
  setTimeout(() => { frame.contentWindow!.focus(); frame.contentWindow!.print(); }, 50);
}
