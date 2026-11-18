import { describe, it, expect } from 'vitest';
import { PluginRegistry } from './registry';
import { scriptGenerator } from './script';
import { contextOf } from './registry';
import { checkDefs, checkParams, defaultsOf, formModel, toJsonSchema, type ParamDef } from './params';

const body = (name: string) => ({ type: 'body', name });
const face = (b: string, i = 0) => ({ type: 'face', body: b, index: i });
const defs = (...d: Partial<ParamDef>[]): ParamDef[] => d.map((x) => ({ name: 'pick', type: 'selection', accept: ['body'], ...x }) as ParamDef);

describe('selection parameters', () => {
  it('count picks against minItems and maxItems, and a required field starts empty', () => {
    const d = defs({ minItems: 1, maxItems: 2 });
    expect(defaultsOf(d)).toEqual({ pick: [] });
    expect(checkParams(d, {}).issues).toEqual([{ param: 'pick', message: 'pick at least one' }]);
    expect(checkParams(d, { pick: [body('A')] }).ok).toBe(true);
    expect(checkParams(d, { pick: [body('A'), body('B'), body('C')] }).issues[0].message).toBe('pick at most 2');
    expect(checkParams(defs({ maxItems: 1 }), { pick: [body('A'), body('B')] }).issues[0].message).toBe('pick only one');
  });
  it('a required field with no minimum accepts nothing picked; an optional one is left out', () => {
    expect(checkParams(defs({}), {})).toMatchObject({ ok: true, values: { pick: [] } });
    const opt = checkParams(defs({ optional: true }), {});
    expect(opt.ok).toBe(true); expect(opt.values).toEqual({});
  });
  it('only takes what it accepts', () => {
    const d = defs({ accept: ['face'] });
    expect(checkParams(d, { pick: [face('A')] }).ok).toBe(true);
    expect(checkParams(d, { pick: [body('A')] }).issues[0].message).toMatch(/one of: face/);
    expect(checkParams(d, { pick: ['A'] }).ok).toBe(false);
    expect(checkParams(defs({ asNames: true }), { pick: ['A', 'B'] }).ok).toBe(true);
    expect(checkParams(defs({ asNames: true }), { pick: [body('A')] }).ok).toBe(false);
    expect(checkParams(d, { pick: 'A' }).issues[0].message).toMatch(/list of picks/);
  });
  it('refuses a definition that makes no sense', () => {
    expect(checkDefs(defs({ accept: [] }))).toEqual([expect.stringMatching(/needs accept/)]);
    expect(checkDefs(defs({ minItems: 3, maxItems: 1 }))).toEqual([expect.stringMatching(/minItems is more than maxItems/)]);
    expect(checkDefs(defs({ asNames: true, accept: ['face'] }))).toEqual([expect.stringMatching(/asNames is for a field that takes bodies only/)]);
    expect(checkDefs([{ name: 'n', type: 'number', accept: ['body'] }])).toEqual([expect.stringMatching(/are for a selection/)]);
    expect(checkDefs(defs({ minItems: 1 }))).toEqual([]);
  });
  it('the agent tool and the form describe it', () => {
    const j = toJsonSchema(defs({ minItems: 1, maxItems: 1 }));
    expect(j.properties!.pick).toMatchObject({ type: 'array', minItems: 1, maxItems: 1, items: { type: 'object' } });
    expect(toJsonSchema(defs({ asNames: true })).properties!.pick).toMatchObject({ items: { type: 'string' } });
    expect(formModel(defs({ minItems: 1 }), {})[0].fields[0].error).toBe('is required');
    expect(formModel(defs({ minItems: 1 }), { pick: [] })[0].fields[0].error).toBe('pick at least one');
  });

  it('the picks reach a plugin script as params, and a missing required pick stops the run', async () => {
    const reg = new PluginRegistry();
    reg.add({ id: 'test.mark', name: 'Mark', version: '1.0.0', contributes: { generators: [{ id: 'mark', title: 'Mark', script: 'x.js', params: defs({ minItems: 1, maxItems: 1 }) }] } },
      { mark: scriptGenerator("part(uniqueName('M')).sketch('front', (s) => s.rect(10 + 10 * params.pick.length, 20)).extrude(5);") });
    const ok = await reg.prepare('test.mark', 'mark', { pick: [body('A')] }, contextOf([]));
    expect(ok.ok && ok.script).toContain('"pick":[{"type":"body","name":"A"}]');
    expect(ok.ok && ok.script).toContain('params.pick.length');
    const none = await reg.prepare('test.mark', 'mark', { pick: [] }, contextOf([]));
    expect(none.ok).toBe(false);
    expect(!none.ok && none.issues[0].message).toBe('pick at least one');
  });
});
