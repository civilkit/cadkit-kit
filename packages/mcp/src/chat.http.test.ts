// The chat route of the daemon, with a FAKE `claude` executable (a small node script that prints canned stream-json). No real
// Claude Code process, no model and no network is involved.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type Daemon } from './daemon';
import { requestPairCode } from './shim';
import { CHAT_TOOLS, chatArgs, eventMapper, validateChat } from './chat';
import { BridgeClient } from '@kit/agent-link';
import type { Backend } from './protocol';

const backend: Backend = { tools: () => [], call: async () => ({ content: [{ type: 'text', text: 'x' }] }), resources: () => [], read: async () => null };
const dirs: string[] = [];
const daemons: Daemon[] = [];
const clients: BridgeClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect();
  for (const d of daemons.splice(0)) await d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// the fake claude: records its arguments, working folder and the prompt it was given, then plays a script chosen by the prompt
const FAKE = `
const fs = require('fs');
const out = process.env.FAKE_OUT;
let prompt = '';
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => {
  fs.writeFileSync(out + '/call.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), prompt }));
  const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const SID = '11111111-2222-3333-4444-555555555555';
  if (prompt.includes('crash')) { process.stderr.write('boom: something broke'); process.exit(1); }
  // event shapes as recorded from claude 2.1.322 (stream-json, --verbose, --include-partial-messages): hook lines, one assistant event per
  // content block, tool_result content as an array, thinking deltas, a rate_limit_event, and a result carrying terminal_reason
  w({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup', session_id: SID });
  w({ type: 'system', subtype: 'init', session_id: SID, tools: [] });
  w({ type: 'system', subtype: 'status', status: 'requesting', session_id: SID });
  if (prompt.includes('login')) { w({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key - Please run /login', session_id: SID }); return; }
  if (prompt.includes('maxturns')) { w({ type: 'result', subtype: 'error_max_turns', is_error: true, terminal_reason: 'max_turns', errors: ['Reached maximum number of turns (1)'], session_id: SID }); return; }
  if (prompt.includes('slow')) { process.on('SIGTERM', () => { fs.writeFileSync(out + '/terminated', '1'); process.exit(143); }); setInterval(() => {}, 1000); return; }
  const se = (event) => w({ type: 'stream_event', event, session_id: SID });
  se({ type: 'message_start', message: { id: 'm1', role: 'assistant', content: [] } });
  se({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } });
  se({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
  se({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Making ' } });
  se({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'a plate.' } });
  w({ type: 'assistant', message: { content: [{ type: 'text', text: 'Making a plate.' }] }, session_id: SID });
  se({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'mcp__ck-cad__app_run_script', input: {} } });
  se({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"code":"secret-script-text"}' } });
  w({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__ck-cad__app_run_script', input: { code: 'secret-script-text' }, caller: { type: 'direct' } }] }, session_id: SID });
  w({ type: 'rate_limit_event', session_id: SID });
  w({ type: 'user', message: { content: [{ tool_use_id: 'tu1', type: 'tool_result', content: [{ type: 'text', text: '{"ok":true}' }] }] }, session_id: SID });
  w({ type: 'result', subtype: 'success', is_error: false, result: 'Made a plate.', terminal_reason: 'completed', session_id: SID });
});
`;

