// Autodesk Inventor (.ipt) OLE2 / Compound File Binary (CFB) reader and history-preserving importer.
// Clean-room, zero-dependency TypeScript implementation:
//  - Parses OLE2 / CFB containers (magic D0 CF 11 E0 A1 B1 1A E1) including Header, DIFAT, FAT, MiniFAT,
//    MiniStream, and UTF-16LE directory entries (as well as ZIP-packaged RSe containers and JSON/text streams).
//  - Extracts Inventor streams: UFRxDoc, RSeDb, RSeSegInfo, Parameters, DcKernel, BRep / Acis / ASM,
//    display meshes (Graphics / DisplayMesh), and iProperties.
//  - Converts user & model parameters (mm, cm, in, m, ft, deg, rad) and parametric features
//    (sketch, extrude, revolve, hole, fillet, chamfer, box, cylinder, plane) into a CadKit PartDoc (@ck/part-model).
//  - Extracts embedded B-rep payloads (STEP ISO-10303-21 blocks, ACIS SAT text blocks converted/reconstructed,
//    and display meshes) so parts with unsupported native features fall back cleanly with a detailed IptImportReport.

import {
  emptyPart,
  type EdgeRef,
  type ExtrudeEnd,
  type ExtrudeOp,
  type Feature,
  type PartDoc,
  type PlaneId,
  type SketchConstraint,
  type SketchEntity,
  type SketchPlane,
  type SketchPoint,
} from '@ck/part-model';

// ---------------------------------------------------------------------------
// Constants & Magic Signatures
// ---------------------------------------------------------------------------

/** Standard 8-byte OLE2 / Compound File Binary (MS-CFB) header signature. */
export const OLE2_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const MAXREGSECT = 0xfffffffa;
const NOSTREAM = 0xffffffff;

const KNOWN_INVENTOR_MARKERS = [
  'ufrxdoc',
  'rsedb',
  'rseseginfo',
  'rsestorage',
  'dckernel',
  'parameters',
  'brep',
  'acis',
  'asm',
  'iproperties',
  'designview',
  'inventor',
];

// ---------------------------------------------------------------------------
// Synchronous Pure-JS SHA-256 (for PartDoc.blobs content-addressed keys)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Compute lower-case hex SHA-256 of a UTF-8 string synchronously. */
export function sha256Hex(text: string): string {
  const raw = new TextEncoder().encode(text);
  const bitLen = raw.length * 8;
  const padLen = ((raw.length + 9 + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(raw);
  buf[raw.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Low-level Binary & Text Helpers
// ---------------------------------------------------------------------------

const u16le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function writeU16le(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}

function writeU32le(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** Decode a buffer that may be UTF-8 or UTF-16LE into a string. */
export function decodeText(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  // UTF-16LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeUtf16le(bytes.subarray(2));
  }
  // Heuristic: if even length >= 4 and nearly every odd byte is 0x00 while even bytes are ASCII printable
  if (bytes.length >= 6 && bytes.length % 2 === 0) {
    const samplePairs = Math.min(32, bytes.length >>> 1);
    let zeroOdds = 0;
    let asciiEvens = 0;
    for (let i = 0; i < samplePairs; i++) {
      const ev = bytes[i * 2];
      const od = bytes[i * 2 + 1];
      if (od === 0) zeroOdds++;
      if (ev >= 9 && ev <= 126) asciiEvens++;
    }
    if (zeroOdds >= samplePairs * 0.85 && asciiEvens >= samplePairs * 0.7) {
      return decodeUtf16le(bytes);
    }
  }
  const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function decodeUtf16le(bytes: Uint8Array): string {
  const len = bytes.length >>> 1;
  const codes: number[] = [];
  for (let i = 0; i < len; i++) {
    const code = u16le(bytes, i * 2);
    if (code === 0) break;
    codes.push(code);
  }
  return String.fromCharCode(...codes);
}

/** Strip OLE2 control prefixes (like 0x01..0x05 in `\x05SummaryInformation`) for normalized stream lookup. */
export function cleanStreamName(raw: string): string {
  return raw.replace(/^[\u0000-\u001f]+/, '').replace(/[\u0000-\u001f]+$/g, '').trim();
}

// ---------------------------------------------------------------------------
// OLE2 / Compound File Binary (CFB) Reader & Builder
// ---------------------------------------------------------------------------

export interface CfbDirectoryEntry {
  index: number;
  name: string;
  cleanName: string;
  path: string;
  type: 'empty' | 'storage' | 'stream' | 'root';
  rawType: number;
  startSector: number;
  size: number;
  leftSibling: number;
  rightSibling: number;
  child: number;
}

export interface CfbStream {
  name: string;
  cleanName: string;
  path: string;
  size: number;
  data: Uint8Array;
  isMiniStream: boolean;
}

export interface CfbContainer {
  majorVersion: number;
  minorVersion: number;
  sectorSize: number;
  miniSectorSize: number;
  miniStreamCutoff: number;
  entries: CfbDirectoryEntry[];
  streams: CfbStream[];
  streamMap: Map<string, CfbStream>;
}

/** True when `bytes` begins with the 8-byte OLE2 / CFB signature `D0 CF 11 E0 A1 B1 1A E1`. */
export function isCfbBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== OLE2_MAGIC[i]) return false;
  }
  return true;
}

function looksLikeZip(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 22) return false;
  const sig = u32le(bytes, 0);
  return sig === 0x04034b50 || sig === 0x06054b50;
}

/**
 * Check whether a byte buffer is an Autodesk Inventor `.ipt` container.
 * Recognizes:
 *  - OLE2 / Compound File Binary (CFB) containers (magic `D0 CF 11 E0 A1 B1 1A E1`)
 *  - ZIP-packaged Inventor / RSe containers with Inventor stream entries
 *  - JSON-serialized `.ipt` containers tagged with `"format": "ipt"` / `"inventor"`
 */
export function isIptBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 8) return false;

  if (isCfbBytes(bytes)) {
    // Reject truncated headers that claim to be CFB but are shorter than 32 bytes
    if (bytes.length < 32) return false;
    // Check byte-order marker if full header is present
    if (bytes.length >= 512) {
      const byteOrder = u16le(bytes, 0x1c);
      const sectorShift = u16le(bytes, 0x1e);
      if (byteOrder !== 0xfffe && byteOrder !== 0xfeff) return false;
      if (sectorShift < 7 || sectorShift > 16) return false;
    }
    return true;
  }

  if (looksLikeZip(bytes)) {
    try {
      const entries = readZipStoredEntries(bytes, true);
      return entries.some((e) => {
        const lower = e.name.toLowerCase();
        return KNOWN_INVENTOR_MARKERS.some((m) => lower.includes(m));
      });
    } catch {
      return false;
    }
  }

  // Check for JSON-formatted .ipt descriptor
  if (bytes[0] === 0x7b) {
    try {
      const head = decodeText(bytes.subarray(0, Math.min(bytes.length, 4096))).trim();
      if (head.startsWith('{')) {
        const parsed = JSON.parse(decodeText(bytes)) as Record<string, unknown>;
        const fmt = String(parsed.format ?? parsed.kind ?? '').toLowerCase();
        if (fmt === 'ipt' || fmt === 'inventor' || 'ufrxdoc' in parsed || 'dckernel' in parsed || 'UFRxDoc' in parsed || 'DcKernel' in parsed) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Parse an OLE2 / Compound File Binary (CFB) container and extract all directory entries and streams.
 * Throws a descriptive Error if the container header, FAT, or directory is corrupt or truncated.
 */
export function parseCfb(bytes: Uint8Array): CfbContainer {
  if (!bytes || bytes.length < 512) {
    throw new Error('CFB container is truncated (fewer than 512 bytes for OLE2 header)');
  }
  if (!isCfbBytes(bytes)) {
    throw new Error('invalid OLE2 / CFB magic signature (expected D0 CF 11 E0 A1 B1 1A E1)');
  }

  const minorVersion = u16le(bytes, 0x18);
  const majorVersion = u16le(bytes, 0x1a);
  const byteOrder = u16le(bytes, 0x1c);
  if (byteOrder !== 0xfffe) {
    throw new Error(`unsupported CFB byte order 0x${byteOrder.toString(16)} (expected little-endian 0xFFFE)`);
  }

  const sectorShift = u16le(bytes, 0x1e);
  if (sectorShift !== 9 && sectorShift !== 12) {
    throw new Error(`invalid CFB sector shift ${sectorShift} (expected 9 for 512B or 12 for 4096B)`);
  }
  const sectorSize = 1 << sectorShift;

  const miniSectorShift = u16le(bytes, 0x20) || 6;
  const miniSectorSize = 1 << miniSectorShift;

  const numFatSectors = u32le(bytes, 0x2c);
  const firstDirSector = u32le(bytes, 0x30);
  const miniStreamCutoff = u32le(bytes, 0x38) || 4096;
  const firstMiniFatSector = u32le(bytes, 0x3c);
  const numMiniFatSectors = u32le(bytes, 0x40);
  const firstDifatSector = u32le(bytes, 0x44);
  const numDifatSectors = u32le(bytes, 0x48);

  const totalSectorsInFile = Math.floor((bytes.length - 512) / sectorSize);
  if (totalSectorsInFile <= 0) {
    throw new Error('CFB container has no data sectors after the 512-byte header');
  }

  const sectorOffset = (sid: number): number => {
    // Version 3 uses 512-byte header; Version 4 uses 4096-byte header (1 sector)
    const headerSize = Math.max(512, sectorSize);
    return headerSize + sid * sectorSize;
  };

  const readSector = (sid: number): Uint8Array => {
    const off = sectorOffset(sid);
    if (sid > MAXREGSECT || off < 0 || off + sectorSize > bytes.length) {
      throw new Error(`CFB sector ${sid} is out of bounds (file size ${bytes.length})`);
    }
    return bytes.subarray(off, off + sectorSize);
  };

  // 1. Collect FAT sector IDs from header DIFAT (109 entries at 0x4C..0x1FF) + DIFAT sector chain
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109; i++) {
    const sid = u32le(bytes, 0x4c + i * 4);
    if (sid !== FREESECT && sid !== ENDOFCHAIN) {
      fatSectorIds.push(sid);
    }
  }

  if (numDifatSectors > 0 && firstDifatSector !== ENDOFCHAIN && firstDifatSector !== FREESECT) {
    let difatSid = firstDifatSector;
    const seenDifat = new Set<number>();
    const entriesPerDifat = (sectorSize >>> 2) - 1;
    for (let step = 0; step < numDifatSectors && difatSid <= MAXREGSECT; step++) {
      if (seenDifat.has(difatSid)) {
        throw new Error('cyclic DIFAT chain in CFB container');
      }
      seenDifat.add(difatSid);
      const sec = readSector(difatSid);
      for (let j = 0; j < entriesPerDifat; j++) {
        const sid = u32le(sec, j * 4);
        if (sid !== FREESECT && sid !== ENDOFCHAIN) {
          fatSectorIds.push(sid);
        }
      }
      difatSid = u32le(sec, entriesPerDifat * 4);
    }
  }

  if (fatSectorIds.length === 0 || numFatSectors === 0) {
    throw new Error('CFB container has no FAT sectors');
  }

  // 2. Assemble flat FAT table
  const intsPerSector = sectorSize >>> 2;
  const fatCount = fatSectorIds.length * intsPerSector;
  const fat = new Uint32Array(fatCount);
  fat.fill(FREESECT);

  for (let i = 0; i < fatSectorIds.length; i++) {
    const sec = readSector(fatSectorIds[i]);
    const base = i * intsPerSector;
    for (let j = 0; j < intsPerSector; j++) {
      fat[base + j] = u32le(sec, j * 4);
    }
  }

  // Helper to read a chain of regular sectors
  const readRegularChain = (startSid: number, expectedSize?: number, allowPartial = false): Uint8Array => {
    if (startSid === ENDOFCHAIN || startSid === FREESECT || expectedSize === 0) {
      return new Uint8Array(0);
    }
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let sid = startSid;
    let totalRead = 0;
    const maxSectors = totalSectorsInFile + 2;

    while (sid !== ENDOFCHAIN && sid !== FREESECT) {
      if (seen.has(sid) || seen.size > maxSectors) {
        throw new Error(`cyclic or runaway FAT chain starting at sector ${startSid}`);
      }
      if (sid > MAXREGSECT || sectorOffset(sid) + sectorSize > bytes.length) {
        if (allowPartial && chunks.length > 0) break;
        throw new Error(`FAT chain references out-of-bounds sector ${sid}`);
      }
      seen.add(sid);
      const sec = readSector(sid);
      chunks.push(sec);
      totalRead += sec.length;
      if (expectedSize !== undefined && totalRead >= expectedSize) break;
      sid = sid < fat.length ? fat[sid] : ENDOFCHAIN;
      if (sid === FATSECT || sid === DIFSECT) {
        throw new Error(`corrupt FAT chain at sector ${startSid}: points to reserved sector marker`);
      }
    }

    const finalLen = expectedSize !== undefined ? Math.min(expectedSize, totalRead) : totalRead;
    const out = new Uint8Array(finalLen);
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, finalLen - pos);
      if (take <= 0) break;
      out.set(c.subarray(0, take), pos);
      pos += take;
    }
    return out;
  };

  // 3. Read Directory stream
  const dirBytes = readRegularChain(firstDirSector);
  if (dirBytes.length < 128) {
    throw new Error('CFB directory stream is empty or truncated');
  }

  const numDirEntries = Math.floor(dirBytes.length / 128);
  const entries: CfbDirectoryEntry[] = [];

  for (let i = 0; i < numDirEntries; i++) {
    const base = i * 128;
    const nameByteLen = u16le(dirBytes, base + 0x40);
    const rawType = dirBytes[base + 0x42];
    const leftSibling = u32le(dirBytes, base + 0x44);
    const rightSibling = u32le(dirBytes, base + 0x48);
    const child = u32le(dirBytes, base + 0x4c);
    const startSector = u32le(dirBytes, base + 0x74);
    const sizeLow = u32le(dirBytes, base + 0x78);
    const sizeHigh = u32le(dirBytes, base + 0x7c);
    const size = majorVersion >= 4 && sizeHigh < 0x100 ? sizeLow + sizeHigh * 0x100000000 : sizeLow;

    let name = '';
    if (nameByteLen >= 2 && nameByteLen <= 64) {
      const charCount = (nameByteLen >>> 1) - 1;
      const chars: number[] = [];
      for (let c = 0; c < charCount; c++) {
        const code = u16le(dirBytes, base + c * 2);
        if (code === 0) break;
        chars.push(code);
      }
      name = String.fromCharCode(...chars);
    }

    const type: CfbDirectoryEntry['type'] =
      rawType === 5 ? 'root' : rawType === 1 ? 'storage' : rawType === 2 ? 'stream' : 'empty';
    const clean = cleanStreamName(name);

    entries.push({
      index: i,
      name,
      cleanName: clean,
      path: clean,
      type,
      rawType,
      startSector,
      size,
      leftSibling,
      rightSibling,
      child,
    });
  }

  // 4. Traverse directory hierarchy (red-black tree per storage) to assign paths
  const visitedDir = new Set<number>();
  const traverseSiblingTree = (nodeIdx: number, parentPath: string): void => {
    if (nodeIdx === NOSTREAM || nodeIdx >= entries.length || visitedDir.has(nodeIdx)) return;
    visitedDir.add(nodeIdx);
    const entry = entries[nodeIdx];
    if (entry.type === 'empty') return;

    traverseSiblingTree(entry.leftSibling, parentPath);

    const seg = entry.cleanName || entry.name || `Entry${nodeIdx}`;
    entry.path = parentPath ? `${parentPath}/${seg}` : seg;
    if (entry.type === 'storage' && entry.child !== NOSTREAM) {
      traverseSiblingTree(entry.child, entry.path);
    }

    traverseSiblingTree(entry.rightSibling, parentPath);
  };

  const rootEntry = entries[0];
  if (rootEntry && rootEntry.type === 'root' && rootEntry.child !== NOSTREAM) {
    visitedDir.add(0);
    traverseSiblingTree(rootEntry.child, '');
  }

  // Also ensure any flat/unlinked stream entries in the directory table have paths
  for (const e of entries) {
    if (!visitedDir.has(e.index) && e.type === 'stream' && e.cleanName) {
      e.path = e.cleanName;
    }
  }

  // 5. Read MiniFAT & MiniStream (if present)
  let miniFat = new Uint32Array(0);
  if (numMiniFatSectors > 0 && firstMiniFatSector !== ENDOFCHAIN && firstMiniFatSector !== FREESECT) {
    const miniFatBytes = readRegularChain(firstMiniFatSector, numMiniFatSectors * sectorSize, true);
    const count = miniFatBytes.length >>> 2;
    miniFat = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      miniFat[i] = u32le(miniFatBytes, i * 4);
    }
  }

  let miniStreamBytes: Uint8Array = new Uint8Array(0);
  if (
    rootEntry &&
    rootEntry.type === 'root' &&
    rootEntry.startSector !== ENDOFCHAIN &&
    rootEntry.startSector !== FREESECT &&
    rootEntry.size > 0
  ) {
    miniStreamBytes = readRegularChain(rootEntry.startSector, rootEntry.size, true);
  }

  const readMiniChain = (startMiniSid: number, expectedSize: number): Uint8Array => {
    if (expectedSize === 0 || startMiniSid === ENDOFCHAIN || startMiniSid === FREESECT) {
      return new Uint8Array(0);
    }
    const out = new Uint8Array(expectedSize);
    let pos = 0;
    let msid = startMiniSid;
    const seen = new Set<number>();
    const maxMiniSectors = Math.floor(miniStreamBytes.length / miniSectorSize) + 2;

    while (msid !== ENDOFCHAIN && msid !== FREESECT && pos < expectedSize) {
      if (seen.has(msid) || seen.size > maxMiniSectors) {
        throw new Error(`cyclic MiniFAT chain starting at mini-sector ${startMiniSid}`);
      }
      seen.add(msid);
      const off = msid * miniSectorSize;
      if (off + miniSectorSize > miniStreamBytes.length) {
        // Allow partial final mini-sector if within miniStreamBytes
        if (off < miniStreamBytes.length) {
          const avail = miniStreamBytes.subarray(off);
          const take = Math.min(avail.length, expectedSize - pos);
          out.set(avail.subarray(0, take), pos);
          pos += take;
          break;
        }
        throw new Error(`MiniFAT sector ${msid} exceeds MiniStream bounds`);
      }
      const take = Math.min(miniSectorSize, expectedSize - pos);
      out.set(miniStreamBytes.subarray(off, off + take), pos);
      pos += take;
      msid = msid < miniFat.length ? miniFat[msid] : ENDOFCHAIN;
    }
    return pos === expectedSize ? out : out.subarray(0, pos);
  };

  // 6. Extract all stream entries
  const streams: CfbStream[] = [];
  const streamMap = new Map<string, CfbStream>();

  for (const e of entries) {
    if (e.type !== 'stream' || !e.name) continue;
    const useMini =
      e.size > 0 &&
      e.size < miniStreamCutoff &&
      miniStreamBytes.length > 0 &&
      (miniFat.length > 0 || (e.startSector + 1) * miniSectorSize <= miniStreamBytes.length);

    let data: Uint8Array;
    if (e.size === 0) {
      data = new Uint8Array(0);
    } else if (useMini) {
      data = readMiniChain(e.startSector, e.size);
    } else {
      data = readRegularChain(e.startSector, e.size);
    }

    const stream: CfbStream = {
      name: e.name,
      cleanName: e.cleanName,
      path: e.path,
      size: data.length,
      data,
      isMiniStream: useMini,
    };
    streams.push(stream);
    streamMap.set(e.path, stream);
    streamMap.set(e.path.toLowerCase(), stream);
    if (!streamMap.has(e.cleanName.toLowerCase())) {
      streamMap.set(e.cleanName.toLowerCase(), stream);
    }
  }

  return {
    majorVersion,
    minorVersion,
    sectorSize,
    miniSectorSize,
    miniStreamCutoff,
    entries,
    streams,
    streamMap,
  };
}

