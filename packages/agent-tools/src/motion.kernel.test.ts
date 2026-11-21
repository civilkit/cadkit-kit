// The motion tools on the real kernel: a hinged door with a swing limit, and a pin in a slot. Exact numbers, plain words.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentSession, callTool, createTools } from './index';
import { placeholderSnapshot } from './testing/placeholder-snapshot';

const WASM = process.env.CK_WASM;
const tools = createTools();
let a: AgentSession;
beforeAll(async () => { a = await AgentSession.open({ wasmPath: WASM, snapshotFn: placeholderSnapshot as never }); }, 60000);
afterAll(async () => { await a.close(); });

const call = async (name: string, args: unknown = {}) => {
  const r = await callTool(a, tools, name, args);
  const text = r.content.find((c) => c.type === 'text' && c.text.trim().startsWith('{')) as { text: string } | undefined;
  return { r, json: text ? JSON.parse(text.text) : null };
};

describe('motion tools on the real kernel', () => {
  it('lists them', () => {
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['motion_list', 'motion_drive', 'motion_sweep', 'motion_study_run']));
  });

  it('a hinge door: list, drive, sweep to the swing limit, run a study', async () => {
    const doc = JSON.parse(readFileSync(resolve(process.cwd(), 'apps/cad/public/samples/assembly-hinge-door.ckpart'), 'utf8'));
    doc.motion = { version: 1, drivers: [{ mate: 'F3', min: 0, max: 110, value: 0 }], studies: [{ id: 's1', name: 'Open', duration: 2, loop: 'once', clearance: 0, tracks: [{ driver: 'F3', keys: [{ t: 0, v: 0 }, { t: 2, v: 100, ease: 'inOut' }] }] }] };
    await a.setDocument(doc, 'door');
    const list = (await call('motion_list')).json;
    expect(list.drivers).toHaveLength(1);
    expect(list.drivers[0]).toMatchObject({ mate: 'F3', unit: 'deg', kind: 'angle', range: { min: 0, max: 110 } });
    expect(list.studies[0]).toMatchObject({ id: 's1', keys: 2 });

    const drive = (await call('motion_drive', { values: { F3: 90 } })).json;
    expect(drive.ok).toBe(true);
    expect(drive.contact).toBeNull();
    const door = drive.moved.find((m: { id: string }) => m.id === 'F2');
    expect(door.turned_deg).toBeCloseTo(90, 3);
    expect(drive.moved.some((m: { id: string }) => m.id === 'F1')).toBe(false);

    const sweep = (await call('motion_sweep', { driver: 'F3', to: 180 })).json;
    expect(sweep.stop.reason).toBe('limit');
    expect(sweep.stop.bound_value).toBe(110);
    expect(sweep.reached).toBeGreaterThan(109.98);
    expect(sweep.reached).toBeLessThanOrEqual(110);
    expect(sweep.words).toContain('Swing limit');

    const run = (await call('motion_study_run', { study: 's1' })).json;
    expect(run.ok).toBe(true);
    expect(run.keyframes.map((k: { t: number }) => k.t)).toEqual([0, 2]);
    expect(run.words).toContain('runs clear');
    // an inline study that goes past the swing limit: the mates cannot hold
    const past = (await call('motion_study_run', { study: { duration: 2, tracks: [{ driver: 'F3', keys: [{ t: 0, v: 0 }, { t: 2, v: 150 }] }] } })).json;
    expect(past.ok).toBe(false);
    expect(past.issue.kind).toBe('solver');
    expect(past.issue.time).toBeGreaterThan(1.4);
  }, 120000);

  it('refuses an unknown driver with the ones that exist', async () => {
    const { r } = await call('motion_drive', { values: { Nope: 1 } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('F3');
  }, 60000);
});
