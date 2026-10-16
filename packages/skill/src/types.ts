export interface ParamProp { name: string; type: string; optional: boolean; description: string }
export interface ParamDoc { name: string; type: string; optional: boolean; default?: string; description: string; properties?: ParamProp[] }
/** One registered method of the script API (generated from the JSDoc of packages/script). */
export interface MethodDoc {
  /** `part.extrude`, `sketch.rect`, `part.holes.polar`, or the bare name of a global function (`face`, `edges`, `variables`). */
  id: string;
  kind: 'method' | 'function';
  domain: string;
  /** How it is called in a script, e.g. `.extrude(depth: Num, o: ExtrudeOpts = {}): this` (part), `s.rect(w: Num, ...)` (sketch builder), `face(sel: string): FaceSel`. */
  signature: string;
  summary: string;
  description: string;
  parameters: ParamDoc[];
  returns?: string;
  example: string;
  /** ids of related methods */
  related: string[];
  /** hand-written pitfalls (packages/skill/notes/<id>.md), when present */
  notes?: string;
}
export interface Registry { version: number; source: string; domains: string[]; types: Record<string, string>; methods: MethodDoc[] }
export interface IndexEntry { id: string; domain: string; summary: string }
export interface DocsResult {
  entries: MethodDoc[];
  /** names that matched nothing, with close ids */
  unknown: Array<{ name: string; didYouMean: string[] }>;
  /** type aliases used by the returned signatures (Num, Pt, ...) */
  types: Record<string, string>;
}
export interface Recipe {
  id: string;
  title: string;
  /** words a person would use for this task, searched with weight 2 */
  intent: string[];
  /** what the recipe teaches (one or two sentences) */
  description: string;
  /** `script`: run by packages/script runScript. `features`: JavaScript that returns a raw feature list (no script helper exists for it yet). `guide`: text, not executed. */
  kind: 'script' | 'features' | 'guide';
  code: string;
  /** what the executed recipe must produce; absent for guides */
  expected?: { volume: number; volumeTol: number; features: number; valid: true; notes?: string };
  /** a gap in the script API this recipe had to work around */
  gap?: string;
}
export interface SearchHit { id: string; score: number; summary: string; domain?: string }
export interface SearchResult { methods: SearchHit[]; recipes: SearchHit[] }
