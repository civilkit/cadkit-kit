// The in-app chat, daemon side (docs/agent-chat.md). One chat turn = one `claude` (Claude Code CLI) process, run non-interactively
// on the user's own Claude Code login, with ONLY this server's app_* tools attached. Its output is turned into a few plain events
// and streamed to the page as newline-delimited JSON.
//
// What the process is allowed to do is fixed here and is not influenced by the page: the argument list is built from constants plus
// two validated values (a model alias and a session id), there is no shell, the tools are an allow-list (no Bash, no file tools,
// nothing else), and the working directory is an empty temporary folder. The page sends text, nothing else reaches the command line.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHAT_MODELS = ['opus', 'sonnet', 'haiku'] as const;
export const DEFAULT_CHAT_MODEL = 'sonnet';
export const MCP_SERVER_NAME = 'ck-cad';
/** The only tools the chat process may call: the open document (read, picture, edit with the user's permission) and the script docs. */
export const CHAT_TOOLS = ['app_status', 'app_state', 'app_screenshot', 'app_run_script', 'app_undo', 'app_redo', 'list_methods', 'docs'] as const;
export const MAX_CHAT_TURNS = 24;
export const MAX_PROMPT_CHARS = 20_000;

export type ChatErrorCode = 'claude_missing' | 'not_logged_in' | 'rate_limit' | 'overloaded' | 'cap' | 'busy' | 'bad_request' | 'failed';
export type ChatEventOut =
  | { type: 'session'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; code: ChatErrorCode; detail?: string };

const SYSTEM = [
  'You are the assistant inside CivilKit CAD, a parametric solid-modelling app. The user has a part open in the app and asks you, in plain words, to change or inspect it. You work on that open document only, through the app_ tools.',
  'Work like this: call app_state to see what is there; call docs once with the methods you plan to use (list_methods finds names); write a short script and run it with app_run_script; read the result (errors come with their line and a hint, and nothing changes when a script fails; fix it and run again); call app_screenshot to check the shape when it matters. Then say in one or two sentences what you made.',
  'app_run_script ADDS features after the existing ones as one undo step; it cannot edit or delete features that are already there; app_undo takes your own edit back. If it says edit_not_allowed, tell the user to tick "Allow the agent to change this document" in the chat panel and stop. Do not claim something is built or valid unless a tool result showed it. If a request is unclear, ask instead of guessing.',
  'Script conventions: millimetres and degrees, Y is up; front = XY plane (normal +Z), top = XZ (normal +Y), right = ZY (normal +X). A sketch extrudes along its normal; a cut runs against it. circle() takes a radius, hole() a diameter. Selectors: face(\'>Z\'), edges(\'|Z\').',
].join('\n\n');

export interface ChatOptions {
  /** The Claude Code executable (default `claude`; tests give a fake). */
  claudeBin?: string;
  /** Extra leading arguments for claudeBin (tests run a fake through node). */
  claudeArgs?: string[];
  /** The MCP server config handed to claude: how it starts this server's stdio shim. */
  mcpServer: { command: string; args: string[]; env?: Record<string, string> };
  env?: NodeJS.ProcessEnv;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ChatRequest { text: string; model: string; resume?: string | null }

/** The fixed argument list. Only `model` (one of three aliases) and `resume` (a UUID) vary, and both are checked. */
export function chatArgs(req: { model: string; resume?: string | null }, mcp: ChatOptions['mcpServer']): string[] {
  const allowed = CHAT_TOOLS.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', req.model,
    '--tools', '',                                   // no built-in tools at all (no Bash, no files)
    '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: mcp.command, args: mcp.args, ...(mcp.env ? { env: mcp.env } : {}) } } }),
    '--allowedTools', allowed.join(','),
    '--permission-mode', 'dontAsk',                  // anything not allowed above is refused, never asked about
    '--setting-sources', 'project',                  // not the user's hooks or rules; the working folder is empty
    '--settings', JSON.stringify({ disableAllHooks: true }),   // plugin and user hooks (they still run with project-only sources) stay out of the chat
    '--disable-slash-commands',
    '--max-turns', String(MAX_CHAT_TURNS),
    '--append-system-prompt', SYSTEM,
    ...(req.resume ? ['--resume', req.resume] : []),
  ];
}

export function validateChat(b: unknown): { ok: true; req: ChatRequest } | { ok: false; message: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  if (typeof o.text !== 'string' || !o.text.trim()) return { ok: false, message: 'text must be a non-empty string' };
  if (o.text.length > MAX_PROMPT_CHARS) return { ok: false, message: `text is longer than ${MAX_PROMPT_CHARS} characters` };
  const model = o.model === undefined ? DEFAULT_CHAT_MODEL : o.model;
  if (!(CHAT_MODELS as readonly unknown[]).includes(model)) return { ok: false, message: `model must be one of ${CHAT_MODELS.join(', ')}` };
  if (o.resume !== undefined && o.resume !== null && !(typeof o.resume === 'string' && UUID.test(o.resume))) return { ok: false, message: 'resume must be a session id from an earlier reply' };
  return { ok: true, req: { text: o.text, model: model as string, resume: (o.resume as string | null | undefined) ?? null } };
}