/**
 * Build a spec-compliant OLE2 / Compound File Binary (CFB v3, 512-byte sectors) container
 * from a list of named streams.
 * - Small streams (< 4096 bytes) are stored in the Root Entry's MiniStream with a MiniFAT.
 * - Large streams (>= 4096 bytes) are stored directly in regular 512-byte FAT sectors.
 * - Nested paths like `"BRep/Main"` create intermediate storage directory entries automatically.
 */
export function buildCfb(
  inputStreams: ReadonlyArray<{ name: string; data: Uint8Array | string }>,
): Uint8Array {
  const sectorSize = 512;
  const miniSectorSize = 64;
  const miniCutoff = 4096;
  const enc = new TextEncoder();

  interface DirNode {
    name: string;
    type: 1 | 2 | 5; // 1 = storage, 2 = stream, 5 = root
    data: Uint8Array;
    children: Map<string, DirNode>;
    index: number;
    left: number;
    right: number;
    child: number;
    startSector: number;
    size: number;
  }

  const root: DirNode = {
    name: 'Root Entry',
    type: 5,
    data: new Uint8Array(0),
    children: new Map(),
    index: 0,
    left: NOSTREAM,
    right: NOSTREAM,
    child: NOSTREAM,
    startSector: ENDOFCHAIN,
    size: 0,
  };

  for (const item of inputStreams) {
    const rawBytes = typeof item.data === 'string' ? enc.encode(item.data) : item.data;
    const parts = item.name.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let curr = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = curr.children.get(seg);
      if (!next) {
        next = {
          name: seg,
          type: 1,
          data: new Uint8Array(0),
          children: new Map(),
          index: -1,
          left: NOSTREAM,
          right: NOSTREAM,
          child: NOSTREAM,
          startSector: 0,
          size: 0,
        };
        curr.children.set(seg, next);
      }
      curr = next;
    }

    const leafName = parts[parts.length - 1];
    curr.children.set(leafName, {
      name: leafName,
      type: 2,
      data: rawBytes,
      children: new Map(),
      index: -1,
      left: NOSTREAM,
      right: NOSTREAM,
      child: NOSTREAM,
      startSector: ENDOFCHAIN,
      size: rawBytes.length,
    });
  }

  // Flatten directory tree and link balanced binary sibling trees
  const allNodes: DirNode[] = [root];
  const assignTree = (parent: DirNode): void => {
    const kids = Array.from(parent.children.values());
    if (kids.length === 0) return;
    for (const k of kids) {
      k.index = allNodes.length;
      allNodes.push(k);
    }
    const buildBalanced = (lo: number, hi: number): number => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >>> 1;
      const node = kids[mid];
      node.left = buildBalanced(lo, mid - 1);
      node.right = buildBalanced(mid + 1, hi);
      return node.index;
    };
    parent.child = buildBalanced(0, kids.length - 1);
    for (const k of kids) {
      if (k.type === 1) assignTree(k);
    }
  };
  assignTree(root);

  // Separate mini-streams (< 4096) and regular streams (>= 4096)
  const miniChunks: Uint8Array[] = [];
  const miniFatEntries: number[] = [];

  for (const node of allNodes) {
    if (node.type !== 2) continue;
    if (node.size === 0) {
      node.startSector = ENDOFCHAIN;
    } else if (node.size < miniCutoff) {
      const numMini = Math.ceil(node.size / miniSectorSize);
      const firstMini = miniFatEntries.length;
      node.startSector = firstMini;
      for (let m = 0; m < numMini; m++) {
        miniFatEntries.push(m + 1 < numMini ? firstMini + m + 1 : ENDOFCHAIN);
      }
      const padded = new Uint8Array(numMini * miniSectorSize);
      padded.set(node.data);
      miniChunks.push(padded);
    }
  }

  // Assemble Root Entry MiniStream
  const totalMiniBytes = miniChunks.reduce((acc, c) => acc + c.length, 0);
  const miniStreamData = new Uint8Array(totalMiniBytes);
  let miniOff = 0;
  for (const c of miniChunks) {
    miniStreamData.set(c, miniOff);
    miniOff += c.length;
  }
  root.size = miniStreamData.length;

  // Allocate regular sectors
  const dataSectors: Uint8Array[] = [];
  const fatEntries: number[] = [];

  const appendChain = (buf: Uint8Array): number => {
    if (buf.length === 0) return ENDOFCHAIN;
    const count = Math.ceil(buf.length / sectorSize);
    const firstSid = dataSectors.length;
    for (let i = 0; i < count; i++) {
      const sec = new Uint8Array(sectorSize);
      const slice = buf.subarray(i * sectorSize, Math.min(buf.length, (i + 1) * sectorSize));
      sec.set(slice);
      dataSectors.push(sec);
      fatEntries.push(i + 1 < count ? firstSid + i + 1 : ENDOFCHAIN);
    }
    return firstSid;
  };

  // 1. Place regular streams (>= 4096 bytes)
  for (const node of allNodes) {
    if (node.type === 2 && node.size >= miniCutoff) {
      node.startSector = appendChain(node.data);
    }
  }

  // 2. Place MiniStream (if any)
  if (miniStreamData.length > 0) {
    root.startSector = appendChain(miniStreamData);
  } else {
    root.startSector = ENDOFCHAIN;
  }

  // 3. Place MiniFAT (if any)
  let firstMiniFatSector = ENDOFCHAIN;
  let numMiniFatSectors = 0;
  if (miniFatEntries.length > 0) {
    const intsPerSec = sectorSize >>> 2;
    numMiniFatSectors = Math.ceil(miniFatEntries.length / intsPerSec);
    const mfBytes = new Uint8Array(numMiniFatSectors * sectorSize);
    mfBytes.fill(0xff);
    for (let i = 0; i < miniFatEntries.length; i++) {
      writeU32le(mfBytes, i * 4, miniFatEntries[i]);
    }
    firstMiniFatSector = appendChain(mfBytes);
  }

  // 4. Build Directory sectors (4 entries per 512-byte sector)
  const entriesPerDirSec = sectorSize / 128;
  const numDirSectors = Math.max(1, Math.ceil(allNodes.length / entriesPerDirSec));
  const dirBytes = new Uint8Array(numDirSectors * sectorSize);

  for (let i = 0; i < numDirSectors * entriesPerDirSec; i++) {
    const base = i * 128;
    writeU32le(dirBytes, base + 0x44, NOSTREAM);
    writeU32le(dirBytes, base + 0x48, NOSTREAM);
    writeU32le(dirBytes, base + 0x4c, NOSTREAM);
    writeU32le(dirBytes, base + 0x74, ENDOFCHAIN);
  }

  for (const node of allNodes) {
    const base = node.index * 128;
    const maxChars = Math.min(31, node.name.length);
    for (let c = 0; c < maxChars; c++) {
      writeU16le(dirBytes, base + c * 2, node.name.charCodeAt(c));
    }
    writeU16le(dirBytes, base + maxChars * 2, 0);
    writeU16le(dirBytes, base + 0x40, (maxChars + 1) * 2);
    dirBytes[base + 0x42] = node.type;
    dirBytes[base + 0x43] = 1; // black node in RB tree
    writeU32le(dirBytes, base + 0x44, node.left);
    writeU32le(dirBytes, base + 0x48, node.right);
    writeU32le(dirBytes, base + 0x4c, node.child);
    writeU32le(dirBytes, base + 0x74, node.startSector);
    writeU32le(dirBytes, base + 0x78, node.size >>> 0);
    writeU32le(dirBytes, base + 0x7c, 0);
  }

  const firstDirSector = appendChain(dirBytes);

  // 5. Place FAT sectors
  const intsPerSec = sectorSize >>> 2;
  const numFatSectors = Math.max(1, Math.ceil((fatEntries.length + 8) / intsPerSec));
  const fatSectorIds: number[] = [];
  for (let i = 0; i < numFatSectors; i++) {
    const sid = dataSectors.length + i;
    fatSectorIds.push(sid);
    fatEntries.push(FATSECT);
  }

  const fatBytes = new Uint8Array(numFatSectors * sectorSize);
  fatBytes.fill(0xff);
  for (let i = 0; i < fatEntries.length; i++) {
    writeU32le(fatBytes, i * 4, fatEntries[i]);
  }
  for (let i = 0; i < numFatSectors; i++) {
    dataSectors.push(fatBytes.subarray(i * sectorSize, (i + 1) * sectorSize));
  }

  // 6. Write 512-byte OLE2 Header
  const header = new Uint8Array(sectorSize);
  header.set(OLE2_MAGIC, 0);
  writeU16le(header, 0x18, 0x003e); // minor version
  writeU16le(header, 0x1a, 0x0003); // major version 3 (512B sectors)
  writeU16le(header, 0x1c, 0xfffe); // little-endian
  writeU16le(header, 0x1e, 9); // sector shift (1 << 9 = 512)
  writeU16le(header, 0x20, 6); // mini sector shift (1 << 6 = 64)
  writeU32le(header, 0x2c, numFatSectors);
  writeU32le(header, 0x30, firstDirSector);
  writeU32le(header, 0x38, miniCutoff);
  writeU32le(header, 0x3c, firstMiniFatSector);
  writeU32le(header, 0x40, numMiniFatSectors);
  writeU32le(header, 0x44, ENDOFCHAIN); // first DIFAT sector
  writeU32le(header, 0x48, 0); // num DIFAT sectors

  header.subarray(0x4c, 0x200).fill(0xff);
  for (let i = 0; i < Math.min(109, fatSectorIds.length); i++) {
    writeU32le(header, 0x4c + i * 4, fatSectorIds[i]);
  }

  // Concatenate header + all sectors
  const totalBytes = sectorSize * (1 + dataSectors.length);
  const out = new Uint8Array(totalBytes);
  out.set(header, 0);
  for (let i = 0; i < dataSectors.length; i++) {
    out.set(dataSectors[i], (i + 1) * sectorSize);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synchronous ZIP Reader (for ZIP-packaged Inventor / RSe containers)
// ---------------------------------------------------------------------------

function readZipStoredEntries(bytes: Uint8Array, metaOnly = false): CfbStream[] {
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (u32le(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('missing ZIP end-of-central-directory record');

  const count = u16le(bytes, eocd + 10);
  let p = u32le(bytes, eocd + 16);
  const dec = new TextDecoder();
  const out: CfbStream[] = [];

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32le(bytes, p) !== 0x02014b50) {
      throw new Error('corrupt ZIP central directory entry');
    }
    const method = u16le(bytes, p + 10);
    const compressed = u32le(bytes, p + 20);
    const size = u32le(bytes, p + 24);
    const nameLen = u16le(bytes, p + 28);
    const extraLen = u16le(bytes, p + 30);
    const commentLen = u16le(bytes, p + 32);
    const localOff = u32le(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (metaOnly) {
      out.push({ name, cleanName: name, path: name, size, data: new Uint8Array(0), isMiniStream: false });
      continue;
    }

    if (localOff + 30 > bytes.length || u32le(bytes, localOff) !== 0x04034b50) {
      throw new Error(`corrupt local header for "${name}"`);
    }
    const lNameLen = u16le(bytes, localOff + 26);
    const lExtraLen = u16le(bytes, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compressed;
    if (dataEnd > bytes.length) {
      throw new Error(`truncated ZIP entry "${name}"`);
    }
    const raw = bytes.subarray(dataStart, dataEnd);
    let data: Uint8Array;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = inflateRawSync(raw, size);
    } else {
      throw new Error(`unsupported ZIP compression method ${method} for "${name}"`);
    }
    const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
    out.push({
      name: base,
      cleanName: cleanStreamName(base),
      path: name.replace(/\\/g, '/'),
      size: data.length,
      data,
      isMiniStream: false,
    });
  }
  return out;
}

/** Minimal RFC 1951 synchronous raw deflate decompressor for ZIP method 8 entries. */
function inflateRawSync(src: Uint8Array, expectedSize: number): Uint8Array {
  let bitPos = 0;
  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = bitPos >>> 3;
      if (byteIdx >= src.length) throw new Error('unexpected end of deflate stream');
      val |= ((src[byteIdx] >>> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return val;
  };

  interface HuffTree {
    counts: Uint16Array;
    symbols: Uint16Array;
  }

  const buildHuff = (lengths: Uint8Array, numSymbols: number): HuffTree => {
    const counts = new Uint16Array(16);
    for (let i = 0; i < numSymbols; i++) {
      if (lengths[i] > 0) counts[lengths[i]]++;
    }
    const offsets = new Uint16Array(16);
    let total = 0;
    for (let len = 1; len <= 15; len++) {
      offsets[len] = total;
      total += counts[len];
    }
    const symbols = new Uint16Array(total);
    for (let i = 0; i < numSymbols; i++) {
      const len = lengths[i];
      if (len > 0) symbols[offsets[len]++] = i;
    }
    return { counts, symbols };
  };

  const decodeSymbol = (tree: HuffTree): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= readBits(1);
      const count = tree.counts[len];
      if (code - count < first) {
        return tree.symbols[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('invalid Huffman code in deflate stream');
  };

  const fixedLitLens = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLens[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLens[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLens[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLens[i] = 8;
  const fixedLitTree = buildHuff(fixedLitLens, 288);

  const fixedDistLens = new Uint8Array(32);
  fixedDistLens.fill(5);
  const fixedDistTree = buildHuff(fixedDistLens, 32);

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  const out: number[] = [];
  let bfinal = 0;

  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      // Uncompressed block: align to byte boundary
      bitPos = (bitPos + 7) & ~7;
      const byteOff = bitPos >>> 3;
      if (byteOff + 4 > src.length) throw new Error('truncated stored deflate block');
      const len = u16le(src, byteOff);
      bitPos = (byteOff + 4) * 8;
      for (let i = 0; i < len; i++) {
        out.push(src[byteOff + 4 + i]);
      }
      bitPos += len * 8;
    } else if (btype === 1 || btype === 2) {
      let litTree = fixedLitTree;
      let distTree = fixedDistTree;
      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
        const clTree = buildHuff(clLens, 19);
        const allLens = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSymbol(clTree);
          if (sym < 16) {
            allLens[idx++] = sym;
          } else if (sym === 16) {
            const rep = readBits(2) + 3;
            const prev = idx > 0 ? allLens[idx - 1] : 0;
            for (let r = 0; r < rep; r++) allLens[idx++] = prev;
          } else if (sym === 17) {
            const rep = readBits(3) + 3;
            for (let r = 0; r < rep; r++) allLens[idx++] = 0;
          } else {
            const rep = readBits(7) + 11;
            for (let r = 0; r < rep; r++) allLens[idx++] = 0;
          }
        }
        litTree = buildHuff(allLens.subarray(0, hlit), hlit);
        distTree = buildHuff(allLens.subarray(hlit), hdist);
      }

      for (;;) {
        const sym = decodeSymbol(litTree);
        if (sym === 256) break;
        if (sym < 256) {
          out.push(sym);
        } else {
          const lenIdx = sym - 257;
          const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx]);
          const distSym = decodeSymbol(distTree);
          const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
          const start = out.length - dist;
          for (let i = 0; i < length; i++) {
            out.push(out[start + i]);
          }
        }
      }
    } else {
      throw new Error('invalid deflate block type 3');
    }
  }

  return new Uint8Array(expectedSize > 0 && out.length > expectedSize ? out.slice(0, expectedSize) : out);
}

// ---------------------------------------------------------------------------
// Units & Parameter Expression Conversion (Inventor cm / mm / deg / rad -> CadKit mm / deg)
// ---------------------------------------------------------------------------

export type IptUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'deg' | 'rad' | 'ul' | '';

const LENGTH_SCALE_TO_MM: Record<string, number> = {
  mm: 1,
  millimeter: 1,
  millimeters: 1,
  millimetre: 1,
  millimetres: 1,
  cm: 10,
  centimeter: 10,
  centimeters: 10,
  centimetre: 10,
  centimetres: 10,
  m: 1000,
  meter: 1000,
  meters: 1000,
  metre: 1000,
  metres: 1000,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  ft: 304.8,
  foot: 304.8,
  feet: 304.8,
};

const ANGLE_SCALE_TO_DEG: Record<string, number> = {
  deg: 1,
  degree: 1,
  degrees: 1,
  '°': 1,
  rad: 180 / Math.PI,
  radian: 180 / Math.PI,
  radians: 180 / Math.PI,
};

export function cleanNum(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

export function normalizeIptUnit(raw: string | undefined | null): IptUnit {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'ul' || s === 'unitless') return 'ul';
  if (s in LENGTH_SCALE_TO_MM) {
    if (s.startsWith('mm') || s.startsWith('millimet')) return 'mm';
    if (s.startsWith('cm') || s.startsWith('centimet')) return 'cm';
    if (s === 'm' || s.startsWith('met')) return 'm';
    if (s === 'in' || s.startsWith('inch') || s === '"') return 'in';
    if (s === 'ft' || s === 'foot' || s === 'feet') return 'ft';
  }
  if (s in ANGLE_SCALE_TO_DEG) {
    if (s.startsWith('rad')) return 'rad';
    return 'deg';
  }
  return '';
}

export function lengthToMm(value: number, unit: string | undefined | null = 'mm'): number {
  const key = (unit ?? 'mm').trim().toLowerCase();
  const scale = LENGTH_SCALE_TO_MM[key] ?? 1;
  return cleanNum(value * scale);
}

export function angleToDeg(value: number, unit: string | undefined | null = 'deg'): number {
  const key = (unit ?? 'deg').trim().toLowerCase();
  const scale = ANGLE_SCALE_TO_DEG[key] ?? 1;
  return cleanNum(value * scale);
}

export function sanitizeVarName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return 'param';
  return /^[0-9]/.test(cleaned) ? `p_${cleaned}` : cleaned;
}

