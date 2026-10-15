import { deflateRawSync } from 'node:zlib';

/** A tiny zip writer for fixtures (one stored or deflated entry per file, no CRC check on read). */
export function zip(files: Record<string, string>, deflate = false): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = [];
  let off = 0;
  const w16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const w32 = (v: DataView, o: number, n: number) => v.setUint32(o, n, true);
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text); const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw; const nm = enc.encode(name);
    const lh = new Uint8Array(30 + nm.length); const lv = new DataView(lh.buffer);
    w32(lv, 0, 0x04034b50); w16(lv, 8, deflate ? 8 : 0); w32(lv, 18, data.length); w32(lv, 22, raw.length); w16(lv, 26, nm.length); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length); const cv = new DataView(ch.buffer);
    w32(cv, 0, 0x02014b50); w16(cv, 10, deflate ? 8 : 0); w32(cv, 20, data.length); w32(cv, 24, raw.length); w16(cv, 28, nm.length); w32(cv, 42, off); ch.set(nm, 46);
    parts.push(lh, data); central.push(ch); off += lh.length + data.length;
  }
  const cdLen = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  w32(ev, 0, 0x06054b50); w16(ev, 8, central.length); w16(ev, 10, central.length); w32(ev, 12, cdLen); w32(ev, 16, off);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

export const pl = (px = 0, py = 0, pz = 0, q = [0, 0, 0, 1]) => `<PropertyPlacement Px="${px}" Py="${py}" Pz="${pz}" Q0="${q[0]}" Q1="${q[1]}" Q2="${q[2]}" Q3="${q[3]}" />`;
const line = (a: number[], b: number[]) => `<Geometry type="Part::GeomLineSegment"><LineSegment StartX="${a[0]}" StartY="${a[1]}" StartZ="0" EndX="${b[0]}" EndY="${b[1]}" EndZ="0"/><Construction value="0"/></Geometry>`;
const coin = (a: number, pa: number, b: number, pb: number) => `<Constrain Type="1" Value="0" First="${a}" FirstPos="${pa}" Second="${b}" SecondPos="${pb}" IsDriving="1"/>`;

/** Body with a 20 x 10 rectangle sketch on XY, a Pad of 5, a Fillet (unsupported) and a Pocket that is up to a face (unsupported). */
export const DOC = `<?xml version='1.0' encoding='utf-8'?><Document SchemaVersion="4"><Objects Count="5">
<Object type="PartDesign::Body" name="Body"/><Object type="Sketcher::SketchObject" name="Sketch"/><Object type="PartDesign::Pad" name="Pad"/>
<Object type="PartDesign::Fillet" name="Fillet"/><Object type="PartDesign::Pocket" name="Pocket"/></Objects>
<ObjectData Count="5">
<Object name="Body"><Properties>
 <Property name="Group" type="App::PropertyLinkList"><LinkList count="4"><Link value="Sketch"/><Link value="Pad"/><Link value="Fillet"/><Link value="Pocket"/></LinkList></Property>
 <Property name="Tip" type="App::PropertyLink"><Link value="Pocket"/></Property></Properties></Object>
<Object name="Sketch"><Properties>
 <Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 0)}</Property>
 <Property name="Geometry" type="Part::PropertyGeometryList"><GeometryList count="4">${line([0, 0], [20, 0])}${line([20, 0], [20, 10])}${line([20, 10], [0, 10])}${line([0, 10], [0, 0])}</GeometryList></Property>
 <Property name="Constraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="6">${coin(0, 2, 1, 1)}${coin(1, 2, 2, 1)}${coin(2, 2, 3, 1)}${coin(3, 2, 0, 1)}
  <Constrain Type="2" Value="0" First="0" FirstPos="0" Second="-2000" SecondPos="0" IsDriving="1"/><Constrain Type="7" Value="20" First="0" FirstPos="1" Second="0" SecondPos="2" IsDriving="1"/></ConstraintList></Property>
</Properties></Object>
<Object name="Pad"><Properties>
 <Property name="Profile" type="App::PropertyLinkSub"><LinkSub value="Sketch" count="1"><Sub value=""/></LinkSub></Property>
 <Property name="Type" type="App::PropertyEnumeration"><Integer value="0"/></Property>
 <Property name="Length" type="App::PropertyLength"><Float value="5"/></Property>
 <Property name="Reversed" type="App::PropertyBool"><Bool value="false"/></Property>
 <Property name="Midplane" type="App::PropertyBool"><Bool value="false"/></Property>
 <Property name="Shape" type="Part::PropertyPartShape"><Part file="Pad.Shape.brp"/></Property></Properties></Object>
<Object name="Fillet"><Properties><Property name="Base" type="App::PropertyLinkSub"><LinkSub value="Pad" count="1"><Sub value="Edge1"/></LinkSub></Property></Properties></Object>
<Object name="Pocket"><Properties>
 <Property name="Profile" type="App::PropertyLinkSub"><LinkSub value="Sketch" count="1"><Sub value=""/></LinkSub></Property>
 <Property name="Type" type="App::PropertyEnumeration"><Integer value="3"/></Property></Properties></Object>
</ObjectData></Document>`;

