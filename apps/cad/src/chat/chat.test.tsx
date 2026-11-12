import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { signal } from '@preact/signals-core';
import type { LinkState } from '@kit/agent-link';
import '../i18n';
import { ChatPanel, pairCommand, type ChatLink } from './ChatPanel';
import { contextText, createChatSession } from './chatSession';
import { claudeCodeProvider } from './claudeCode';
import { ChatError, type ChatEvent, type ChatProvider, type ChatTurn } from './types';

afterEach(cleanup);

/** A fake provider: plays the events a test gives it. No service, no network. */
function fake(play: (turn: ChatTurn, emit: (e: ChatEvent) => void) => Promise<void> | void): ChatProvider & { turns: ChatTurn[] } {
  const turns: ChatTurn[] = [];
  return { id: 'fake', models: ['sonnet', 'opus', 'haiku'], turns, async send(turn, emit) { turns.push(turn); await play(turn, emit); } };
}
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const session = (p: ChatProvider, ctx = { selection: [] as string[], script: '' }) => createChatSession({ provider: p, context: () => ctx, storage: mem() });
const link = (connected = true, allow = false): ChatLink & { calls: string[] } => {
  const calls: string[] = [];
  const state = signal<LinkState>(connected ? { state: 'connected', since: 0, calls: 0 } : { state: 'off' });
  const allowEdit = signal(allow);
  return { calls, state, allowEdit, connect: async (c) => { calls.push(c); state.value = { state: 'connected', since: 0, calls: 0 }; }, setAllowEdit: (v) => { allowEdit.value = v; calls.push('edit:' + v); } };
};

describe('chat session', () => {
  it('streams text, shows tool steps, and keeps the session id for the next message', async () => {
    const p = fake((turn, emit) => {
      emit({ type: 'session', id: 'S1' }); emit({ type: 'text', delta: 'Making ' }); emit({ type: 'text', delta: 'it.' });
      emit({ type: 'tool', id: 'a', name: 'app_run_script' }); emit({ type: 'tool_result', id: 'a', ok: true });
      emit({ type: 'text', delta: 'Done.' }); emit({ type: 'done' });
    });
    const s = session(p);
    await s.send('make a plate');
    expect(s.items.value.map((i) => i.kind === 'tool' ? `tool:${i.name}:${i.state}` : `${i.kind}:${(i as { text: string }).text}`)).toEqual(['user:make a plate', 'assistant:Making it.', 'tool:app_run_script:ok', 'assistant:Done.']);
    expect(s.busy.value).toBe(false);
    await s.send('again');
    expect(p.turns[0].resume).toBeNull();
    expect(p.turns[1].resume).toBe('S1');
    s.newChat();
    expect(s.items.value).toEqual([]);
    await s.send('fresh');
    expect(p.turns[2].resume).toBeNull();
  });

  it('Stop aborts the running turn and says so; a tool left running is marked as not finished', async () => {
    const p = fake((turn, emit) => new Promise<void>((_, rej) => { emit({ type: 'tool', id: 'a', name: 'app_screenshot' }); turn.signal.addEventListener('abort', () => rej(new ChatError('aborted'))); }));
    const s = session(p);
    const run = s.send('slow');
    expect(s.busy.value).toBe(true);
    await Promise.resolve();
    s.stop();
    await run;
    expect(s.busy.value).toBe(false);
    const kinds = s.items.value.map((i) => i.kind === 'tool' ? i.state : i.kind);
    expect(kinds).toEqual(['user', 'failed', 'note']);
  });

  it('ignores a second send while busy', async () => {
    let release = () => {};
    const p = fake(() => new Promise<void>((r) => { release = r; }));
    const s = session(p);
    const a = s.send('one'); void s.send('two');
    expect(p.turns).toHaveLength(1);
    release(); await a;
  });

  it.each([
    ['not_linked', /link to the local service is off/], ['service_unreachable', /Cannot reach the local service/], ['claude_missing', /Claude Code was not found/],
    ['not_logged_in', /not signed in/], ['rate_limit', /usage limit/], ['overloaded', /busy right now/], ['cap', /limit on steps/], ['busy', /Another chat/],
  ] as const)('shows %s in plain words', async (code, re) => {
    const s = session(fake(() => { throw new ChatError(code); }));
    await s.send('x');
    const last = s.items.value.at(-1)!;
    expect(last.kind).toBe('error');
    expect((last as { text: string }).text).toMatch(re);
  });

  it('an unknown failure still says something and shows the detail', async () => {
    const s = session(fake(() => { throw new ChatError('failed', 'boom'); }));
    await s.send('x');
    expect((s.items.value.at(-1) as { text: string }).text).toMatch(/stopped with an error.*boom/);
  });

  it('the context boxes are off by default and only ticked ones are sent', async () => {
    const p = fake(() => {});
    const s = session(p, { selection: ['F2.C1', 'F2.C2'], script: "// the plate\npart('P')" });
    await s.send('plain');
    expect(p.turns[0].text).toBe('plain');
    s.setContext({ selection: true });
    await s.send('with selection');
    expect(p.turns[1].text).toContain('Selected in the app: F2.C1, F2.C2');
    expect(p.turns[1].text).not.toContain('the plate');
    s.setContext({ view: true, comments: true });
    await s.send('all');
    expect(p.turns[2].text).toContain('app_screenshot');
    expect(p.turns[2].text).toContain('// the plate');
    expect(contextText({ selection: false, view: false, comments: false }, { selection: ['x'], script: 'y' })).toBe('');
  });

  it('remembers the model and the boxes (not the conversation) and refuses a model it does not offer', () => {
    const store = mem();
    const mk = () => createChatSession({ provider: fake(() => {}), context: () => ({ selection: [], script: '' }), storage: store });
    const a = mk(); a.setModel('opus'); a.setModel('gpt-9'); a.setContext({ view: true });
    const b = mk();
    expect(b.model.value).toBe('opus');
    expect(b.context.value).toEqual({ selection: false, view: true, comments: false });
  });
});

