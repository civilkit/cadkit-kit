import { describe, expect, it } from 'vitest';
import { Bridge, BridgeError, CODE_ALPHABET, formatCode, parseCode, randomCode, MAX_BAD_CODES } from './index';

const mk = (over: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) => {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const b = new Bridge({ port: () => 51234, now: clock.now, pollMs: 50, requestTimeoutMs: 200, codeTtlMs: 1000, connectedMs: 500, ...over });
  return { b, clock };
};
const pair = (b: Bridge, edit = false) => {
  const { code } = b.newCode();
  return b.hello(parseCode(code)!.code, { name: 'CadKit', version: '1' }, edit).session;
};
const code = (e: unknown) => (e as BridgeError).code;

describe('pairing codes', () => {
  it('are 16 characters from an alphabet without look-alikes, and carry the port', () => {
    const c = randomCode();
    expect(c).toHaveLength(16);
    expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    const f = formatCode(51234, c);
    expect(f).toMatch(/^51234-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(parseCode(f)).toEqual({ port: 51234, code: c });
  });
  it('parse forgivingly and refuse nonsense', () => {
    const c = randomCode();
    expect(parseCode(`  51234 ${c.slice(0, 8).toLowerCase()} ${c.slice(8)} `)?.code).toBe(c);
    expect(parseCode('hello')).toBeNull();
    expect(parseCode('80-' + c)).toBeNull();               // a privileged port is never ours
    expect(parseCode('51234-ABCD')).toBeNull();
    expect(parseCode('51234-' + 'I'.repeat(16))).toBeNull();
  });
});

describe('the opt-in gate', () => {
  it('nothing is linked until the user presents a code; an agent request then fails with how to start', () => {
    const { b } = mk();
    expect(b.status().connected).toBe(false);
    expect(() => b.request('state')).toThrowError(/no app is linked/);
    try { b.request('state'); } catch (e) { expect(code(e)).toBe('app_not_connected'); expect((e as BridgeError).hint).toMatch(/bridge_pair/); }
  });
  it('the code works once, and not after it expires', () => {
    const { b, clock } = mk();
    const { code: c } = b.newCode();
    const raw = parseCode(c)!.code;
    b.hello(raw, { name: 'CadKit' }, false);
    expect(() => b.hello(raw, { name: 'CadKit' }, false)).toThrowError(/no pairing code/);
    const { code: c2 } = b.newCode();
    clock.advance(1001);
    try { b.hello(parseCode(c2)!.code, { name: 'CadKit' }, false); expect.unreachable(); } catch (e) { expect(code(e)).toBe('code_expired'); }
  });
  it('wrong codes are counted and revoke the code', () => {
    const { b } = mk();
    const { code: c } = b.newCode();
    for (let i = 0; i < MAX_BAD_CODES; i++) { try { b.hello('A'.repeat(16), { name: 'x' }, false); } catch (e) { expect(code(e)).toBe('bad_code'); } }
    expect(() => b.hello(parseCode(c)!.code, { name: 'x' }, false)).toThrowError(/no pairing code/);   // even the right one is dead now
    expect(b.status().pairing.open).toBe(false);
  });
  it('a new code ends the current session', async () => {
    const { b } = mk();
    const s = pair(b);
    expect(b.isSession(s)).toBe(true);
    b.newCode();
    expect(b.isSession(s)).toBe(false);
    expect(b.status().connected).toBe(false);
  });
});

describe('requests', () => {
  it('reach the app through a poll and come back through reply', async () => {
    const { b } = mk();
    const s = pair(b);
    const pending = b.request('state', { detail: 'summary' });
    const reqs = await b.poll(s, false);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ op: 'state', args: { detail: 'summary' } });
    expect(b.reply(s, { id: reqs[0].id, ok: true, result: { name: 'Plate' } })).toBe(true);
    await expect(pending).resolves.toEqual({ name: 'Plate' });
  });
  it('a poll waiting for work wakes at once when a request arrives', async () => {
    const { b } = mk({ pollMs: 10_000 });
    const s = pair(b);
    const p = b.poll(s, false);
    const r = b.request('screenshot');
    const got = await p;
    expect(got[0].op).toBe('screenshot');
    b.reply(s, { id: got[0].id, ok: true, result: {} });
    await r;
  });
  it('edits are refused while the user has not allowed them, and allowed once the app says so', async () => {
    const { b } = mk();
    const s = pair(b, false);
    for (const op of ['run_script', 'undo', 'redo'] as const) {
      try { b.request(op, {}); expect.unreachable(); } catch (e) { expect(code(e)).toBe('edit_not_allowed'); }
    }
    const reading = b.request('state');                    // reading is fine
    reading.catch(() => {});
    await b.poll(s, true);                                 // the app now reports the box ticked
    expect(b.status().edit).toBe(true);
    const p = b.request('run_script', { code: 'x' });
    const [q] = await b.poll(s, true);
    b.reply(s, { id: q.id, ok: true, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });
  it('an app error comes back with its code and hint', async () => {
    const { b } = mk();
    const s = pair(b);
    const p = b.request('screenshot');
    const [q] = await b.poll(s, false);
    b.reply(s, { id: q.id, ok: false, error: { code: 'no_body', message: 'nothing to draw', hint: 'build something' } });
    await expect(p).rejects.toMatchObject({ code: 'no_body', hint: 'build something' });
  });
  it('time out when the app does not answer, and when the app goes away', async () => {
    const { b } = mk();
    const s = pair(b);
    await expect(b.request('state')).rejects.toMatchObject({ code: 'app_timeout' });
    const p = b.request('state');
    b.bye(s);
    await expect(p).rejects.toMatchObject({ code: 'app_disconnected' });
    expect(b.status().connected).toBe(false);
  });
  it('count as disconnected when the app stops polling', () => {
    const { b, clock } = mk();
    pair(b);
    expect(b.status().connected).toBe(true);
    clock.advance(501);
    expect(b.status().connected).toBe(false);
    expect(() => b.request('state')).toThrowError(/no app is linked/);
  });
  it('a reply for a request that is not outstanding is ignored; a stale session is refused', async () => {
    const { b } = mk();
    const s = pair(b);
    expect(b.reply(s, { id: 'r99', ok: true })).toBe(false);
    expect(() => b.reply('nope', { id: 'r1', ok: true })).toThrowError(/no such session/);
    await expect(b.poll('nope', false)).rejects.toMatchObject({ code: 'no_session' });
  });
});

describe('an aborted poll', () => {
  it('does not swallow a request that arrived meanwhile', async () => {
    const { b } = mk({ pollMs: 10_000 });
    const s = pair(b);
    const ac = new AbortController();
    const p = b.poll(s, false, ac.signal);
    ac.abort();
    const r = b.request('state');
    r.catch(() => {});
    expect(await p).toEqual([]);
    const next = await b.poll(s, false);
    expect(next).toHaveLength(1);
  });
});