const SIMPLE_NUM_UNIT = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|deg|rad|ul|°|")?\s*$/i;
const INLINE_NUM_UNIT = /([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|deg|rad|ul)\b/gi;

export interface ConvertedIptExpr {
  expr: string;
  numeric?: number;
  unit: IptUnit;
}

export function convertIptExpr(raw: string | number, defaultUnit: IptUnit = 'mm'): ConvertedIptExpr {
  if (typeof raw === 'number') {
    if (defaultUnit === 'deg' || defaultUnit === 'rad') {
      const deg = angleToDeg(raw, defaultUnit);
      return { expr: String(deg), numeric: deg, unit: 'deg' };
    }
    if (defaultUnit === 'ul' || defaultUnit === '') {
      const n = cleanNum(raw);
      return { expr: String(n), numeric: n, unit: defaultUnit };
    }
    const mm = lengthToMm(raw, defaultUnit);
    return { expr: String(mm), numeric: mm, unit: 'mm' };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { expr: '0', numeric: 0, unit: defaultUnit || 'mm' };

  const simple = SIMPLE_NUM_UNIT.exec(trimmed);
  if (simple) {
    const n = Number(simple[1]);
    const u = normalizeIptUnit(simple[2]) || defaultUnit;
    if (u === 'deg' || u === 'rad') {
      const deg = angleToDeg(n, u);
      return { expr: String(deg), numeric: deg, unit: 'deg' };
    }
    if (u === 'ul' || u === '') {
      const v = cleanNum(n);
      return { expr: String(v), numeric: v, unit: u };
    }
    const mm = lengthToMm(n, u);
    return { expr: String(mm), numeric: mm, unit: 'mm' };
  }

  let detected: IptUnit = defaultUnit;
  const converted = trimmed.replace(INLINE_NUM_UNIT, (_m, nStr: string, uStr: string) => {
    const n = Number(nStr);
    const u = normalizeIptUnit(uStr);
    if (u === 'deg' || u === 'rad') {
      detected = 'deg';
      return String(angleToDeg(n, u));
    }
    if (u === 'ul') {
      return String(cleanNum(n));
    }
    if (u) {
      detected = 'mm';
      return String(lengthToMm(n, u));
    }
    return nStr;
  });

  const normUnit: IptUnit =
    detected === 'cm' || detected === 'in' || detected === 'm' || detected === 'ft'
      ? 'mm'
      : detected === 'rad'
        ? 'deg'
        : detected || 'mm';
  return { expr: converted, unit: normUnit };
}

// ---------------------------------------------------------------------------
// Public Types for .ipt Importer
// ---------------------------------------------------------------------------

export interface IptParameter {
  name: string;
  rawExpr: string;
  expr: string;
  value?: number;
  unit: string;
  kind?: 'user' | 'model';
  comment?: string;
}

export interface IptWarning {
  object: string;
  code: string;
  message: string;
}

export interface IptFeatureStep {
  ipt: string;
  type: string;
  status: 'recognized' | 'fallback' | 'skipped';
  features: string[];
  reason?: string;
}

export interface IptSatBody {
  name: string;
  streamPath: string;
  sat: string;
  unitsMmPerUnit?: number;
}

export interface IptStepBody {
  name: string;
  streamPath: string;
  step: string;
}

export interface IptMeshBody {
  name: string;
  streamPath: string;
  positions: number[];
  indices: number[];
  triangleCount: number;
}

export interface IptProperties {
  title?: string;
  partNumber?: string;
  author?: string;
  company?: string;
  description?: string;
  material?: string;
  inventorVersion?: string;
  units?: string;
  segments?: string[];
}

export interface IptImportReport {
  container: 'cfb' | 'zip' | 'json' | 'invalid';
  streams: string[];
  segments: string[];
  units: { length: string; angle: string };
  totalFeatures: number;
  recognizedCount: number;
  fallbackCount: number;
  recognizedFeatures: string[];
  fallbackFeatures: string[];
  usedBrepFallback: boolean;
  brepSource?: 'step' | 'sat' | 'mesh' | 'none';
  parameterCount: number;
  warnings: IptWarning[];
  summary: string;
}

export type IptPartDoc = PartDoc & {
  variables?: Array<{ name: string; expr: string }>;
  meshes?: Array<Record<string, unknown>>;
};

export interface IptImportResult {
  ok: boolean;
  name: string;
  kind: 'ipt';
  part: IptPartDoc;
  report: IptImportReport;
  parameters: IptParameter[];
  steps: IptFeatureStep[];
  skipped: string[];
  stepBodies: IptStepBody[];
  satBodies: IptSatBody[];
  meshBodies: IptMeshBody[];
  properties: IptProperties;
  warnings: IptWarning[];
  error?: string;
}

// ---------------------------------------------------------------------------
// B-Rep (STEP / ACIS SAT / Mesh) Detection & Reconstruction
// ---------------------------------------------------------------------------

/** Check if text contains a valid ISO-10303-21 STEP block and extract it. */
export function extractStepBlock(text: string): string | null {
  const start = text.indexOf('ISO-10303-21;');
  if (start < 0) return null;
  const endMarker = 'END-ISO-10303-21;';
  const end = text.indexOf(endMarker, start);
  if (end < 0) return null;
  return text.slice(start, end + endMarker.length).trim();
}

/** Check if text contains an ACIS ASCII SAT block and extract it with unit scaling. */
export function parseSatBlock(text: string): { valid: boolean; sat: string; unitsMmPerUnit?: number } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, sat: '' };
  const lines = trimmed.split(/\r\n|\r|\n/);
  const headerRe = /^\s*\d{2,6}\s+\d+\s+\d+\s+\d+/;
  let startLine = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (headerRe.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0 || lines.length - startLine < 4) return { valid: false, sat: '' };

  let unitsMmPerUnit: number | undefined;
  const line3 = lines[startLine + 2]?.trim().split(/\s+/) ?? [];
  const u = Number(line3[0]);
  if (Number.isFinite(u) && u > 0) unitsMmPerUnit = u;

  const sub = lines.slice(startLine).join('\n');
  const hasEnd = /End-of-(?:ACIS|ASM)-data/i.test(sub);
  const hasEntity = /\b(?:body|lump|shell|face|plane-surface|cone-surface|sphere-surface|torus-surface|spline-surface)\b/i.test(sub);
  return { valid: hasEnd || hasEntity, sat: sub, unitsMmPerUnit };
}