describe('ChatPanel', () => {
  it('not linked: shows the set-up card with the command and pairing, not an error', async () => {
    const l = link(false);
    const { getByTestId, queryByTestId } = render(<ChatPanel session={session(fake(() => {}))} link={l} origin="http://localhost:5173" />);
    expect(getByTestId('chat-setup')).toBeTruthy();
    expect(getByTestId('chat-cmd').textContent).toBe('node <checkout>/packages/mcp/bin/ck-mcp.mjs --pair');
    expect(queryByTestId('chat-input')).toBeNull();
    fireEvent.input(getByTestId('chat-code'), { target: { value: '52311-ABCD-EFGH-JKMN-PQRS' } });
    fireEvent.click(getByTestId('chat-link'));
    await waitFor(() => expect(getByTestId('chat-panel')).toBeTruthy());
    expect(l.calls).toEqual(['52311-ABCD-EFGH-JKMN-PQRS']);
  });
  it('the command carries the page origin when it is not this computer', () => {
    expect(pairCommand('https://civilkit.io')).toBe('node <checkout>/packages/mcp/bin/ck-mcp.mjs --pair --allow-origin https://civilkit.io');
  });

  it('sends with the button, shows the reply, and Send turns into Stop while it runs', async () => {
    let release = () => {};
    const p = fake(async (_t, emit) => { emit({ type: 'text', delta: 'Hello there' }); await new Promise<void>((r) => { release = r; }); });
    const { getByTestId, queryByTestId } = render(<ChatPanel session={session(p)} link={link()} />);
    fireEvent.input(getByTestId('chat-input'), { target: { value: 'hi' } });
    fireEvent.click(getByTestId('chat-send'));
    await waitFor(() => expect(getByTestId('chat-stop')).toBeTruthy());
    expect(getByTestId('chat-log').textContent).toContain('Hello there');
    expect(getByTestId('chat-log').textContent).toContain('hi');
    expect(queryByTestId('chat-send')).toBeNull();
    release();
    await waitFor(() => expect(getByTestId('chat-send')).toBeTruthy());
  });

  it('Stop in the panel aborts the turn', async () => {
    let aborted = false;
    const p = fake((turn) => new Promise<void>((_, rej) => turn.signal.addEventListener('abort', () => { aborted = true; rej(new ChatError('aborted')); })));
    const { getByTestId } = render(<ChatPanel session={session(p)} link={link()} />);
    fireEvent.input(getByTestId('chat-input'), { target: { value: 'go' } });
    fireEvent.click(getByTestId('chat-send'));
    await waitFor(() => getByTestId('chat-stop'));
    fireEvent.click(getByTestId('chat-stop'));
    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() => expect(getByTestId('chat-log').textContent).toContain('Stopped.'));
  });

  it('shows the edit permission clearly and changes it through the link', () => {
    const l = link(true, false);
    const { getByTestId, container } = render(<ChatPanel session={session(fake(() => {}))} link={l} />);
    expect(container.textContent).toContain('but not change it');
    fireEvent.click(getByTestId('chat-allow-edit'));
    expect(l.calls).toEqual(['edit:true']);
  });

  it('an error from the provider shows as an alert in the log', async () => {
    const { getByTestId, findByRole } = render(<ChatPanel session={session(fake(() => { throw new ChatError('not_logged_in'); }))} link={link()} />);
    fireEvent.input(getByTestId('chat-input'), { target: { value: 'go' } });
    fireEvent.click(getByTestId('chat-send'));
    expect((await findByRole('alert')).textContent).toMatch(/not signed in/);
  });

  it('states what is sent and that no key is entered', () => {
    const { container } = render(<ChatPanel session={session(fake(() => {}))} link={link()} />);
    expect(container.textContent).toMatch(/What is sent/);
    expect(container.textContent).toMatch(/No key is entered here/);
  });
});

