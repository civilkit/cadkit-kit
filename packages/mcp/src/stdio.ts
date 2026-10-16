// MCP over stdio: newline-delimited JSON-RPC. Nothing but protocol messages may be written to `out`.
import type { Readable, Writable } from 'node:stream';
import type { JsonRpcResponse } from './protocol';

export type LineHandler = (line: string) => Promise<JsonRpcResponse | JsonRpcResponse[] | null>;

/** Read lines from `input`, answer each through `handler` on `out`. Resolves when the input ends and all answers are written. */
export function serveStdio(handler: LineHandler, input: Readable, out: Writable): Promise<void> {
  return new Promise((resolve) => {
    let buf = '';
    const inflight = new Set<Promise<void>>();
    const write = (r: JsonRpcResponse | JsonRpcResponse[]) => { out.write(`${JSON.stringify(r)}\n`); };
    const dispatch = (line: string) => {
      if (!line.trim()) return;
      const p = handler(line).then((r) => { if (r) write(r); }, (e) => write({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String((e as Error)?.message ?? e) } })).finally(() => inflight.delete(p));
      inflight.add(p);
    };
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { dispatch(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    input.on('end', () => { dispatch(buf); buf = ''; void Promise.all([...inflight]).then(() => resolve()); });
  });
}
