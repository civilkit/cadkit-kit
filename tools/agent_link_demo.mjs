#!/usr/bin/env node
// A scripted agent for demos and recordings of the agent link (docs/agent-bridge.md, "Running it for a demo").
// It starts its own MCP daemon on a free loopback port (state in a private folder, so it never touches a daemon you already run),
// asks for a pairing code, prints it and writes it to a file, waits for the app to link, then plays an agent:
//   app_status, app_screenshot, (only if the edit box is ticked) app_run_script, app_screenshot, app_undo.
// It stops only the daemon it started (HTTP shutdown, then a kill of that one child), and exits 0 when the sequence ran.
//
//   node tools/agent_link_demo.mjs [--origin http://localhost:5173] [--out DIR] [--wasm PATH]
//        [--link-wait 180] [--edit-wait 20] [--pause 1500]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
if (argv.includes('--help')) { process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n'); process.exit(0); }
const origin = opt('--origin', 'http://localhost:5173');
const out = resolve(opt('--out', join(tmpdir(), 'agent-link-demo')));
const linkWait = Number(opt('--link-wait', 180)) * 1000;
const editWait = Number(opt('--edit-wait', 20)) * 1000;
const pause = Number(opt('--pause', 1500));
const wasm = opt('--wasm', process.env.CK_WASM);
mkdirSync(out, { recursive: true });
const home = join(out, 'daemon-home');
mkdirSync(home, { recursive: true });

const t0 = Date.now();
const steps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${msg}\n`);
const record = (name, ms, extra = {}) => { steps.push({ step: name, atMs: Date.now() - t0, tookMs: ms, ...extra }); };
const finish = (code) => { writeFileSync(join(out, 'steps.json'), JSON.stringify({ origin, steps }, null, 1)); return code; };

let child = null, state = null;
const stopDaemon = async () => {
  if (!child) return;
  if (state) { try { await fetch(`http://127.0.0.1:${state.port}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${state.token}` } }); } catch { /* already gone */ } }
  const gone = new Promise((r) => child.once('exit', r));
  await Promise.race([gone, sleep(4000)]);
  if (child.exitCode === null) child.kill('SIGTERM');   // this one child only
  say('daemon stopped');
  child = null;
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopDaemon(); process.exit(finish(130)); });

async function main() {
  say(`starting the MCP daemon (allowed origin ${origin})`);
  const args = [join(root, 'packages/mcp/bin/ck-mcp.mjs'), '--daemon', '--allow-origin', origin, '--idle-seconds', '3600', ...(wasm ? ['--wasm', wasm] : [])];
  child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, CK_MCP_HOME: home } });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.once('exit', (c) => { if (c) say(`daemon exited early (${c}): ${err.trim().split('\n').slice(-3).join(' | ')}`); });
  const stateFile = join(home, 'daemon.json');
  const tStart = Date.now();
  while (!existsSync(stateFile)) { if (child.exitCode !== null || Date.now() - tStart > 60000) throw new Error('the daemon did not start'); await sleep(200); }
  await sleep(100);
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
  record('daemon started', Date.now() - tStart, { port: state.port });
  say(`daemon up on 127.0.0.1:${state.port}`);

  let id = 0;
  const call = async (name, args = {}) => {
    const r = await fetch(`http://127.0.0.1:${state.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
    const res = (await r.json()).result;
    const text = res.content.find((c) => c.type === 'text' && c.text.startsWith('{'))?.text;
    return { isError: !!res.isError, body: text ? JSON.parse(text) : {}, image: res.content.find((c) => c.type === 'image') };
  };

  const pair = await call('bridge_pair');
  const code = pair.body.code;
  writeFileSync(join(out, 'pairing-code.txt'), code + '\n');
  say(`PAIRING CODE: ${code}   (also in ${join(out, 'pairing-code.txt')}; valid ${pair.body.expiresInSeconds} s)`);
  say('step 1: paste it in Settings > Agent link and press Turn on');
  record('pairing code ready', 0);

  const tWait = Date.now();
  let st;
  do {
    await sleep(500);
    st = (await call('app_status')).body;
    if (Date.now() - tWait > linkWait) throw new Error(`no app linked within ${linkWait / 1000} s`);
  } while (!st.connected);
  record('app linked', Date.now() - tWait);
  say(`app linked after ${((Date.now() - tWait) / 1000).toFixed(1)} s (${st.app?.name ?? 'app'}, edit ${st.edit ? 'allowed' : 'not allowed'})`);
  await sleep(pause);

  let t = Date.now();
  st = (await call('app_status')).body;
  record('app_status', Date.now() - t, { edit: st.edit });
  say(`step 2: app_status -> connected ${st.connected}, edit ${st.edit}`);
  await sleep(pause);

  const shot = async (name, label) => {
    const t1 = Date.now();
    const r = await call('app_screenshot', { view: 'iso', size: 768 });
    if (r.isError) { say(`${label}: ${r.body.error.code}: ${r.body.error.message}`); record(label, Date.now() - t1, { error: r.body.error.code }); return; }
    const file = join(out, name);
    writeFileSync(file, Buffer.from(r.image.data, 'base64'));
    record(label, Date.now() - t1, { file });
    say(`${label}: saved ${file} (${Math.round(r.image.data.length * 0.75 / 1024)} KB, ${Date.now() - t1} ms)`);
  };
  say('step 3: app_screenshot');
  await shot('agent-link-before.png', 'screenshot before');
  await sleep(pause);

  // the edit box is the user's: wait a little for it, never assume it
  const tEdit = Date.now();
  while (!st.edit && Date.now() - tEdit < editWait) { await sleep(500); st = (await call('app_status')).body; }
  if (!st.edit) {
    say(`step 4: skipped: "Allow the agent to change this document" is not ticked (waited ${editWait / 1000} s). View only.`);
    record('edit skipped', Date.now() - tEdit);
  } else {
    t = Date.now();
    say('step 4: app_run_script (adds a block beside the part)');
    const run = await call('app_run_script', { code: "part('Agent block').sketch('top', (s) => s.rect(20, 20, [70, 0])).extrude(15)" });
    record('app_run_script', Date.now() - t, { ok: !run.isError && run.body.ok });
    say(run.isError ? `  failed: ${run.body.error.code}: ${run.body.error.message}` : `  ok: created ${(run.body.created ?? []).join(', ')} in ${Date.now() - t} ms (one undo step)`);
    await sleep(pause);
    if (!run.isError) {
      await shot('agent-link-after.png', 'screenshot after');
      await sleep(pause);
      t = Date.now();
      say('step 5: app_undo');
      const u = await call('app_undo');
      record('app_undo', Date.now() - t, { ok: !u.isError });
      say(u.isError ? `  failed: ${u.body.error.code}` : `  ok: undone in ${Date.now() - t} ms`);
      await sleep(pause);
    }
  }
  say('done: turning the link off is up to the user (Settings > Agent link > Turn off)');
  record('done', 0);
}

let code = 0;
try { await main(); } catch (e) { say(`error: ${e.message}`); code = 1; }
await stopDaemon();
process.exit(finish(code));
