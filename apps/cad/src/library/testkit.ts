// Helpers for the library tests: the fixture library on disk, a fake fetch that serves it under any base URL (no network), a fake
// key-value store. Test-only; nothing in the app imports this.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { memoryCache } from './cache';
import { LibraryRegistry, type DefaultLibrary, type KV } from './registry';
import type { FetchLike, LocalFiles } from './source';

export const FIXTURE_DIR = join(__dirname, 'fixtures');
export const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** The fixture folder as a path -> file map (what a folder picker hands over). */
export function fixtureFiles(): LocalFiles {
  const out: LocalFiles = new Map();
  const walk = (dir: string, rel: string) => {
    for (const n of readdirSync(join(dir))) {
      const p = join(dir, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r);
      else { const buf = readFileSync(p); out.set(r, { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, size: buf.length }); }
    }
  };
  walk(FIXTURE_DIR, '');
  return out;
}

export interface FakeNet {
  fetch: FetchLike;
  calls: string[];
  /** every request fails like a dead network */
  offline: boolean;
  /** replace the answer for a path (relative to the served base) */
  override(path: string, body: string | Uint8Array | null, init?: { status?: number; headers?: Record<string, string> }): void;
}
/** Serves the fixture library for URLs under `bases` (a list of origin+path prefixes ending in `/`). */
export function fakeNet(bases: string[], files = readFixture()): FakeNet {
  const over = new Map<string, { body: string | Uint8Array | null; init?: { status?: number; headers?: Record<string, string> } }>();
  const net: FakeNet = {
    calls: [], offline: false,
    override(path, body, init) { over.set(path, { body, init }); },
    fetch: async (url) => {
      net.calls.push(url);
      if (net.offline) throw new TypeError('network down');
      const base = bases.find((b) => url.startsWith(b));
      if (!base) return new Response('nope', { status: 404 });
      const path = url.slice(base.length);
      const o = over.get(path);
      if (o) return o.body === null ? new Response(null, { status: o.init?.status ?? 404 }) : new Response(o.body as BodyInit, { status: o.init?.status ?? 200, headers: o.init?.headers });
      const f = files.get(path);
      return f ? new Response(f as BodyInit, { status: 200 }) : new Response('missing', { status: 404 });
    },
  };
  return net;
}
function readFixture(): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const [k] of fixtureFiles()) m.set(k, new Uint8Array(readFileSync(join(FIXTURE_DIR, k))));
  return m;
}

export function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

export function makeRegistry(net: FakeNet, o: { kv?: KV; defaults?: DefaultLibrary[]; cache?: ReturnType<typeof memoryCache> } = {}) {
  const cache = o.cache ?? memoryCache(), kv = o.kv ?? memoryKV();
  return { registry: new LibraryRegistry({ fetch: net.fetch, cache, kv, defaults: o.defaults ?? [], base: '/app/', now: () => 1000 }), cache, kv };
}

export const GH_BASE = 'https://raw.githubusercontent.com/example/parts/HEAD/';
