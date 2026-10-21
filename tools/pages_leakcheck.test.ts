import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanText, scanDir, extractStrings } from './pages_leakcheck.mjs';

const ids = (t: string) => scanText(t).map((h) => h.id);
// the strings below are assembled so this test file itself carries no real-looking secret or address
const dot = '.';

describe('leak patterns', () => {
  it('flags internal hostnames', () => {
    expect(ids('fetch("https://dev.internal-host' + dot + 'com.au/x")')).toContain('internal-host');
    expect(ids('mem.internal-org')).toContain('internal-host');
  });
  it('flags IPv4 addresses but not loopback or SVG path data', () => {
    expect(ids('host="10' + dot + '0' + dot + '4' + dot + '17"')).toContain('ipv4');
    expect(ids('"127' + dot + '0.0.1"')).not.toContain('ipv4');
    expect(ids('"0.0.0.0"')).not.toContain('ipv4');
    expect(ids('d:"M1 2l1.2.4.5 1 1.1v1.1.2.5-1L6.4 6.5z"')).not.toContain('ipv4');
    expect(ids('version "300.1.1.1"')).not.toContain('ipv4');   // octet out of range
  });
  it('flags absolute paths', () => {
    expect(ids('"/Users/someone/proj/a.ts"')).toContain('abs-path');
    expect(ids('"/Volumes/disk/x"')).toContain('abs-path');
    expect(ids('"C:\\\\Users\\\\x"')).toContain('abs-path');
    expect(ids('"/usr/lib/x"')).not.toContain('abs-path');
  });
  it('flags e-mail addresses, not @2x style names', () => {
    expect(ids('a.b+c@example.org')).toContain('email');
    expect(ids('icon@2x.png')).not.toContain('email');
  });
  it('flags localhost URLs with a port', () => {
    expect(ids('http://localhost:5173/')).toContain('localhost-url');
    expect(ids('localhost')).not.toContain('localhost-url');
    expect(ids('url:"http://127.0.0.1:7461"')).not.toContain('localhost-url');   // the local kernel service default
    expect(ids('http://127.0.0.1:7462/')).toContain('localhost-url');
  });
  it('flags key-looking strings', () => {
    expect(ids('k="sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2"')).toContain('api-key');
    expect(ids('AKIA' + 'ABCDEFGHIJKLMNOP')).toContain('api-key');
    expect(ids('ghp_' + 'a'.repeat(36))).toContain('api-key');
    expect(ids('apiKey: "' + 'Zm9vYmFyYmF6cXV4' + 'Zm9vYmFyYmF6cXV4"')).toContain('secret-near-word');
    expect(ids('const sha = "' + 'a'.repeat(40) + '"')).not.toContain('secret-near-word');   // a hash with no key word next to it
  });
  it('flags the product names, any case, with or without a hyphen', () => {
    expect(ids('Iron' + 'CAD')).toContain('product-name');
    expect(ids('tri' + 'ball')).toContain('product-name');
    expect(ids('Tri-' + 'Ball')).toContain('product-name');
    expect(ids('moveball')).not.toContain('product-name');
  });
  it('flags source map references', () => {
    expect(ids('//# sourceMappingURL=a.js.map')).toContain('source-map');
  });
  it('gives context around a hit', () => {
    const [h] = scanText('before text /Users/me/x after text');
    expect(h.context).toContain('before text');
    expect(h.context).toContain('after text');
  });
});

describe('extractStrings', () => {
  it('pulls printable runs out of a binary', () => {
    const b = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('/Users/me/lib.rs'), Buffer.from([0, 0xff]), Buffer.from('ab'), Buffer.from([0])]);
    expect(extractStrings(b)).toBe('/Users/me/lib.rs');
  });
});

describe('scanDir', () => {
  const mk = () => mkdtempSync(join(resolve(__dirname, '../../scratch-qa-pages'), 'leak-'));
  it('reads text files and wasm strings, rejects .map files, and honours allow entries that have a reason', () => {
    const d = mk();
    try {
      mkdirSync(join(d, 'assets'));
      writeFileSync(join(d, 'assets/a.js'), 'x="/Users/me/p"; y="a@b.org"');
      writeFileSync(join(d, 'k.wasm'), Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d]), Buffer.from('panic at /Volumes/d/src/lib.rs'), Buffer.from([0])]));
      writeFileSync(join(d, 'a.js.map'), '{}');
      const r = scanDir(d);
      expect(r.hits.map((h: { file: string; id: string }) => `${h.file}:${h.id}`).sort()).toEqual(['a.js.map:source-map', 'assets/a.js:abs-path', 'assets/a.js:email', 'k.wasm:abs-path']);
      const r2 = scanDir(d, [{ id: 'email', match: 'a@b.org', reason: 'test address' }]);
      expect(r2.allowed).toHaveLength(1);
      expect(r2.hits.some((h: { id: string }) => h.id === 'email')).toBe(false);
      expect(() => scanDir(d, [{ id: 'email' }] as never)).toThrow(/reason/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