/** Reconstruct a minimal valid ISO-10303-21 STEP representation from an ACIS SAT body for B-rep fallback. */
export function satToStepFallback(satBody: IptSatBody, partName: string): string {
  const coords: Array<[number, number, number]> = [];
  const pointRe = /\bpoint\s+\$?-?\d+(?:\s+\$?-?\d+)*\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)/gi;
  const planeRe = /\bplane-surface\s+\$?-?\d+(?:\s+\$?-?\d+)*\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d*)?(?:e[+-]?\d+)?)/gi;
  const scale = satBody.unitsMmPerUnit ?? 10;

  let m: RegExpExecArray | null;
  while ((m = pointRe.exec(satBody.sat)) !== null) {
    coords.push([cleanNum(Number(m[1]) * scale), cleanNum(Number(m[2]) * scale), cleanNum(Number(m[3]) * scale)]);
  }
  while ((m = planeRe.exec(satBody.sat)) !== null) {
    coords.push([cleanNum(Number(m[1]) * scale), cleanNum(Number(m[2]) * scale), cleanNum(Number(m[3]) * scale)]);
  }
  if (coords.length === 0) {
    coords.push([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 10]);
  }

  const safeName = (partName || satBody.name || 'InventorPart').replace(/'/g, '');
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Inventor ACIS SAT converted B-rep (${satBody.name.replace(/'/g, '')})'),'2;1');`,
    `FILE_NAME('${safeName}.step','2026-11-23',(''),(''),'CadKit IPT Importer','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  coords.slice(0, 64).forEach((pt, idx) => {
    lines.push(`#${idx + 1} = CARTESIAN_POINT('Pt${idx + 1}',(${pt[0]}.,${pt[1]}.,${pt[2]}.));`);
  });
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

/** Reconstruct a minimal STEP representation from a display mesh when only mesh fallback is present. */
function meshToStepFallback(mesh: IptMeshBody, partName: string): string {
  const safeName = (partName || mesh.name || 'InventorMesh').replace(/'/g, '');
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Inventor DisplayMesh B-rep fallback (${mesh.triangleCount} triangles)'),'2;1');`,
    `FILE_NAME('${safeName}.step','2026-11-23',(''),(''),'CadKit IPT Importer','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  const maxVerts = Math.min(32, Math.floor(mesh.positions.length / 3));
  for (let i = 0; i < maxVerts; i++) {
    const x = cleanNum(mesh.positions[i * 3]);
    const y = cleanNum(mesh.positions[i * 3 + 1]);
    const z = cleanNum(mesh.positions[i * 3 + 2]);
    lines.push(`#${i + 1} = CARTESIAN_POINT('V${i + 1}',(${x}.,${y}.,${z}.));`);
  }
  if (maxVerts === 0) {
    lines.push("#1 = CARTESIAN_POINT('Origin',(0.,0.,0.));");
  }
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parametric Timeline & Stream Parsing Context
// ---------------------------------------------------------------------------

type JsonObj = Record<string, unknown>;
const isObj = (v: unknown): v is JsonObj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined;

interface IptParseContext {
  seq: number;
  nextId: () => `F${number}`;
  features: Feature[];
  parameters: IptParameter[];
  paramByName: Map<string, IptParameter>;
  steps: IptFeatureStep[];
  skipped: string[];
  recognizedFeatures: string[];
  fallbackFeatures: string[];
  warnings: IptWarning[];
  sketchIdByRef: Map<string, string>;
  lastSketchId?: string;
  stepBodies: IptStepBody[];
  satBodies: IptSatBody[];
  meshBodies: IptMeshBody[];
  properties: IptProperties;
  segments: Set<string>;
  defaultLengthUnit: IptUnit;
  defaultAngleUnit: IptUnit;
  hasExplicitLengthUnit: boolean;
}

const PLANE_MAP: Record<string, PlaneId> = {
  xy: 'front',
  xy_plane: 'front',
  xyplane: 'front',
  front: 'front',
  xz: 'top',
  xz_plane: 'top',
  xzplane: 'top',
  top: 'top',
  yz: 'right',
  yz_plane: 'right',
  yzplane: 'right',
  right: 'right',
};

function addIptParameter(
  ctx: IptParseContext,
  rawName: string,
  rawExpr: string | number,
  rawUnit?: string,
  kind?: 'user' | 'model',
  comment?: string,
): void {
  const name = sanitizeVarName(rawName);
  if (!name) return;

  const explicitUnit = normalizeIptUnit(rawUnit);
  const unitHint = explicitUnit || ctx.defaultLengthUnit;
  const conv = convertIptExpr(rawExpr, unitHint);

  let numericVal = conv.numeric;
  if (numericVal === undefined) {
    // Try simple arithmetic evaluation over already-defined parameter values
    numericVal = evalSimpleParamExpr(conv.expr, ctx.paramByName);
  }

  const param: IptParameter = {
    name,
    rawExpr: String(rawExpr),
    expr: conv.expr,
    ...(numericVal !== undefined ? { value: numericVal } : {}),
    unit: conv.unit || 'mm',
    kind: kind ?? (/^d\d+$/i.test(name) ? 'model' : 'user'),
    ...(comment ? { comment } : {}),
  };

  const existingIdx = ctx.parameters.findIndex((p) => p.name === name);
  if (existingIdx >= 0) {
    ctx.parameters[existingIdx] = param;
  } else {
    ctx.parameters.push(param);
  }
  ctx.paramByName.set(name, param);
  ctx.paramByName.set(rawName.trim(), param);
}

/** Safely evaluate a simple numeric expression referencing known parameters (e.g. `width / 2 + 5`). */
function evalSimpleParamExpr(expr: string, params: Map<string, IptParameter>): number | undefined {
  const substituted = expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (ident) => {
    const p = params.get(ident) ?? params.get(sanitizeVarName(ident));
    return p?.value !== undefined ? String(p.value) : ident;
  });
  if (!/^[0-9+\-*/().\s]+$/.test(substituted)) return undefined;
  try {
    // Only digits, whitespace, and + - * / ( ) . are present
    const val = Function(`"use strict"; return (${substituted});`)() as unknown;
    return typeof val === 'number' && Number.isFinite(val) ? cleanNum(val) : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve a length field (number, `'25 mm'`, `'2.5 cm'`, or parameter reference `'width'`). */
function resolveLengthValue(
  raw: unknown,
  ctx: IptParseContext,
  unitOverride?: IptUnit,
  fallback = 10,
): { numVal: number; exprVal: number | string } {
  const unit = unitOverride || ctx.defaultLengthUnit;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const mm = lengthToMm(raw, unit);
    return { numVal: mm, exprVal: mm };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    const directParam = ctx.paramByName.get(trimmed) ?? ctx.paramByName.get(sanitizeVarName(trimmed));
    if (directParam) {
      const v = directParam.value ?? evalSimpleParamExpr(directParam.expr, ctx.paramByName) ?? fallback;
      return { numVal: v, exprVal: v };
    }
    const conv = convertIptExpr(trimmed, unit);
    if (conv.numeric !== undefined) {
      return { numVal: conv.numeric, exprVal: conv.numeric };
    }
    const evaluated = evalSimpleParamExpr(conv.expr, ctx.paramByName);
    if (evaluated !== undefined) {
      return { numVal: evaluated, exprVal: evaluated };
    }
    return { numVal: fallback, exprVal: conv.expr };
  }
  return { numVal: fallback, exprVal: fallback };
}

/** Resolve an angle field in degrees. */
function resolveAngleValue(
  raw: unknown,
  ctx: IptParseContext,
  unitOverride?: IptUnit,
  fallback = 360,
): { numVal: number; exprVal: number | string } {
  const unit = unitOverride || ctx.defaultAngleUnit;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const deg = angleToDeg(raw, unit);
    return { numVal: deg, exprVal: deg };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    const directParam = ctx.paramByName.get(trimmed) ?? ctx.paramByName.get(sanitizeVarName(trimmed));
    if (directParam) {
      const v = directParam.value ?? evalSimpleParamExpr(directParam.expr, ctx.paramByName) ?? fallback;
      return { numVal: v, exprVal: v };
    }
    const conv = convertIptExpr(trimmed, unit);
    if (conv.numeric !== undefined) {
      return { numVal: conv.numeric, exprVal: conv.numeric };
    }
    const evaluated = evalSimpleParamExpr(conv.expr, ctx.paramByName);
    if (evaluated !== undefined) {
      return { numVal: evaluated, exprVal: evaluated };
    }
    return { numVal: fallback, exprVal: conv.expr };
  }
  return { numVal: fallback, exprVal: fallback };
}

function resolveSketchPlane(
  raw: unknown,
  ctx: IptParseContext,
  unit: IptUnit,
  extraOffsetMm = 0,
): { plane: SketchPlane; planeFeatId?: string } {
  let planeKey = 'xy';
  let offsetMm = extraOffsetMm;

  if (typeof raw === 'string' && raw.trim()) {
    planeKey = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  } else if (isObj(raw)) {
    planeKey = str(raw.name ?? raw.plane ?? raw.base ?? raw.id ?? 'xy')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const pUnit = normalizeIptUnit(str(raw.unit ?? raw.units)) || unit;
    if (raw.offset !== undefined || raw.distance !== undefined) {
      offsetMm += resolveLengthValue(raw.offset ?? raw.distance, ctx, pUnit, 0).numVal;
    }
  }

  const std: PlaneId = PLANE_MAP[planeKey] ?? 'front';
  if (Math.abs(offsetMm) > 1e-6) {
    const pid = ctx.nextId();
    ctx.features.push({
      type: 'plane',
      id: pid,
      mode: 'offset',
      base: { kind: 'std', id: std },
      offset: cleanNum(offsetMm),
    });
    return { plane: { kind: 'feature', id: pid }, planeFeatId: pid };
  }
  return { plane: { kind: 'std', id: std } };
}

function mapExtrudeOp(raw: unknown): ExtrudeOp {
  const s = str(raw).toLowerCase();
  if (s.includes('cut') || s.includes('sub')) return 'cut';
  if (s === 'newbody' || s === 'new_body' || s === 'knewbodyoperation') return 'newBody';
  return 'add';
}

function mapExtrudeEnd(raw: unknown): ExtrudeEnd {
  const s = str(raw).toLowerCase();
  if (s.includes('sym') || s === 'mid' || s === 'midplane') return 'mid';
  if (s.includes('through') || s.includes('all')) return 'throughBoth';
  return 'blind';
}

// ---------------------------------------------------------------------------
// Parametric Feature Mappers
// ---------------------------------------------------------------------------

function mapPlaneFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `WorkPlane${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const baseName = str(item.base ?? item.plane ?? 'XY').toLowerCase().replace(/[\s-]+/g, '_');
  const std: PlaneId = PLANE_MAP[baseName] ?? 'front';
  const offset = resolveLengthValue(item.offset ?? item.distance ?? 0, ctx, unit, 0).numVal;
  const pid = ctx.nextId();
  ctx.features.push({
    type: 'plane',
    id: pid,
    name: featName,
    mode: 'offset',
    base: { kind: 'std', id: std },
    offset: cleanNum(offset),
  });
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'WorkPlane', status: 'recognized', features: [pid] });
}

function mapSketchFeature(item: JsonObj, ctx: IptParseContext): string {
  const featName = str(item.name ?? item.Name ?? item.id) || `Sketch${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const toMm = (v: unknown, fb = 0) => resolveLengthValue(v, ctx, unit, fb).numVal;

  const extraOff = item.offset !== undefined ? toMm(item.offset, 0) : 0;
  const { plane, planeFeatId } = resolveSketchPlane(item.plane ?? item.referencePlane ?? item.workPlane ?? 'XY', ctx, unit, extraOff);

  const points: SketchPoint[] = [{ id: 'O', x: 0, y: 0, fixed: true }];
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const endpoints: Array<{ id: string; x: number; y: number }> = [];
  let pn = 0;
  let en = 0;
  let cn = 0;

  const addPoint = (x: number, y: number, merge: boolean): string => {
    const cx = cleanNum(x);
    const cy = cleanNum(y);
    if (merge) {
      const hit = endpoints.find((p) => Math.abs(p.x - cx) < 1e-6 && Math.abs(p.y - cy) < 1e-6);
      if (hit) return hit.id;
    }
    const id = `p${++pn}`;
    points.push({ id, x: cx, y: cy });
    if (merge) endpoints.push({ id, x: cx, y: cy });
    return id;
  };

  // Collect entities from `entities`, `curves`, `geometry`, `profiles`, or shorthand arrays (`lines`, `circles`, `rectangles`, `points`)
  const rawList: unknown[] = [];
  for (const key of ['entities', 'curves', 'geometry', 'profiles', 'elements']) {
    if (Array.isArray(item[key])) rawList.push(...(item[key] as unknown[]));
  }
  if (isObj(item.rectangle) || isObj(item.rect)) {
    rawList.push({ type: 'rectangle', ...(isObj(item.rectangle) ? item.rectangle : (item.rect as JsonObj)) });
  }
  if (Array.isArray(item.rectangles)) {
    for (const r of item.rectangles) if (isObj(r)) rawList.push({ type: 'rectangle', ...r });
  }
  if (isObj(item.circle)) {
    rawList.push({ type: 'circle', ...item.circle });
  }
  if (Array.isArray(item.circles)) {
    for (const c of item.circles) if (isObj(c)) rawList.push({ type: 'circle', ...c });
  }
  if (Array.isArray(item.lines)) {
    for (const l of item.lines) if (isObj(l)) rawList.push({ type: 'line', ...l });
  }
  if (Array.isArray(item.points) && rawList.length === 0) {
    // Check if `item.points` are already CadKit `{id, x, y}` points vs raw sketch point entities
    const pts = item.points as unknown[];
    const looksLikeCadKitPts = pts.every((p) => isObj(p) && typeof p.id === 'string' && typeof p.x === 'number');
    if (!looksLikeCadKitPts) {
      for (const pt of pts) if (isObj(pt)) rawList.push({ type: 'point', ...pt });
    }
  }

  for (const rawE of rawList) {
    if (!isObj(rawE)) continue;
    const et = str(rawE.type ?? rawE.kind ?? 'line').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (et === 'line' || et === 'sketchline' || et === 'line2d') {
      const x1 = rawE.x1 ?? (Array.isArray(rawE.start) ? rawE.start[0] : isObj(rawE.start) ? rawE.start.x : Array.isArray(rawE.p1) ? rawE.p1[0] : undefined);
      const y1 = rawE.y1 ?? (Array.isArray(rawE.start) ? rawE.start[1] : isObj(rawE.start) ? rawE.start.y : Array.isArray(rawE.p1) ? rawE.p1[1] : undefined);
      const x2 = rawE.x2 ?? (Array.isArray(rawE.end) ? rawE.end[0] : isObj(rawE.end) ? rawE.end.x : Array.isArray(rawE.p2) ? rawE.p2[0] : undefined);
      const y2 = rawE.y2 ?? (Array.isArray(rawE.end) ? rawE.end[1] : isObj(rawE.end) ? rawE.end.y : Array.isArray(rawE.p2) ? rawE.p2[1] : undefined);
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
      entities.push({
        type: 'line',
        id: `e${++en}`,
        p1: addPoint(toMm(x1), toMm(y1), true),
        p2: addPoint(toMm(x2), toMm(y2), true),
      });
    } else if (et === 'rectangle' || et === 'rect' || et === 'sketchrectangle' || et === 'box2d') {
      const w = toMm(rawE.width ?? rawE.w ?? rawE.length ?? rawE.dx, 0);
      const h = toMm(rawE.height ?? rawE.h ?? rawE.depth ?? rawE.dy, 0);
      if (w === 0 || h === 0) continue;
      let x1: number, y1: number;
      if (rawE.center !== undefined || rawE.centered === true) {
        const cx = toMm(Array.isArray(rawE.center) ? rawE.center[0] : isObj(rawE.center) ? rawE.center.x : rawE.cx ?? 0, 0);
        const cy = toMm(Array.isArray(rawE.center) ? rawE.center[1] : isObj(rawE.center) ? rawE.center.y : rawE.cy ?? 0, 0);
        x1 = cx - w / 2;
        y1 = cy - h / 2;
      } else {
        x1 = toMm(rawE.x ?? rawE.x1 ?? 0, 0);
        y1 = toMm(rawE.y ?? rawE.y1 ?? 0, 0);
      }
      const x2 = x1 + w;
      const y2 = y1 + h;
      const p1 = addPoint(x1, y1, true);
      const p2 = addPoint(x2, y1, true);
      const p3 = addPoint(x2, y2, true);
      const p4 = addPoint(x1, y2, true);
      const e1 = `e${++en}`, e2 = `e${++en}`, e3 = `e${++en}`, e4 = `e${++en}`;
      entities.push({ type: 'line', id: e1, p1, p2 });
      entities.push({ type: 'line', id: e2, p1: p2, p2: p3 });
      entities.push({ type: 'line', id: e3, p1: p3, p2: p4 });
      entities.push({ type: 'line', id: e4, p1: p4, p2: p1 });
    } else if (et === 'circle' || et === 'sketchcircle' || et === 'circle2d') {
      const cx = toMm(rawE.cx ?? (Array.isArray(rawE.center) ? rawE.center[0] : isObj(rawE.center) ? rawE.center.x : rawE.x ?? 0), 0);
      const cy = toMm(rawE.cy ?? (Array.isArray(rawE.center) ? rawE.center[1] : isObj(rawE.center) ? rawE.center.y : rawE.y ?? 0), 0);
      const r =
        rawE.r !== undefined || rawE.radius !== undefined
          ? toMm(rawE.r ?? rawE.radius, 0)
          : rawE.diameter !== undefined || rawE.d !== undefined
            ? cleanNum(toMm(rawE.diameter ?? rawE.d, 0) / 2)
            : 0;
      if (r <= 0) continue;
      entities.push({
        type: 'circle',
        id: `e${++en}`,
        c: addPoint(cx, cy, false),
        r,
      });
    } else if (et === 'arc' || et === 'sketcharc' || et === 'arc2d') {
      const cx = toMm(rawE.cx ?? (Array.isArray(rawE.center) ? rawE.center[0] : isObj(rawE.center) ? rawE.center.x : 0), 0);
      const cy = toMm(rawE.cy ?? (Array.isArray(rawE.center) ? rawE.center[1] : isObj(rawE.center) ? rawE.center.y : 0), 0);
      const r = toMm(rawE.r ?? rawE.radius ?? 5, 5);
      const a1 = num(rawE.startAngle ?? rawE.a1 ?? 0) ?? 0;
      const a2 = num(rawE.endAngle ?? rawE.a2 ?? Math.PI / 2) ?? Math.PI / 2;
      const sx = cx + r * Math.cos(a1);
      const sy = cy + r * Math.sin(a1);
      const ex = cx + r * Math.cos(a2);
      const ey = cy + r * Math.sin(a2);
      entities.push({
        type: 'arc',
        id: `e${++en}`,
        c: addPoint(cx, cy, false),
        p1: addPoint(sx, sy, true),
        p2: addPoint(ex, ey, true),
      });
    } else if (et === 'point' || et === 'sketchpoint' || et === 'holecenter' || et === 'centerpoint') {
      const px = toMm(rawE.x ?? rawE.cx ?? (Array.isArray(rawE.pos) ? rawE.pos[0] : 0), 0);
      const py = toMm(rawE.y ?? rawE.cy ?? (Array.isArray(rawE.pos) ? rawE.pos[1] : 0), 0);
      entities.push({
        type: 'point',
        id: `e${++en}`,
        p: addPoint(px, py, false),
      });
    } else if (et === 'polygon' || et === 'regularpolygon') {
      const sides = Math.max(3, Math.round(num(rawE.sides ?? rawE.count ?? 6) ?? 6));
      const cx = toMm(rawE.cx ?? rawE.x ?? 0, 0);
      const cy = toMm(rawE.cy ?? rawE.y ?? 0, 0);
      const r = toMm(rawE.r ?? rawE.radius ?? 10, 10);
      const polyPts: string[] = [];
      for (let k = 0; k < sides; k++) {
        const ang = (2 * Math.PI * k) / sides;
        polyPts.push(addPoint(cx + r * Math.cos(ang), cy + r * Math.sin(ang), true));
      }
      for (let k = 0; k < sides; k++) {
        entities.push({ type: 'line', id: `e${++en}`, p1: polyPts[k], p2: polyPts[(k + 1) % sides] });
      }
    }
  }

  if (Array.isArray(item.constraints)) {
    for (const rawC of item.constraints) {
      if (!isObj(rawC)) continue;
      const ct = str(rawC.type) as SketchConstraint['type'];
      if (!ct) continue;
      constraints.push({
        id: str(rawC.id) || `c${++cn}`,
        type: ct,
        ...(Array.isArray(rawC.refs) ? { refs: rawC.refs.map(String) } : {}),
        ...(typeof rawC.value === 'number' ? { value: rawC.value } : {}),
      });
    }
  }

  const sid = ctx.nextId();
  ctx.features.push({
    type: 'sketch',
    id: sid,
    name: featName,
    plane,
    points,
    entities,
    constraints,
  });

  ctx.sketchIdByRef.set(featName, sid);
  ctx.sketchIdByRef.set(featName.toLowerCase(), sid);
  const rawId = str(item.id);
  if (rawId) {
    ctx.sketchIdByRef.set(rawId, sid);
    ctx.sketchIdByRef.set(rawId.toLowerCase(), sid);
  }
  ctx.lastSketchId = sid;

  const created = planeFeatId ? [planeFeatId, sid] : [sid];
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Sketch', status: 'recognized', features: created });
  return sid;
}

function findOrCreateSketchForFeature(item: JsonObj, ctx: IptParseContext): string | undefined {
  if (isObj(item.sketch)) {
    return mapSketchFeature(item.sketch, ctx);
  }
  if (isObj(item.profile) && (Array.isArray(item.profile.entities) || item.profile.type)) {
    return mapSketchFeature(item.profile, ctx);
  }
  const ref = str(item.sketch ?? item.profile ?? item.sketchId ?? item.sketchName);
  if (ref) {
    const found = ctx.sketchIdByRef.get(ref) ?? ctx.sketchIdByRef.get(ref.toLowerCase());
    if (found) return found;
  }
  if (!ref && ctx.lastSketchId) {
    return ctx.lastSketchId;
  }
  return undefined;
}

function mapExtrudeFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Extrude${ctx.seq}`;
  const sketchId = findOrCreateSketchForFeature(item, ctx);
  if (!sketchId) {
    const ref = str(item.sketch ?? item.profile ?? item.sketchId ?? item.sketchName) || '(none)';
    ctx.skipped.push(featName);
    ctx.fallbackFeatures.push(featName);
    ctx.steps.push({ ipt: featName, type: 'Extrude', status: 'fallback', features: [], reason: `missing sketch "${ref}"` });
    ctx.warnings.push({
      object: featName,
      code: 'missingSketch',
      message: `Extrude "${featName}" references sketch "${ref}" which was not found`,
    });
    return;
  }

  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const rawDepth = item.depth ?? item.distance ?? item.height ?? item.length ?? item.extentDistance ?? 10;
  const { numVal } = resolveLengthValue(rawDepth, ctx, unit, 10);
  const depth = Math.abs(numVal);
  const flip = numVal < 0 || item.flip === true || str(item.direction).toLowerCase() === 'negative';
  const end = mapExtrudeEnd(item.end ?? item.extent ?? item.extentType);
  const op = mapExtrudeOp(item.operation ?? item.op);
  const draft = num(item.draft ?? item.taperAngle);

  const id = ctx.nextId();
  ctx.features.push({
    type: 'extrude',
    id,
    name: featName,
    op,
    sketch: sketchId,
    end,
    ...(end !== 'throughBoth' ? { depth } : { depth }),
    ...(flip ? { flip: true } : {}),
    ...(draft !== undefined && draft !== 0 ? { draft } : {}),
  });
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Extrude', status: 'recognized', features: [id] });
}

function mapRevolveFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Revolve${ctx.seq}`;
  const sketchId = findOrCreateSketchForFeature(item, ctx);
  if (!sketchId) {
    const ref = str(item.sketch ?? item.profile ?? item.sketchId ?? item.sketchName) || '(none)';
    ctx.skipped.push(featName);
    ctx.fallbackFeatures.push(featName);
    ctx.steps.push({ ipt: featName, type: 'Revolve', status: 'fallback', features: [], reason: `missing sketch "${ref}"` });
    ctx.warnings.push({
      object: featName,
      code: 'missingSketch',
      message: `Revolve "${featName}" references sketch "${ref}" which was not found`,
    });
    return;
  }

  const angleUnit = normalizeIptUnit(str(item.angleUnit ?? item.unit)) || ctx.defaultAngleUnit;
  const rawAngle = item.angle ?? (angleUnit === 'rad' ? Math.PI * 2 : 360);
  const { numVal: angle } = resolveAngleValue(rawAngle, ctx, angleUnit, 360);
  const axisRaw = item.axis ?? 'Y';
  const axis = isObj(axisRaw) ? (axisRaw as { kind: string; [k: string]: unknown }) : (str(axisRaw) || 'Y');
  const op = mapExtrudeOp(item.operation ?? item.op);
  const end = str(item.end ?? item.extent).toLowerCase().includes('mid') ? 'mid' : 'blind';
  const flip = item.flip === true;

  const id = ctx.nextId();
  ctx.features.push({
    type: 'revolve',
    id,
    name: featName,
    op,
    sketch: sketchId,
    axis,
    end,
    angle,
    ...(flip ? { flip: true } : {}),
  });
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Revolve', status: 'recognized', features: [id] });
}

function mapHoleFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Hole${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const toMm = (v: unknown, fb = 0) => resolveLengthValue(v, ctx, unit, fb).numVal;

  const produced: string[] = [];
  let sketchId: string | undefined;

  const explicitSketchRef = str(item.sketch ?? item.sketchId ?? item.sketchName);
  if (explicitSketchRef) {
    sketchId = ctx.sketchIdByRef.get(explicitSketchRef) ?? ctx.sketchIdByRef.get(explicitSketchRef.toLowerCase());
  }

  if (!sketchId) {
    // Emit a dedicated hole-centers sketch from x/y, center, centers, points, or position
    const centers: Array<[number, number]> = [];
    let zOffset = item.offset !== undefined ? toMm(item.offset, 0) : 0;

    if (Array.isArray(item.centers)) {
      for (const c of item.centers) {
        if (Array.isArray(c) && c.length >= 2) centers.push([toMm(c[0]), toMm(c[1])]);
        else if (isObj(c)) centers.push([toMm(c.x ?? c.cx ?? 0), toMm(c.y ?? c.cy ?? 0)]);
      }
    } else if (Array.isArray(item.points)) {
      for (const c of item.points) {
        if (Array.isArray(c) && c.length >= 2) centers.push([toMm(c[0]), toMm(c[1])]);
        else if (isObj(c)) centers.push([toMm(c.x ?? 0), toMm(c.y ?? 0)]);
      }
    } else if (Array.isArray(item.center) && item.center.length >= 2) {
      centers.push([toMm(item.center[0]), toMm(item.center[1])]);
      if (item.center.length >= 3 && item.offset === undefined) zOffset = toMm(item.center[2], 0);
    } else if (isObj(item.center)) {
      centers.push([toMm(item.center.x ?? 0), toMm(item.center.y ?? 0)]);
      if (item.center.z !== undefined && item.offset === undefined) zOffset = toMm(item.center.z, 0);
    } else if (Array.isArray(item.position) && item.position.length >= 2) {
      centers.push([toMm(item.position[0]), toMm(item.position[1])]);
      if (item.position.length >= 3 && item.offset === undefined) zOffset = toMm(item.position[2], 0);
    } else if (item.x !== undefined || item.y !== undefined || item.cx !== undefined || item.cy !== undefined) {
      centers.push([toMm(item.x ?? item.cx ?? 0), toMm(item.y ?? item.cy ?? 0)]);
      if (item.z !== undefined && item.offset === undefined) zOffset = toMm(item.z, 0);
    } else if (ctx.lastSketchId) {
      sketchId = ctx.lastSketchId;
    } else {
      centers.push([0, 0]);
    }

    if (!sketchId) {
      const { plane, planeFeatId } = resolveSketchPlane(item.plane ?? item.face ?? 'XY', ctx, unit, zOffset);
      if (planeFeatId) produced.push(planeFeatId);
      const pts: SketchPoint[] = [{ id: 'O', x: 0, y: 0, fixed: true }];
      const ents: SketchEntity[] = [];
      centers.forEach(([cx, cy], idx) => {
        const pid = `p${idx + 1}`;
        pts.push({ id: pid, x: cleanNum(cx), y: cleanNum(cy) });
        ents.push({ id: `e${idx + 1}`, type: 'point', p: pid });
      });
      const sid = ctx.nextId();
      ctx.features.push({
        type: 'sketch',
        id: sid,
        name: `${featName}Sketch`,
        plane,
        points: pts,
        entities: ents,
        constraints: [],
      });
      sketchId = sid;
      produced.push(sid);
    }
  }

  const diameter =
    item.diameter !== undefined || item.d !== undefined
      ? toMm(item.diameter ?? item.d, 10)
      : item.radius !== undefined || item.r !== undefined
        ? cleanNum(toMm(item.radius ?? item.r, 5) * 2)
        : 10;

  const rawKind = str(item.holeType ?? item.kind ?? item.seatType ?? 'simple').toLowerCase();
  const kind =
    rawKind.includes('cbore') || rawKind.includes('counterbore')
      ? 'cbore'
      : rawKind.includes('csink') || rawKind.includes('countersink')
        ? 'csink'
        : 'simple';

  const extentStr = str(item.end ?? item.extent ?? item.termination).toLowerCase();
  const isThrough =
    item.through === true ||
    item.throughAll === true ||
    extentStr.includes('through') ||
    (item.depth === undefined && item.distance === undefined && extentStr !== 'blind');

  const depth = !isThrough ? Math.abs(toMm(item.depth ?? item.distance ?? 10, 10)) : undefined;
  const id = ctx.nextId();
  produced.push(id);

  ctx.features.push({
    type: 'hole',
    id,
    name: featName,
    sketch: sketchId!,
    kind,
    diameter,
    end: isThrough ? 'through' : 'blind',
    ...(depth !== undefined ? { depth } : {}),
    ...(item.tip === true || item.drillPoint === true ? { tip: true } : {}),
    ...(item.flip === true ? { flip: true } : {}),
    ...(kind === 'cbore'
      ? {
          cboreDiameter: toMm(item.cboreDiameter ?? item.counterboreDiameter ?? diameter * 1.6, diameter * 1.6),
          cboreDepth: toMm(item.cboreDepth ?? item.counterboreDepth ?? 3, 3),
        }
      : {}),
    ...(kind === 'csink'
      ? {
          cskDiameter: toMm(item.cskDiameter ?? item.countersinkDiameter ?? diameter * 1.8, diameter * 1.8),
          cskAngle: resolveAngleValue(item.cskAngle ?? item.countersinkAngle ?? 90, ctx, 'deg', 90).numVal,
        }
      : {}),
  });

  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Hole', status: 'recognized', features: produced });
}

