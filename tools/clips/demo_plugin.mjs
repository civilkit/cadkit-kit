// A tiny plugin made for the Plugins clip (31-plugins.mjs): one generator, "Plate", in the app's script dialect, MIT, written for this clip.
// Returns the bytes of a packed zip (stored, no compression) with plugin.json and the script, every file listed with its sha256.
// record.mjs only loads NN-name.mjs files, so this module is not a clip.
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

const SCRIPT = "part(uniqueName(params.name || 'Plate')).sketch('front', (s) => s.rect(params.width, params.height)).extrude(params.thickness);\n";
const enc = (s) => Buffer.from(s, 'utf8');

export function demoPluginZip() {
  const files = { 'gen/plate.js': enc(SCRIPT) };
  const manifest = {
    id: 'demo.plates', name: 'Plates', version: '1.0.0', license: 'MIT', engine: '>=0.7.0', author: 'CivilKit demo',
    description: 'A flat plate of any size.',
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')])),
    contributes: { generators: [{ id: 'plate', title: 'Plate', category: 'Stock', description: 'A flat plate: width, height and thickness.', script: 'gen/plate.js', params: [
      { name: 'name', type: 'string', default: 'Plate', title: 'Name' },
      { name: 'width', type: 'number', default: 80, min: 1, title: 'Width' },
      { name: 'height', type: 'number', default: 50, min: 1, title: 'Height' },
      { name: 'thickness', type: 'number', default: 6, min: 0.1, title: 'Thickness' },
    ] }] },
  };
  const entries = [['plugin.json', enc(JSON.stringify(manifest, null, 1))], ...Object.entries(files)];
  const local = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const n = enc(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    local.push(lh, n, data); central.push(ch, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
