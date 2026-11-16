// Runs a wasm plugin where its code cannot reach the page or the network.
//
// The package's JavaScript (the jco glue) is not ours, so it never runs in the page. It runs in a Worker inside an iframe that is
//   - sandboxed (`sandbox="allow-scripts"`, no allow-same-origin): an opaque origin, no access to the page's DOM, storage, cookies or IndexedDB;
//   - under a Content-Security-Policy with `default-src 'none'`: no fetch, XHR, WebSocket, image, frame or form requests, whatever the code tries
//     (the Worker inherits the policy of the frame that creates it).
// The only way out is postMessage to the page, which answers `commands.run` requests from the trusted interpreter (an allow-list of commands,
// a command limit, and a deadline after which the frame is removed, which kills the Worker). Chain: page <-> relay (iframe) <-> Worker.
// Residual risks are listed in docs/plugins.md (WebRTC is not covered by connect-src in every browser; a Worker spinning forever costs CPU until the deadline).
import replaySource from './replay.js?raw';
import type { InstalledPlugin } from '@kit/plugin';

// 'unsafe-eval' is for loadGlue below (the package's own code, inside the sandbox, which can run any code anyway). No data:/blob: script sources are needed:
// the glue is evaluated, not imported, so a host page with a strict CSP (the desktop app) only has to allow the relay's hash, see relayHash().
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:";

// the Worker: the replay host (replay.js without its `export`) plus the glue that loads the component from the bytes the page sends
const WORKER_MAIN = `
// The glue is an ES module (\`export function instantiate\`, \`export const _util\`, one \`import.meta.url\` in a default that is never used here).
// It is evaluated as a function body instead of imported from a data: URL, so the host page's CSP needs no data:/blob: script source.
const loadGlue = (js) => {
  if (/^\\s*import[\\s{*"']/m.test(js)) throw new Error('the glue has a static import, which a package cannot have');
  const body = js.replace(/^export\\s+(?=function|const|let|class|async)/gm, '').replace(/import\\.meta\\.url/g, "'about:blank'");
  if (/^\\s*export\\b/m.test(body)) throw new Error('the glue has an export form this host does not handle');
  // an async function body, so a glue with top-level await still loads
  return new (Object.getPrototypeOf(async function () {}).constructor)('"use strict";\\n' + body + '\\nreturn { instantiate };')();
};
const pending = new Map(); let seq = 0;
const handler = (command, args) => new Promise((ok, fail) => { const id = ++seq; pending.set(id, { ok, fail }); postMessage({ type: 'cmd', id, command, args }); });
onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.ok(m.value) : p.fail(new Error(m.error))); return; }
  if (m.type !== 'job') return;
  try {
    const mod = await loadGlue(new TextDecoder().decode(Uint8Array.from(atob(m.jsBase64), (ch) => ch.charCodeAt(0))));
    const compiled = new Map();
    const loaded = { instantiate: mod.instantiate, getCoreModule: (path) => {
      let c = compiled.get(path);
      if (!c) { const key = Object.keys(m.cores).find((k) => k === path || k.endsWith('/' + path)); if (!key) return Promise.reject(new Error('core module ' + path + ' is not in the package')); compiled.set(path, (c = WebAssembly.compile(m.cores[key]))); }
      return c;
    } };
    const { result, stats } = await runPlugin(loaded, m.entry, m.params, handler, { allow: new Set(m.allow), maxCommands: m.maxCommands, deadlineMs: m.deadlineMs });
    postMessage({ type: 'done', ok: true, result, stats: { commands: stats.commands, instances: stats.instances, totalMs: stats.totalMs, log: stats.log } });
  } catch (err) { postMessage({ type: 'done', ok: false, error: String(err && err.message || err) }); }
};
`;
export const workerSource = (): string => replaySource.replace(/^export /m, '') + '\n' + WORKER_MAIN;