async function boot(over: { claudeBin?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-'));
  dirs.push(dir);
  const script = join(dir, 'fake-claude.cjs');
  writeFileSync(script, FAKE);
  const d = await startDaemon({ backend, dir, idleMs: 0, chat: { claudeBin: over.claudeBin ?? process.execPath, claudeArgs: over.claudeBin ? [] : [script], env: { ...process.env, FAKE_OUT: dir } } });
  daemons.push(d);
  // the page's side: pair, then hold the session token
  const app = new BridgeClient({ app: { name: 'test' }, allowEdit: () => false, handle: async () => ({}), retryMs: 20 });
  clients.push(app);
  const code = await requestPairCode(d);
  await app.connect(code);
  const session = (app as unknown as { session: string }).session;
  const post = (body: unknown, signal?: AbortSignal, token = session) => fetch(`http://127.0.0.1:${d.port}/bridge/chat`, { method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const events = async (r: Response) => (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { d, dir, post, events, called: () => JSON.parse(readFileSync(join(dir, 'call.json'), 'utf8')) as { args: string[]; cwd: string; prompt: string } };
}

describe('POST /bridge/chat', () => {
  it('needs the paired session token, and the daemon token is not enough', async () => {
    const { d, post } = await boot();
    expect((await post({ text: 'hi' }, undefined, 'nope')).status).toBe(401);
    expect((await post({ text: 'hi' }, undefined, d.token)).status).toBe(401);
  });

  it('refuses bad input before starting anything', async () => {
    const { post, dir } = await boot();
    for (const b of [{}, { text: '' }, { text: 'x', model: 'gpt-9' }, { text: 'x', model: 'opus --dangerously-skip-permissions' }, { text: 'x', resume: '--help' }, { text: 'x'.repeat(30000) }]) {
      const r = await post(b);
      expect(r.status).toBe(400);
    }
    expect(existsSync(join(dir, 'call.json'))).toBe(false);
  });

  it('streams text, tool calls and the end; the prompt goes on stdin and the arguments are the fixed list', async () => {
    const { post, events, called } = await boot();
    const r = await post({ text: 'make a plate', model: 'opus' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/ndjson/);
    const ev = await events(r);
    expect(ev).toEqual([
      { type: 'session', id: '11111111-2222-3333-4444-555555555555' },
      { type: 'text', delta: 'Making ' }, { type: 'text', delta: 'a plate.' },
      { type: 'tool', id: 'tu1', name: 'app_run_script' },
      { type: 'tool_result', id: 'tu1', ok: true },
      { type: 'done' },
    ]);
    expect(JSON.stringify(ev)).not.toContain('secret-script-text');   // tool input is not relayed
    const c = called();
    expect(c.prompt).toBe('make a plate');
    expect(c.args.slice(0, 2)).toEqual(['-p', '--output-format']);
    expect(c.args[c.args.indexOf('--model') + 1]).toBe('opus');
    expect(c.args[c.args.indexOf('--tools') + 1]).toBe('');
    expect(c.args).toContain('--strict-mcp-config');
    expect(c.args[c.args.indexOf('--settings') + 1]).toBe('{"disableAllHooks":true}');
    expect(c.args[c.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(c.args).not.toContain('--resume');
    expect(c.args.join(' ')).not.toMatch(/Bash|dangerously|bypass/);
    expect(CHAT_TOOLS).toContain('app_status');   // the model asks for it first; refusing it made it report a permission problem
    expect(c.args[c.args.indexOf('--allowedTools') + 1].split(',').sort()).toEqual(CHAT_TOOLS.map((t) => `mcp__ck-cad__${t}`).sort());
    expect(c.cwd).toMatch(/ck-chat-/);                              // an empty temporary folder, not the repo
  });

  it('allows the read-only measurement tools of the open document and tells the model about them', async () => {
    const { post, events, called } = await boot();
    await events(await post({ text: 'how far apart are the lid and the box?' }));
    const args = called().args;
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',');
    for (const t of ['bodies', 'measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm']) expect(allowed, t).toContain(`mcp__ck-cad__app_${t}`);
    // nothing else was widened: the allow-list is the app_ tools, docs and list_methods, no headless tools, no file or shell tools
    expect(allowed.every((t) => /^mcp__ck-cad__(app_|docs$|list_methods$)/.test(t))).toBe(true);
    const prompt = args[args.indexOf('--append-system-prompt') + 1];
    expect(prompt).toMatch(/app_measure/);
    expect(prompt).toMatch(/never change the document and need no edit permission/);
  });

  it('resumes a session by id', async () => {
    const { post, events, called } = await boot();
    await events(await post({ text: 'again', resume: '11111111-2222-3333-4444-555555555555' }));
    const a = called().args;
    expect(a[a.indexOf('--resume') + 1]).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('reports a missing login, the turn cap, a crash and a missing claude in plain codes', async () => {
    const { post, events } = await boot();
    expect((await events(await post({ text: 'login please' }))).at(-1)).toMatchObject({ type: 'error', code: 'not_logged_in' });
    expect((await events(await post({ text: 'maxturns' }))).at(-1)).toMatchObject({ type: 'error', code: 'cap' });
    const crash = (await events(await post({ text: 'crash' }))).at(-1);
    expect(crash).toMatchObject({ type: 'error', code: 'failed' });
    expect(crash.detail).toContain('boom');
    const gone = await boot({ claudeBin: join(tmpdir(), 'no-such-claude-binary') });
    expect((await gone.events(await gone.post({ text: 'hi' }))).at(-1)).toEqual({ type: 'error', code: 'claude_missing' });
  });

  it('Stop (closing the request) ends the process', async () => {
    const { post, dir } = await boot();
    const ac = new AbortController();
    const r = await post({ text: 'slow one' }, ac.signal);
    const reader = r.body!.getReader();
    await reader.read();                                          // the session event: it is running
    ac.abort();
    for (let i = 0; i < 50 && !existsSync(join(dir, 'terminated')); i++) await new Promise((x) => setTimeout(x, 100));
    expect(existsSync(join(dir, 'terminated'))).toBe(true);
    // and the next turn can start (not "busy")
    const next = await post({ text: 'again' });
    expect((await next.text())).toContain('done');
  });

  it('only one turn runs at a time', async () => {
    const { post } = await boot();
    const ac = new AbortController();
    const first = await post({ text: 'slow one' }, ac.signal);
    await first.body!.getReader().read();
    const second = await (await post({ text: 'hi' })).text();
    expect(second).toContain('busy');
    ac.abort();
  });
});

describe('chat command line and event mapping', () => {
  it('pairs only through validated values: model aliases and a UUID', () => {
    expect(validateChat({ text: 'a', model: 'haiku' })).toMatchObject({ ok: true });
    expect(validateChat({ text: 'a' })).toMatchObject({ ok: true, req: { model: 'sonnet' } });
    expect(chatArgs({ model: 'sonnet' }, { command: 'node', args: ['x'] }).filter((a) => a === '--resume')).toHaveLength(0);
  });
  it('falls back to the whole assistant text when nothing streamed', () => {
    const m = eventMapper();
    expect(m(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }))).toEqual([{ type: 'text', delta: 'Hi' }]);
    expect(m('not json')).toEqual([]);
  });
});