const classify = (text: string): ChatErrorCode =>
  /not logged in|please run \/login|invalid api key|authentication|oauth|credential|unauthori[sz]ed/i.test(text) ? 'not_logged_in'
  : /rate.?limit|usage limit|too many requests|\b429\b/i.test(text) ? 'rate_limit'
  : /overloaded|\b529\b/i.test(text) ? 'overloaded' : 'failed';
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '...' : s).replace(/\s+/g, ' ').trim();
const bare = (name: string) => name.replace(new RegExp(`^mcp__${MCP_SERVER_NAME}__`), '');

/** Turns the process's stream-json lines into our events. Stateful per run (it knows whether text already streamed). */
export function eventMapper(): (line: string) => ChatEventOut[] {
  let streamed = false;
  return (line) => {
    let m: any;
    try { m = JSON.parse(line); } catch { return []; }
    const out: ChatEventOut[] = [];
    switch (m?.type) {
      case 'system': if (m.subtype === 'init' && typeof m.session_id === 'string') out.push({ type: 'session', id: m.session_id }); break;
      case 'stream_event': {
        const d = m.event?.type === 'content_block_delta' ? m.event.delta : null;
        if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text) { streamed = true; out.push({ type: 'text', delta: d.text }); }
        break;
      }
      case 'assistant':
        for (const b of m.message?.content ?? []) {
          if (b.type === 'tool_use') out.push({ type: 'tool', id: String(b.id), name: bare(String(b.name)) });
          else if (b.type === 'text' && !streamed && b.text) out.push({ type: 'text', delta: String(b.text) });
        }
        streamed = false;
        break;
      case 'user':
        for (const b of Array.isArray(m.message?.content) ? m.message.content : []) if (b.type === 'tool_result') out.push({ type: 'tool_result', id: String(b.tool_use_id), ok: !b.is_error });
        break;
      case 'result':
        if (!m.is_error && m.subtype === 'success') out.push({ type: 'done' });
        else if (m.subtype === 'error_max_turns') out.push({ type: 'error', code: 'cap' });
        else out.push({ type: 'error', code: classify(String(m.result ?? '')), detail: clip(String(m.result ?? m.subtype ?? '')) });
        break;
    }
    return out;
  };
}

export class ChatRunner {
  private cwd: string | null = null;
  private current: ChildProcess | null = null;
  constructor(private readonly o: ChatOptions) {}
  get busy(): boolean { return !!this.current; }

  /** Run one turn; `emit` gets each event, `signal` (the page went away or pressed Stop) kills the process. Always resolves. */
  run(req: ChatRequest, emit: (e: ChatEventOut) => void, signal: AbortSignal): Promise<void> {
    if (this.current) { emit({ type: 'error', code: 'busy' }); return Promise.resolve(); }
    this.cwd ??= mkdtempSync(join(tmpdir(), 'ck-chat-'));
    return new Promise((resolve) => {
      let child: ChildProcess;
      let finished = false, sawFinal = false, stderr = '';
      const end = (e?: ChatEventOut) => { if (finished) return; finished = true; if (e) emit(e); this.current = null; signal.removeEventListener('abort', kill); resolve(); };
      const kill = () => {
        if (!child || child.killed) return;
        child.kill('SIGTERM');
        const t = setTimeout(() => child.kill('SIGKILL'), 2000); t.unref();
      };
      try {
        child = spawn(this.o.claudeBin ?? 'claude', [...(this.o.claudeArgs ?? []), ...chatArgs(req, this.o.mcpServer)], { cwd: this.cwd!, env: this.o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      } catch { return end({ type: 'error', code: 'claude_missing' }); }
      this.current = child;
      signal.addEventListener('abort', kill, { once: true });
      if (signal.aborted) kill();
      const map = eventMapper();
      let buf = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          for (const e of map(line)) { if (e.type === 'done' || e.type === 'error') sawFinal = true; if (!signal.aborted) emit(e); }
        }
      });
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (c: string) => { stderr = (stderr + c).slice(-2000); });
      child.on('error', (err: NodeJS.ErrnoException) => end(err.code === 'ENOENT' ? { type: 'error', code: 'claude_missing' } : { type: 'error', code: 'failed', detail: clip(err.message) }));
      child.on('close', (code) => {
        if (signal.aborted || sawFinal) return end();
        end({ type: 'error', code: classify(stderr), detail: clip(stderr) || `claude exited with code ${code}` });
      });
      child.stdin!.on('error', () => { /* it exited before reading */ });
      child.stdin!.end(req.text);
    });
  }

  close(): void {
    this.current?.kill('SIGKILL');
    if (this.cwd) { try { rmSync(this.cwd, { recursive: true, force: true }); } catch { /* gone */ } this.cwd = null; }
  }
}