// the relay: creates the Worker from the source it is sent and passes messages both ways; it never touches the code it relays
const RELAY = `
let w;
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === 'start') {
    w = new Worker(URL.createObjectURL(new Blob([m.source], { type: 'text/javascript' })));
    w.onmessage = (x) => parent.postMessage(x.data, '*');
    w.onerror = (x) => parent.postMessage({ type: 'done', ok: false, error: 'worker error: ' + (x.message || 'failed to start') }, '*');
    w.postMessage(m.job, m.transfer);
  } else if (m.type === 'reply' && w) w.postMessage(m);
});
parent.postMessage({ type: 'ready' }, '*');
`;
/** The relay script as it appears in the frame; a host page with a strict CSP allows exactly this script by hash (`'sha256-…'` in its script-src). */
export const relayScript = (): string => RELAY.replace(/<\/script/g, '<\\/script');
export const frameHtml = (): string => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>${relayScript()}</script>`;

export interface SandboxOpts { deadlineMs?: number; maxCommands?: number }
export type Handler = (command: string, args: unknown) => Promise<unknown>;

const b64 = (s: string): string => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };

/** Runs one entry of an installed wasm plugin in a fresh sandbox. Resolves to the entry's result; rejects on a plugin error, a limit or the deadline. */
export function runSandboxed(p: InstalledPlugin, entry: string, params: unknown, handler: Handler, o: SandboxOpts = {}, doc: Document = document): Promise<{ result: unknown; stats: { commands: number; instances: number; totalMs: number; log: string[] } }> {
  const w = p.manifest.wasm!;
  const deadline = o.deadlineMs ?? w.limits?.deadlineMs ?? 30000;
  return new Promise((ok, fail) => {
    const frame = doc.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc = frameHtml();
    let finished = false, asked = 0;
    const cap = o.maxCommands ?? w.limits?.maxCommands ?? 256;
    const end = (fn: () => void): void => { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', onMsg); frame.remove(); fn(); };
    const timer = setTimeout(() => end(() => fail(new Error(`deadline of ${deadline} ms exceeded: the plugin was stopped`))), deadline);
    const post = (m: unknown, transfer: Transferable[] = []): void => { frame.contentWindow?.postMessage(m, '*', transfer); };
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.contentWindow) return;   // only this frame
      const m = e.data as { type?: string; id?: number; command?: string; args?: unknown; ok?: boolean; result?: unknown; error?: string; stats?: never };
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'ready') {
        const cores: Record<string, Uint8Array> = {};
        for (const c of w.cores) { const bytes = p.binaries?.[c]; if (!bytes) { end(() => fail(new Error(`core module ${c} is missing`))); return; } cores[c] = bytes.slice(); }
        post({ type: 'start', source: workerSource(), job: { type: 'job', jsBase64: b64(p.files[w.js]), cores, entry, params, allow: w.commands, maxCommands: o.maxCommands ?? w.limits?.maxCommands ?? 256, deadlineMs: deadline }, transfer: Object.values(cores).map((c) => c.buffer) }, []);
      } else if (m.type === 'cmd' && typeof m.id === 'number' && typeof m.command === 'string') {
        // the Worker is not trusted, so its own allow-list check counts for nothing: the page enforces the manifest's list and the command limit itself
        if (!w.commands.includes(m.command)) { post({ type: 'reply', id: m.id, ok: false, error: `${m.command} is not in the manifest's commands` }); return; }
        if (++asked > cap + 1) { end(() => fail(new Error(`limit-exceeded: more than ${cap} commands in one run`))); return; }
        handler(m.command, m.args).then((value) => post({ type: 'reply', id: m.id, ok: true, value }), (err) => post({ type: 'reply', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }));
      } else if (m.type === 'done') {
        end(() => (m.ok ? ok({ result: m.result, stats: m.stats as never }) : fail(new Error(m.error ?? 'the plugin failed'))));
      }
    };
    window.addEventListener('message', onMsg);
    doc.body.appendChild(frame);
  });
}
