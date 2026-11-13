// The wire format of the agent link (docs/agent-bridge.md): what the app and the local MCP daemon say to each other.
// Pure TypeScript with no Node or DOM imports: the daemon, the browser app and the tests all use it.

/** What an agent may ask the open app to do. `run_script`, `undo` and `redo` change the document; every other op only reads (state, a picture, and the
 *  measurement tools: bodies, measure, clearance, interference, thickness, draft, dfm). */
export type BridgeOp = 'state' | 'screenshot' | 'bodies' | 'measure' | 'clearance' | 'interference' | 'thickness' | 'draft' | 'dfm' | 'run_script' | 'undo' | 'redo';
/** The read-only measurement ops (answered by @kit/readback in the app). */
export const MEASURE_OPS = ['bodies', 'measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm'] as const;
export const BRIDGE_OPS: readonly BridgeOp[] = ['state', 'screenshot', ...MEASURE_OPS, 'run_script', 'undo', 'redo'];
/** Ops that change the open document: refused unless the user has ticked "Allow the agent to change this document". */
export const EDIT_OPS: ReadonlySet<BridgeOp> = new Set<BridgeOp>(['run_script', 'undo', 'redo']);

export interface BridgeRequest { id: string; op: BridgeOp; args: Record<string, unknown> }
export interface BridgeErrorBody { code: string; message: string; hint?: string }
export interface BridgeReply { id: string; ok: boolean; result?: unknown; error?: BridgeErrorBody }
export interface AppInfo { name: string; version?: string }
export interface HelloReply { session: string; pollMs: number }

/** The app polls this often at most (a long poll ends after this many ms with an empty list). */
export const POLL_MS = 20_000;
/** The app counts as connected while its last poll is at most this old. */
export const CONNECTED_MS = 35_000;
/** How long an agent call waits for the app's answer. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** A pairing code stops working after this long. */
export const CODE_TTL_MS = 10 * 60_000;
/** Wrong codes allowed before the current code is revoked. */
export const MAX_BAD_CODES = 5;
/** Largest reply body the daemon accepts from the app (a PNG as base64 fits). */
export const MAX_REPLY_BYTES = 24 * 1024 * 1024;

/** A failure with a stable code, the shape the MCP tools hand back to the agent. */
export class BridgeError extends Error {
  constructor(readonly code: string, message: string, readonly hint?: string) { super(message); this.name = 'BridgeError'; }
}

/** No look-alike characters (0/O, 1/I/L), so a code read from a chat window can be typed. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const CODE_LENGTH = 16;

/** `52311-ABCD-EFGH-JKMN-PQRS`: the daemon's loopback port and the 16-character one-time code. */
export function formatCode(port: number, raw: string): string {
  return `${port}-${raw.match(/.{1,4}/g)!.join('-')}`;
}
/** Read what the user pasted: spaces, case and dashes do not matter. Null when it is not a code. */
export function parseCode(text: string): { port: number; code: string } | null {
  const m = /^\s*(\d{2,5})[\s-]+([A-Za-z0-9\s-]+?)\s*$/.exec(text);
  if (!m) return null;
  const port = Number(m[1]);
  const code = m[2].replace(/[\s-]/g, '').toUpperCase();
  if (!(port >= 1024 && port <= 65535) || code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return { port, code };
}

/** Random bytes from the platform (Node 22 and every browser have globalThis.crypto). */
export function randomBytes(n: number): Uint8Array { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
export function randomCode(): string {
  let out = '';
  while (out.length < CODE_LENGTH) for (const b of randomBytes(32)) if (b < 240 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}
export const randomHex = (n: number): string => [...randomBytes(n)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Constant-time string comparison. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