function parseEdgeRefs(rawEdges: unknown): EdgeRef[] {
  if (!Array.isArray(rawEdges)) return [];
  const out: EdgeRef[] = [];
  for (const e of rawEdges) {
    if (isObj(e) && Array.isArray(e.faces) && Array.isArray(e.at)) {
      out.push({ faces: e.faces.map(String), at: e.at.map(Number) });
    } else if (typeof e === 'string' && e.trim()) {
      out.push({ faces: [e.trim()], at: [0, 0, 0] });
    }
  }
  return out;
}

function mapFilletFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Fillet${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const radius = Math.abs(resolveLengthValue(item.radius ?? item.r ?? item.value ?? 2, ctx, unit, 2).numVal);
  const edges = parseEdgeRefs(item.edges);
  const suppressed = edges.length === 0 || item.suppressed === true;

  const id = ctx.nextId();
  ctx.features.push({
    type: 'fillet',
    id,
    name: featName,
    radius,
    edges,
    ...(suppressed ? { suppressed: true } : {}),
  });

  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Fillet', status: 'recognized', features: [id] });
  if (edges.length === 0) {
    ctx.warnings.push({
      object: featName,
      code: 'unresolvedEdges',
      message: `Fillet "${featName}" edge topology references were not resolved; feature kept suppressed in tree`,
    });
  }
}

function mapChamferFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Chamfer${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const distance = Math.abs(resolveLengthValue(item.distance ?? item.size ?? item.d ?? item.value ?? 1.5, ctx, unit, 1.5).numVal);
  const distance2 = item.distance2 !== undefined ? Math.abs(resolveLengthValue(item.distance2, ctx, unit, distance).numVal) : undefined;
  const angle = item.angle !== undefined ? resolveAngleValue(item.angle, ctx, ctx.defaultAngleUnit, 45).numVal : undefined;
  const chamferType = distance2 !== undefined ? 'distanceDistance' : angle !== undefined ? 'angleDistance' : 'equal';
  const edges = parseEdgeRefs(item.edges);
  const suppressed = edges.length === 0 || item.suppressed === true;

  const id = ctx.nextId();
  ctx.features.push({
    type: 'chamfer',
    id,
    name: featName,
    chamferType,
    distance,
    ...(distance2 !== undefined ? { distance2 } : {}),
    ...(angle !== undefined ? { angle } : {}),
    edges,
    ...(suppressed ? { suppressed: true } : {}),
  });

  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Chamfer', status: 'recognized', features: [id] });
  if (edges.length === 0) {
    ctx.warnings.push({
      object: featName,
      code: 'unresolvedEdges',
      message: `Chamfer "${featName}" edge topology references were not resolved; feature kept suppressed in tree`,
    });
  }
}

function mapBoxFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Box${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const toMm = (v: unknown, fb = 10) => resolveLengthValue(v, ctx, unit, fb).numVal;

  const length = Math.abs(toMm(item.length ?? item.dx ?? item.sizeX ?? item.width ?? 20, 20));
  const width = Math.abs(toMm(item.width ?? item.dy ?? item.sizeY ?? item.depth ?? 20, 20));
  const height = Math.abs(toMm(item.height ?? item.dz ?? item.sizeZ ?? 20, 20));

  let x0 = 0, y0 = 0, z0 = 0;
  if (Array.isArray(item.corner) && item.corner.length >= 2) {
    x0 = toMm(item.corner[0], 0);
    y0 = toMm(item.corner[1], 0);
    if (item.corner.length >= 3) z0 = toMm(item.corner[2], 0);
  } else if (Array.isArray(item.center) && item.center.length >= 2) {
    x0 = toMm(item.center[0], 0) - length / 2;
    y0 = toMm(item.center[1], 0) - width / 2;
    if (item.center.length >= 3) z0 = toMm(item.center[2], 0);
  } else {
    x0 = toMm(item.x ?? 0, 0);
    y0 = toMm(item.y ?? 0, 0);
    z0 = toMm(item.z ?? item.offset ?? 0, 0);
  }

  const { plane, planeFeatId } = resolveSketchPlane(item.plane ?? 'XY', ctx, unit, z0);
  const sid = ctx.nextId();
  const x1 = cleanNum(x0), y1 = cleanNum(y0), x2 = cleanNum(x0 + length), y2 = cleanNum(y0 + width);
  ctx.features.push({
    type: 'sketch',
    id: sid,
    name: `${featName}Sketch`,
    plane,
    points: [
      { id: 'O', x: 0, y: 0, fixed: true },
      { id: 'p1', x: x1, y: y1 },
      { id: 'p2', x: x2, y: y1 },
      { id: 'p3', x: x2, y: y2 },
      { id: 'p4', x: x1, y: y2 },
    ],
    entities: [
      { type: 'line', id: 'e1', p1: 'p1', p2: 'p2' },
      { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' },
      { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' },
      { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' },
    ],
    constraints: [],
  });

  const eid = ctx.nextId();
  const op = mapExtrudeOp(item.operation ?? item.op);
  ctx.features.push({
    type: 'extrude',
    id: eid,
    name: featName,
    op,
    sketch: sid,
    end: 'blind',
    depth: height,
  });

  const produced = planeFeatId ? [planeFeatId, sid, eid] : [sid, eid];
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Box', status: 'recognized', features: produced });
}

function mapCylinderFeature(item: JsonObj, ctx: IptParseContext): void {
  const featName = str(item.name ?? item.Name ?? item.id) || `Cylinder${ctx.seq}`;
  const unit = normalizeIptUnit(str(item.unit ?? item.units)) || ctx.defaultLengthUnit;
  const toMm = (v: unknown, fb = 10) => resolveLengthValue(v, ctx, unit, fb).numVal;

  const radius =
    item.radius !== undefined || item.r !== undefined
      ? Math.abs(toMm(item.radius ?? item.r, 10))
      : item.diameter !== undefined || item.d !== undefined
        ? cleanNum(Math.abs(toMm(item.diameter ?? item.d, 20)) / 2)
        : 10;
  const height = Math.abs(toMm(item.height ?? item.depth ?? item.length ?? 20, 20));

  let cx = 0, cy = 0, cz = 0;
  if (Array.isArray(item.center) && item.center.length >= 2) {
    cx = toMm(item.center[0], 0);
    cy = toMm(item.center[1], 0);
    if (item.center.length >= 3) cz = toMm(item.center[2], 0);
  } else if (Array.isArray(item.base) && item.base.length >= 2) {
    cx = toMm(item.base[0], 0);
    cy = toMm(item.base[1], 0);
    if (item.base.length >= 3) cz = toMm(item.base[2], 0);
  } else {
    cx = toMm(item.x ?? item.cx ?? 0, 0);
    cy = toMm(item.y ?? item.cy ?? 0, 0);
    cz = toMm(item.z ?? item.offset ?? 0, 0);
  }

  const { plane, planeFeatId } = resolveSketchPlane(item.plane ?? 'XY', ctx, unit, cz);
  const sid = ctx.nextId();
  ctx.features.push({
    type: 'sketch',
    id: sid,
    name: `${featName}Sketch`,
    plane,
    points: [
      { id: 'O', x: 0, y: 0, fixed: true },
      { id: 'p1', x: cleanNum(cx), y: cleanNum(cy) },
    ],
    entities: [{ type: 'circle', id: 'e1', c: 'p1', r: radius }],
    constraints: [],
  });

  const eid = ctx.nextId();
  const op = mapExtrudeOp(item.operation ?? item.op);
  ctx.features.push({
    type: 'extrude',
    id: eid,
    name: featName,
    op,
    sketch: sid,
    end: 'blind',
    depth: height,
  });

  const produced = planeFeatId ? [planeFeatId, sid, eid] : [sid, eid];
  ctx.recognizedFeatures.push(featName);
  ctx.steps.push({ ipt: featName, type: 'Cylinder', status: 'recognized', features: produced });
}

function dispatchFeatureObject(item: JsonObj, ctx: IptParseContext): void {
  const rawType = str(item.type ?? item.featureType ?? item.kind ?? item.class);
  const norm = rawType.toLowerCase().replace(/[^a-z0-9]/g, '');
  const featName = str(item.name ?? item.Name ?? item.id) || rawType || `Feature${ctx.seq}`;

  if (norm === 'sketch' || norm === 'sketch2d' || norm === 'planarsketch' || norm === 'pmsketch' || norm === 'sketchfeature') {
    mapSketchFeature(item, ctx);
  } else if (norm === 'extrude' || norm === 'extrudefeature' || norm === 'pmextrude' || norm === 'extrusion') {
    mapExtrudeFeature(item, ctx);
  } else if (norm === 'revolve' || norm === 'revolvefeature' || norm === 'pmrevolve' || norm === 'revolution') {
    mapRevolveFeature(item, ctx);
  } else if (norm === 'hole' || norm === 'holefeature' || norm === 'pmhole' || norm === 'drilledhole') {
    mapHoleFeature(item, ctx);
  } else if (norm === 'fillet' || norm === 'filletfeature' || norm === 'pmfillet' || norm === 'round') {
    mapFilletFeature(item, ctx);
  } else if (norm === 'chamfer' || norm === 'chamferfeature' || norm === 'pmchamfer') {
    mapChamferFeature(item, ctx);
  } else if (norm === 'box' || norm === 'boxfeature' || norm === 'pmbox' || norm === 'primitivebox') {
    mapBoxFeature(item, ctx);
  } else if (norm === 'cylinder' || norm === 'cylinderfeature' || norm === 'pmcylinder' || norm === 'primitivecylinder') {
    mapCylinderFeature(item, ctx);
  } else if (norm === 'plane' || norm === 'workplane' || norm === 'offsetplane' || norm === 'pmworkplane') {
    mapPlaneFeature(item, ctx);
  } else {
    ctx.skipped.push(featName);
    ctx.fallbackFeatures.push(featName);
    ctx.steps.push({
      ipt: featName,
      type: rawType || 'UnknownFeature',
      status: 'fallback',
      features: [],
      reason: `unsupported Inventor feature type "${rawType || 'unknown'}"`,
    });
    ctx.warnings.push({
      object: featName,
      code: 'unsupportedFeature',
      message: `Inventor feature "${featName}" (${rawType || 'unknown'}) is not supported in parametric history and requires B-rep fallback`,
    });
  }
}

// ---------------------------------------------------------------------------
// Stream Content Parsers (JSON, XML, Key-Value / Text DSL, Binary B-Rep)
// ---------------------------------------------------------------------------

function parseUnitsFromObject(obj: JsonObj, ctx: IptParseContext): void {
  const rawUnits = obj.units ?? obj.unit ?? obj.lengthUnit ?? obj.defaultLengthUnits ?? obj.documentUnits;
  if (typeof rawUnits === 'string') {
    const u = normalizeIptUnit(rawUnits);
    if (u && u !== 'deg' && u !== 'rad' && u !== 'ul') {
      ctx.defaultLengthUnit = u;
      ctx.hasExplicitLengthUnit = true;
      ctx.properties.units = u;
    }
  } else if (isObj(rawUnits)) {
    const lu = normalizeIptUnit(str(rawUnits.length ?? rawUnits.linear));
    const au = normalizeIptUnit(str(rawUnits.angle ?? rawUnits.angular));
    if (lu) {
      ctx.defaultLengthUnit = lu;
      ctx.hasExplicitLengthUnit = true;
      ctx.properties.units = lu;
    }
    if (au === 'deg' || au === 'rad') {
      ctx.defaultAngleUnit = au;
    }
  }
  const rawAngle = obj.angleUnit ?? obj.angularUnit;
  if (typeof rawAngle === 'string') {
    const au = normalizeIptUnit(rawAngle);
    if (au === 'deg' || au === 'rad') ctx.defaultAngleUnit = au;
  }
}

function parsePropertiesFromObject(obj: JsonObj, ctx: IptParseContext): void {
  parseUnitsFromObject(obj, ctx);
  const title = str(obj.title ?? obj.Title ?? obj.partName ?? obj.PartName ?? obj.designName ?? obj.name);
  if (title && !ctx.properties.title) ctx.properties.title = title;
  const partNumber = str(obj.partNumber ?? obj.PartNumber);
  if (partNumber) ctx.properties.partNumber = partNumber;
  const author = str(obj.author ?? obj.Author);
  if (author) ctx.properties.author = author;
  const company = str(obj.company ?? obj.Company);
  if (company) ctx.properties.company = company;
  const desc = str(obj.description ?? obj.Description);
  if (desc) ctx.properties.description = desc;
  const mat = str(obj.material ?? obj.Material);
  if (mat) ctx.properties.material = mat;
  const ver = str(obj.inventorVersion ?? obj.version ?? obj.Version ?? obj.appVersion);
  if (ver) ctx.properties.inventorVersion = ver;

  if (Array.isArray(obj.segments)) {
    for (const s of obj.segments) {
      if (typeof s === 'string' && s.trim()) ctx.segments.add(s.trim());
      else if (isObj(s) && typeof s.name === 'string') ctx.segments.add(s.name.trim());
    }
  }
  if (isObj(obj.iProperties)) {
    parsePropertiesFromObject(obj.iProperties, ctx);
  }
}

function parseParametersFromValue(val: unknown, ctx: IptParseContext, defaultKind?: 'user' | 'model'): void {
  if (Array.isArray(val)) {
    for (const item of val) {
      if (!isObj(item)) continue;
      const name = str(item.name ?? item.Name ?? item.id);
      if (!name) continue;
      const expr = item.expression ?? item.Expression ?? item.expr ?? item.formula ?? item.value ?? item.Value;
      if (typeof expr !== 'string' && typeof expr !== 'number') continue;
      const unit = str(item.unit ?? item.Unit ?? item.units);
      const kind = str(item.kind ?? item.type).toLowerCase() === 'model' ? 'model' : defaultKind;
      const comment = str(item.comment ?? item.Comment ?? item.description);
      addIptParameter(ctx, name, expr, unit || undefined, kind, comment || undefined);
    }
  } else if (isObj(val)) {
    for (const [k, v] of Object.entries(val)) {
      if (k === 'units' || k === 'unit' || k === 'lengthUnit' || k === 'angleUnit') continue;
      if (typeof v === 'string' || typeof v === 'number') {
        addIptParameter(ctx, k, v, undefined, defaultKind);
      } else if (isObj(v)) {
        const expr = v.expression ?? v.expr ?? v.value;
        if (typeof expr === 'string' || typeof expr === 'number') {
          const unit = str(v.unit ?? v.units);
          const kind = str(v.kind).toLowerCase() === 'model' ? 'model' : defaultKind;
          addIptParameter(ctx, k, expr, unit || undefined, kind, str(v.comment) || undefined);
        }
      }
    }
  }
}

function parseJsonPayload(parsed: unknown, streamPath: string, ctx: IptParseContext): void {
  if (Array.isArray(parsed)) {
    // Determine if array of parameters or array of features
    const first = parsed[0];
    if (isObj(first) && ('expression' in first || 'expr' in first || (!('type' in first) && 'value' in first))) {
      parseParametersFromValue(parsed, ctx);
    } else {
      for (const item of parsed) {
        if (isObj(item)) dispatchFeatureObject(item, ctx);
      }
    }
    return;
  }

  if (!isObj(parsed)) return;
  parsePropertiesFromObject(parsed, ctx);

  // Extract parameters first so feature expressions can reference them
  if (parsed.userParameters !== undefined) parseParametersFromValue(parsed.userParameters, ctx, 'user');
  if (parsed.modelParameters !== undefined) parseParametersFromValue(parsed.modelParameters, ctx, 'model');
  if (parsed.parameters !== undefined) parseParametersFromValue(parsed.parameters, ctx);
  if (parsed.params !== undefined) parseParametersFromValue(parsed.params, ctx);

  // If the stream itself is `Parameters` and is a flat object of parameter key-values
  const lowerPath = streamPath.toLowerCase();
  if (
    lowerPath.includes('param') &&
    parsed.parameters === undefined &&
    parsed.userParameters === undefined &&
    parsed.modelParameters === undefined &&
    parsed.features === undefined
  ) {
    parseParametersFromValue(parsed, ctx);
  }

  // Extract standalone sketches array if present before features
  if (Array.isArray(parsed.sketches)) {
    for (const sk of parsed.sketches) {
      if (isObj(sk)) mapSketchFeature({ type: 'sketch', ...sk }, ctx);
    }
  }

  // Extract timeline / features
  const featList = parsed.features ?? parsed.timeline ?? parsed.history ?? (isObj(parsed.dcKernel) ? parsed.dcKernel.features : undefined);
  if (Array.isArray(featList)) {
    for (const f of featList) {
      if (isObj(f)) dispatchFeatureObject(f, ctx);
    }
  }

  // Extract embedded B-rep or mesh if present in JSON
  if (typeof parsed.step === 'string') {
    const stepBlock = extractStepBlock(parsed.step);
    if (stepBlock) {
      ctx.stepBodies.push({ name: str(parsed.name) || 'StepBody', streamPath, step: stepBlock });
    }
  }
  if (typeof parsed.sat === 'string') {
    const satInfo = parseSatBlock(parsed.sat);
    if (satInfo.valid) {
      ctx.satBodies.push({
        name: str(parsed.name) || 'SatBody',
        streamPath,
        sat: satInfo.sat,
        ...(satInfo.unitsMmPerUnit ? { unitsMmPerUnit: satInfo.unitsMmPerUnit } : {}),
      });
    }
  }
  const meshObj = isObj(parsed.mesh) ? parsed.mesh : isObj(parsed.displayMesh) ? parsed.displayMesh : (Array.isArray(parsed.positions) || Array.isArray(parsed.vertices)) ? parsed : null;
  if (meshObj) {
    const rawPos = Array.isArray(meshObj.positions) ? meshObj.positions : Array.isArray(meshObj.vertices) ? meshObj.vertices : [];
    const positions: number[] = [];
    for (const p of rawPos) {
      if (typeof p === 'number') positions.push(p);
      else if (Array.isArray(p) && p.length >= 3) positions.push(Number(p[0]), Number(p[1]), Number(p[2]));
    }
    const rawIdx = Array.isArray(meshObj.indices) ? meshObj.indices : Array.isArray(meshObj.triangles) ? meshObj.triangles : [];
    const indices: number[] = [];
    for (const t of rawIdx) {
      if (typeof t === 'number') indices.push(t);
      else if (Array.isArray(t) && t.length >= 3) indices.push(Number(t[0]), Number(t[1]), Number(t[2]));
    }
    if (positions.length >= 9) {
      const triCount = indices.length >= 3 ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
      ctx.meshBodies.push({
        name: str(meshObj.name) || 'DisplayMesh',
        streamPath,
        positions,
        indices,
        triangleCount: triCount,
      });
    }
  }
}

function parseXmlPayload(xml: string, ctx: IptParseContext): void {
  const getAttr = (attrs: string, k: string): string => {
    const m = new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
    return m?.[1]?.trim() ?? '';
  };

  // Document units
  const unitsMatch = /\b(?:units|lengthUnit|defaultLengthUnits)\s*=\s*["']([^"']+)["']/i.exec(xml);
  if (unitsMatch?.[1]) {
    const u = normalizeIptUnit(unitsMatch[1]);
    if (u) {
      ctx.defaultLengthUnit = u;
      ctx.hasExplicitLengthUnit = true;
    }
  }

  // Parameters
  const paramRe = /<(?:UserParameter|ModelParameter|Parameter)\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const name = getAttr(attrs, 'name') || getAttr(attrs, 'id');
    const expr = getAttr(attrs, 'expression') || getAttr(attrs, 'expr') || getAttr(attrs, 'value');
    if (name && expr) {
      addIptParameter(ctx, name, expr, getAttr(attrs, 'unit') || undefined);
    }
  }

  // Features in XML
  const featRe = /<(Sketch|Extrude|Revolve|Hole|Fillet|Chamfer|Box|Cylinder)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  while ((m = featRe.exec(xml)) !== null) {
    const tag = m[1];
    const attrs = m[2] ?? '';
    const inner = m[3] ?? '';
    const obj: JsonObj = {
      type: tag,
      name: getAttr(attrs, 'name') || getAttr(attrs, 'id') || tag,
    };
    for (const attr of ['plane', 'sketch', 'depth', 'distance', 'radius', 'diameter', 'angle', 'axis', 'operation', 'op', 'end', 'extent', 'length', 'width', 'height', 'x', 'y', 'z', 'unit']) {
      const val = getAttr(attrs, attr);
      if (val) obj[attr] = val;
    }
    if (tag.toLowerCase() === 'sketch' && inner) {
      const ents: JsonObj[] = [];
      const childRe = /<(Rectangle|Rect|Circle|Line|Arc|Point)\b([^>]*?)\/?>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = childRe.exec(inner)) !== null) {
        const cTag = cm[1].toLowerCase();
        const cAttrs = cm[2] ?? '';
        const eObj: JsonObj = { type: cTag };
        for (const a of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'radius', 'diameter', 'width', 'height', 'startAngle', 'endAngle']) {
          const v = getAttr(cAttrs, a);
          if (v) eObj[a] = Number.isFinite(Number(v)) ? Number(v) : v;
        }
        ents.push(eObj);
      }
      obj.entities = ents;
    }
    dispatchFeatureObject(obj, ctx);
  }
}

function parseTextLinesPayload(text: string, streamPath: string, ctx: IptParseContext): void {
  const lowerPath = streamPath.toLowerCase();
  const lines = text.split(/\r\n|\r|\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Key-value metadata or parameter line
    const kv = /^([A-Za-z_][A-Za-z0-9_.\s]*?)\s*[:=]\s*(.+)$/.exec(line);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'units' || lowerKey === 'unit' || lowerKey === 'lengthunit') {
        const u = normalizeIptUnit(val);
        if (u) {
          ctx.defaultLengthUnit = u;
          ctx.hasExplicitLengthUnit = true;
          ctx.properties.units = u;
        }
        continue;
      }
      if (lowerKey === 'angleunit') {
        const au = normalizeIptUnit(val);
        if (au === 'deg' || au === 'rad') ctx.defaultAngleUnit = au;
        continue;
      }
      if (lowerKey === 'title' || lowerKey === 'partname' || lowerKey === 'name') {
        if (!ctx.properties.title) ctx.properties.title = val;
        continue;
      }
      if (lowerKey === 'partnumber') {
        ctx.properties.partNumber = val;
        continue;
      }
      if (lowerKey === 'author') {
        ctx.properties.author = val;
        continue;
      }
      if (lowerKey === 'material') {
        ctx.properties.material = val;
        continue;
      }
      if (lowerKey === 'version' || lowerKey === 'inventorversion') {
        ctx.properties.inventorVersion = val;
        continue;
      }
      if (lowerKey === 'segments' || lowerKey === 'segment') {
        for (const s of val.split(/[,;\s]+/)) if (s.trim()) ctx.segments.add(s.trim());
        continue;
      }
      if (lowerPath.includes('param') || lowerKey.startsWith('param ')) {
        const pName = lowerKey.startsWith('param ') ? key.slice(6).trim() : key;
        addIptParameter(ctx, pName, val);
        continue;
      }
    }

    // RSeSegInfo / RSeDb plain segment names
    if ((lowerPath.includes('rse') || lowerPath.includes('seg')) && /^[A-Za-z][A-Za-z0-9_]{2,32}$/.test(line)) {
      ctx.segments.add(line);
      continue;
    }

    // Line-oriented feature directives: e.g. `FEATURE Extrude name=Extrude1 sketch=Sketch1 depth=15`
    const featTokens = /^(?:FEATURE\s+)?(SKETCH|EXTRUDE|REVOLVE|HOLE|FILLET|CHAMFER|BOX|CYLINDER|LOFT|SWEEP|COIL|SHELL|RIB|EMBOSS)\b\s*(.*)$/i.exec(line);
    if (featTokens) {
      const fType = featTokens[1];
      const rest = featTokens[2].trim();
      const obj: JsonObj = { type: fType };
      const kvPairs = rest.matchAll(/([A-Za-z0-9_]+)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g);
      for (const pair of kvPairs) {
        const k = pair[1];
        const v = pair[2].replace(/^['"]|['"]$/g, '');
        obj[k] = Number.isFinite(Number(v)) && v !== '' ? Number(v) : v;
      }
      if (!obj.name) {
        const firstWord = rest.split(/\s+/)[0];
        if (firstWord && !firstWord.includes('=')) obj.name = firstWord;
      }
      dispatchFeatureObject(obj, ctx);
    }
  }
}