describe('claude code provider (against a fake fetch)', () => {
  const stream = (lines: string[], status = 200) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l + '\n')); c.close(); } }), { status });
  const turn = (signal = new AbortController().signal): ChatTurn => ({ text: 'hi', model: 'sonnet', resume: null, signal });
  const ep = () => ({ port: 5555, session: 'tok' });

  it('posts to the paired service with the session token and relays events', async () => {
    const f = vi.fn(async () => stream([JSON.stringify({ type: 'session', id: 'S' }), JSON.stringify({ type: 'text', delta: 'a' }), JSON.stringify({ type: 'done' })]));
    const ev: ChatEvent[] = [];
    await claudeCodeProvider({ endpoint: ep, fetch: f as never }).send(turn(), (e) => ev.push(e));
    expect(ev.map((e) => e.type)).toEqual(['session', 'text', 'done']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:5555/bridge/chat');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hi', model: 'sonnet' });
  });
  it('maps the failures: not linked, unreachable, error events, a cut stream, HTTP errors', async () => {
    const code = async (f: unknown, e: typeof ep | (() => null) = ep) => claudeCodeProvider({ endpoint: e as never, fetch: f as never }).send(turn(), () => {}).then(() => 'ok', (x) => (x as ChatError).code);
    expect(await code(async () => stream([]), () => null)).toBe('not_linked');
    expect(await code(async () => { throw new TypeError('fetch failed'); })).toBe('service_unreachable');
    expect(await code(async () => stream([JSON.stringify({ type: 'error', code: 'not_logged_in' })]))).toBe('not_logged_in');
    expect(await code(async () => stream([JSON.stringify({ type: 'error', code: 'weird' })]))).toBe('failed');
    expect(await code(async () => stream([JSON.stringify({ type: 'text', delta: 'x' })]))).toBe('service_unreachable');
    expect(await code(async () => stream([], 401))).toBe('not_linked');
    expect(await code(async () => stream([], 500))).toBe('failed');
  });
  it('an aborted request is reported as aborted', async () => {
    const ac = new AbortController(); ac.abort();
    const err = await claudeCodeProvider({ endpoint: ep, fetch: (async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }) as never }).send(turn(ac.signal), () => {}).catch((e) => e);
    expect(err.code).toBe('aborted');
  });
});
