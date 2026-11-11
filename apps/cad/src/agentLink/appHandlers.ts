// What the app does when a linked agent asks (docs/agent-bridge.md). Pure over a small `deps` object, so the rules (what is exposed,
// what is refused, what a result looks like) are tested without the app. The wiring to the controller is in `link.ts`.
import { BridgeError, type BridgeOp } from '@kit/agent-link';

export interface AppDoc { name?: string; features?: Array<Record<string, unknown>>; variables?: Array<{ name: string; expr: string }> }
export interface RunReport { ok: boolean; errors: Array<{ line: number; message: string }>; created: string[]; featureCount: number }

export interface AppDeps {
  document(): AppDoc | null;
  selection(): string[];
  facts(): { faces: number; triangles: number; rebuildMs: number | null };
  status(): Array<{ id: string; ok: boolean; code?: string; hint?: string }>;
  hasSolid(): boolean;
  /** A PNG of the open part from `view` at `size` px, or null when there is nothing to draw. */
  render(view: string, size: number): Promise<Uint8Array | null>;
  /** Attach mode, one undo step. */
  runScript(code: string): Promise<RunReport>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The user's permission, read again for every edit. */
  allowEdit(): boolean;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const NO_EDIT = () => new BridgeError('edit_not_allowed', 'the user has not allowed the agent to change this document', 'ask the user to tick "Allow the agent to change this document" in Settings, Agent link');

export function makeAppHandler(d: AppDeps): (op: BridgeOp, args: Record<string, unknown>) => Promise<unknown> {
  return async (op, args) => {
    switch (op) {
      case 'state': {
        const doc = d.document();
        if (!doc) return { open: false, hint: 'no document is open in the app' };
        const bad = new Map(d.status().filter((s) => !s.ok).map((s) => [s.id, s]));
        const features = (doc.features ?? []).map((f) => ({
          id: String(f.id), type: String(f.type), ...(f.name ? { name: String(f.name) } : {}), ...(f.suppressed ? { suppressed: true } : {}),
          ...(bad.get(String(f.id)) ? { error: { code: bad.get(String(f.id))!.code, ...(bad.get(String(f.id))!.hint ? { hint: bad.get(String(f.id))!.hint } : {}) } } : {}),
        }));
        return {
          open: true, name: doc.name ?? null, featureCount: features.length, features,
          variables: (doc.variables ?? []).map((v) => ({ name: v.name, expr: v.expr })),
          selection: d.selection(), hasSolid: d.hasSolid(), ...d.facts(),
          ...(args.detail === 'full' ? { document: doc } : {}),
        };
      }
      case 'screenshot': {
        if (!d.document() || !d.hasSolid()) throw new BridgeError('no_body', 'the open document has no solid to draw', 'build something first, or ask the user to');
        const view = typeof args.view === 'string' ? args.view : 'iso';
        const size = typeof args.size === 'number' ? Math.max(64, Math.min(1536, Math.round(args.size))) : 768;
        const png = await d.render(view, size);
        if (!png) throw new BridgeError('snapshot_failed', 'the app could not draw the model', 'try another view or a smaller size');
        return { png: toBase64(png), view, size, bytes: png.length };
      }
      case 'run_script': {
        if (!d.allowEdit()) throw NO_EDIT();
        if (typeof args.code !== 'string' || !args.code.trim()) throw new BridgeError('bad_input', 'code must be a non-empty string');
        if (!d.document()) throw new BridgeError('no_document', 'no document is open in the app', 'ask the user to open or start a part first');
        return await d.runScript(args.code);
      }
      case 'undo': case 'redo': {
        if (!d.allowEdit()) throw NO_EDIT();
        await (op === 'undo' ? d.undo() : d.redo());
        return { done: op };
      }
      default: throw new BridgeError('unknown_op', `the app does not know ${String(op)}`);
    }
  };
}