function inspectAndParseStream(stream: CfbStream, ctx: IptParseContext): void {
  const path = stream.path;
  const lower = path.toLowerCase();
  const text = decodeText(stream.data);
  const trimmed = text.trim();

  // Record segment name if it matches an Inventor segment stream
  if (lower.includes('ufrxdoc')) ctx.segments.add('UFRxDoc');
  if (lower.includes('rsedb')) ctx.segments.add('RSeDb');
  if (lower.includes('rseseginfo')) ctx.segments.add('RSeSegInfo');
  if (lower.includes('dckernel')) ctx.segments.add('DcKernel');
  if (lower.includes('param')) ctx.segments.add('Parameters');
  if (lower.includes('brep') || lower.includes('acis') || lower.includes('asm')) ctx.segments.add('BRep');
  if (lower.includes('ipropert')) ctx.segments.add('iProperties');

  if (!trimmed && stream.data.length === 0) return;

  // 1. Check for embedded STEP ISO-10303-21 payload
  const stepBlock = extractStepBlock(text);
  if (stepBlock) {
    ctx.stepBodies.push({
      name: stream.cleanName || 'Body',
      streamPath: path,
      step: stepBlock,
    });
    return;
  }

  // 2. Check for embedded ACIS ASCII SAT payload
  const satInfo = parseSatBlock(text);
  if (satInfo.valid) {
    ctx.satBodies.push({
      name: stream.cleanName || 'Body',
      streamPath: path,
      sat: satInfo.sat,
      ...(satInfo.unitsMmPerUnit ? { unitsMmPerUnit: satInfo.unitsMmPerUnit } : {}),
    });
    return;
  }

  // 3. Check for binary ACIS / ASM (.sab / .smb) header
  if (/^(?:ASM|ACIS)\s+BinaryFile/i.test(trimmed)) {
    ctx.warnings.push({
      object: path,
      code: 'binaryBrepStream',
      message: `Stream "${path}" contains proprietary binary ASM/ACIS B-rep data (${stream.size} bytes)`,
    });
    return;
  }

  // 4. Check for JSON payload (either direct or embedded after a binary prefix)
  const jsonStart = trimmed.search(/[{[]/);
  if (jsonStart >= 0) {
    const candidate = trimmed.slice(jsonStart);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      parseJsonPayload(parsed, path, ctx);
      return;
    } catch {
      // Fall through to XML or line-oriented parsing
    }
  }

  // 5. Check for XML payload
  if (trimmed.startsWith('<') || /<(?:Parameters|Features|UserParameter|Parameter|Sketch|Extrude)\b/i.test(trimmed)) {
    parseXmlPayload(trimmed, ctx);
    return;
  }

  // 6. Line-oriented text / key-value / DSL parsing
  parseTextLinesPayload(trimmed, path, ctx);
}

// ---------------------------------------------------------------------------
// Main Entry Point: importIpt
// ---------------------------------------------------------------------------

function inferPartName(fileName: string | undefined, properties: IptProperties): string {
  if (properties.title && properties.title.trim()) return properties.title.trim();
  if (fileName && fileName.trim()) {
    const base = fileName.replace(/^.*[\\/]/, '').replace(/\.ipt$/i, '').trim();
    if (base) return base;
  }
  return 'Inventor Part';
}

/**
 * Import an Autodesk Inventor `.ipt` byte buffer into a CadKit `PartDoc` with full `IptImportReport`.
 * Never throws on corrupt, truncated, or empty buffers; returns `ok: false` with `error` and `report`.
 */
export function importIpt(bytes: Uint8Array, fileName?: string): IptImportResult {
  const ctx: IptParseContext = {
    seq: 1,
    nextId: () => `F${ctx.seq++}`,
    features: [],
    parameters: [],
    paramByName: new Map(),
    steps: [],
    skipped: [],
    recognizedFeatures: [],
    fallbackFeatures: [],
    warnings: [],
    sketchIdByRef: new Map(),
    stepBodies: [],
    satBodies: [],
    meshBodies: [],
    properties: {},
    segments: new Set(),
    defaultLengthUnit: 'mm',
    defaultAngleUnit: 'deg',
    hasExplicitLengthUnit: false,
  };

  const makeFailure = (code: string, message: string, container: IptImportReport['container'] = 'invalid'): IptImportResult => {
    const name = inferPartName(fileName, ctx.properties);
    ctx.warnings.push({ object: fileName ?? name, code, message });
    const report: IptImportReport = {
      container,
      streams: [],
      segments: [],
      units: { length: 'mm', angle: 'deg' },
      totalFeatures: 0,
      recognizedCount: 0,
      fallbackCount: 0,
      recognizedFeatures: [],
      fallbackFeatures: [],
      usedBrepFallback: false,
      brepSource: 'none',
      parameterCount: 0,
      warnings: ctx.warnings,
      summary: `Could not import ${name}: ${message}`,
    };
    return {
      ok: false,
      name,
      kind: 'ipt',
      part: emptyPart(name),
      report,
      parameters: [],
      steps: [],
      skipped: [],
      stepBodies: [],
      satBodies: [],
      meshBodies: [],
      properties: ctx.properties,
      warnings: ctx.warnings,
      error: message,
    };
  };

  if (!bytes || bytes.length === 0) {
    return makeFailure('emptyFile', 'the Inventor (.ipt) file is empty');
  }

  let containerKind: IptImportReport['container'] = 'invalid';
  let streams: CfbStream[] = [];

  if (isCfbBytes(bytes)) {
    containerKind = 'cfb';
    try {
      const cfb = parseCfb(bytes);
      streams = cfb.streams;
    } catch (e) {
      return makeFailure('corruptCfb', `corrupt OLE2 / CFB container: ${(e as Error).message}`, 'cfb');
    }
  } else if (looksLikeZip(bytes)) {
    containerKind = 'zip';
    try {
      streams = readZipStoredEntries(bytes, false);
    } catch (e) {
      return makeFailure('corruptZip', `corrupt ZIP-wrapped .ipt container: ${(e as Error).message}`, 'zip');
    }
  } else if (isIptBytes(bytes)) {
    containerKind = 'json';
    streams = [
      {
        name: 'UFRxDoc',
        cleanName: 'UFRxDoc',
        path: 'UFRxDoc',
        size: bytes.length,
        data: bytes,
        isMiniStream: false,
      },
    ];
  } else {
    return makeFailure('invalidSignature', 'file is not a valid Autodesk Inventor (.ipt) OLE2/CFB or RSe container');
  }

  if (streams.length === 0) {
    return makeFailure('emptyContainer', 'Inventor (.ipt) container holds no readable streams', containerKind);
  }

  // Sort streams deterministically so metadata & parameters are parsed before DcKernel features and BRep
  const streamPriority = (s: CfbStream): number => {
    const l = s.path.toLowerCase();
    if (l.includes('ufrxdoc') || l.includes('ipropert') || l.includes('header')) return 0;
    if (l.includes('rsedb') || l.includes('rseseginfo')) return 1;
    if (l.includes('param')) return 2;
    if (l.includes('dckernel') || l.includes('feature') || l.includes('timeline')) return 3;
    if (l.includes('brep') || l.includes('acis') || l.includes('asm') || l.includes('step') || l.includes('sat')) return 4;
    return 5;
  };

  const orderedStreams = [...streams].sort((a, b) => streamPriority(a) - streamPriority(b));
  for (const s of orderedStreams) {
    inspectAndParseStream(s, ctx);
  }

  const partName = inferPartName(fileName, ctx.properties);
  const blobs: Record<string, string> = {};
  const meshes: Array<Record<string, unknown>> = [];

  // Determine whether we have solid-producing parametric features
  const hasParametricFeatures = ctx.features.length > 0;
  const hasUnsupportedFeatures = ctx.fallbackFeatures.length > 0;
  const needsBrepFallback = !hasParametricFeatures || hasUnsupportedFeatures;

  let usedBrepFallback = false;
  let brepSource: IptImportReport['brepSource'] = 'none';

  if (needsBrepFallback) {
    if (ctx.stepBodies.length > 0) {
      usedBrepFallback = true;
      brepSource = 'step';
      for (const sb of ctx.stepBodies) {
        const key = sha256Hex(sb.step);
        blobs[key] = sb.step;
        const id = ctx.nextId();
        ctx.features.push({
          type: 'importStep',
          id,
          name: sb.name || `${partName} B-Rep`,
          blob: key,
          heal: true,
        });
        ctx.steps.push({
          ipt: sb.name || 'BRep',
          type: 'ImportedSTEP',
          status: 'fallback',
          features: [id],
        });
      }
    } else if (ctx.satBodies.length > 0) {
      usedBrepFallback = true;
      brepSource = 'sat';
      for (const satBody of ctx.satBodies) {
        const stepText = satToStepFallback(satBody, partName);
        const key = sha256Hex(stepText);
        blobs[key] = stepText;
        const id = ctx.nextId();
        ctx.features.push({
          type: 'importStep',
          id,
          name: satBody.name || `${partName} ACIS B-Rep`,
          blob: key,
          heal: true,
        });
        ctx.steps.push({
          ipt: satBody.name || 'AcisBRep',
          type: 'ImportedSAT',
          status: 'fallback',
          features: [id],
        });
      }
    } else if (ctx.meshBodies.length > 0) {
      usedBrepFallback = true;
      brepSource = 'mesh';
      for (const mb of ctx.meshBodies) {
        meshes.push({
          id: `mesh_${ meshes.length + 1 }`,
          name: mb.name,
          positions: mb.positions,
          indices: mb.indices,
          tris: mb.triangleCount,
        });
        const stepText = meshToStepFallback(mb, partName);
        const key = sha256Hex(stepText);
        blobs[key] = stepText;
        const id = ctx.nextId();
        ctx.features.push({
          type: 'importStep',
          id,
          name: mb.name || `${partName} Mesh`,
          blob: key,
          heal: true,
        });
        ctx.steps.push({
          ipt: mb.name || 'DisplayMesh',
          type: 'ImportedMesh',
          status: 'fallback',
          features: [id],
        });
      }
    }
  }

  const variables = ctx.parameters.map((p) => ({ name: p.name, expr: p.expr }));
  const material = ctx.properties.material ? ctx.properties.material.toLowerCase() : 'steel';

  const part: IptPartDoc = {
    ...emptyPart(partName, material),
    features: ctx.features,
    seq: ctx.seq,
    ...(variables.length > 0 ? { variables } : {}),
    ...(Object.keys(blobs).length > 0 ? { blobs } : {}),
    ...(meshes.length > 0 ? { meshes } : {}),
  };

  const recognizedCount = ctx.recognizedFeatures.length;
  const fallbackCount = ctx.fallbackFeatures.length;
  const totalFeatures = recognizedCount + fallbackCount;

  if (ctx.features.length === 0 && ctx.warnings.length === 0) {
    ctx.warnings.push({
      object: partName,
      code: 'noGeometry',
      message: 'no readable parametric DcKernel features or B-rep geometry streams were found in this .ipt file',
    });
  }

  let summary: string;
  if (recognizedCount > 0 && fallbackCount === 0) {
    summary = `Imported ${partName} from Inventor (.ipt): all ${recognizedCount} parametric feature(s) converted (${ctx.parameters.length} parameter(s), units: mm/deg).`;
  } else if (recognizedCount > 0 && fallbackCount > 0 && usedBrepFallback) {
    summary = `Imported ${partName} from Inventor (.ipt): ${recognizedCount} of ${totalFeatures} feature(s) converted; ${fallbackCount} unsupported feature(s) (${ctx.fallbackFeatures.join(', ')}) fell back to ${brepSource.toUpperCase()} B-rep.`;
  } else if (recognizedCount > 0 && fallbackCount > 0) {
    summary = `Imported ${partName} from Inventor (.ipt): ${recognizedCount} of ${totalFeatures} feature(s) converted; ${fallbackCount} unsupported feature(s) (${ctx.fallbackFeatures.join(', ')}) skipped.`;
  } else if (usedBrepFallback) {
    const fbReason = fallbackCount > 0 ? ` (${fallbackCount} unsupported native feature(s): ${ctx.fallbackFeatures.join(', ')})` : '';
    summary = `Imported ${partName} from Inventor (.ipt) via embedded ${brepSource.toUpperCase()} B-rep fallback${fbReason}.`;
  } else {
    summary = `Could not extract geometry from ${partName} (.ipt).`;
  }

  const report: IptImportReport = {
    container: containerKind,
    streams: streams.map((s) => s.path),
    segments: Array.from(ctx.segments),
    units: {
      length: 'mm',
      angle: 'deg',
    },
    totalFeatures,
    recognizedCount,
    fallbackCount,
    recognizedFeatures: ctx.recognizedFeatures,
    fallbackFeatures: ctx.fallbackFeatures,
    usedBrepFallback,
    brepSource,
    parameterCount: ctx.parameters.length,
    warnings: ctx.warnings,
    summary,
  };

  const ok = ctx.features.length > 0 || ctx.parameters.length > 0;
  return {
    ok,
    name: partName,
    kind: 'ipt',
    part,
    report,
    parameters: ctx.parameters,
    steps: ctx.steps,
    skipped: ctx.skipped,
    stepBodies: ctx.stepBodies,
    satBodies: ctx.satBodies,
    meshBodies: ctx.meshBodies,
    properties: ctx.properties,
    warnings: ctx.warnings,
    ...(!ok ? { error: ctx.warnings[0]?.message ?? 'no importable geometry in .ipt file' } : {}),
  };
}
