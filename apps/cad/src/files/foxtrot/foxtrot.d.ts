/* tslint:disable */
/* eslint-disable */

/**
 * What the CivilKit preview needs: the mesh in the file's own units (no recentring or rescaling), one triangle per
 * 9 floats (`positions`, `normals`), and how many faces could not be meshed.
 */
export class Preview {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * One entry per placed solid: its name, its product path (root first, names joined by U+001F) and its triangle range `[start, end)`.
     */
    readonly body_names: string[];
    readonly body_paths: string[];
    readonly body_tris: Uint32Array;
    readonly errors: number;
    readonly faces: number;
    readonly normals: Float32Array;
    readonly panics: number;
    readonly positions: Float32Array;
    readonly shells: number;
}

/**
 * The face being meshed: after a trap, the one to `skip_face` on the next run.
 */
export function current_face(): number;

export function init_log(): void;

export function skip_face(id: number): void;

export function step_to_preview(data: Uint8Array | number[]): Preview;

export function step_to_triangle_buf(data: string): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preview_free: (a: number, b: number) => void;
    readonly current_face: () => number;
    readonly init_log: () => void;
    readonly preview_body_names: (a: number) => [number, number];
    readonly preview_body_paths: (a: number) => [number, number];
    readonly preview_body_tris: (a: number) => [number, number];
    readonly preview_errors: (a: number) => number;
    readonly preview_faces: (a: number) => number;
    readonly preview_normals: (a: number) => [number, number];
    readonly preview_panics: (a: number) => number;
    readonly preview_positions: (a: number) => [number, number];
    readonly preview_shells: (a: number) => number;
    readonly skip_face: (a: number) => void;
    readonly step_to_preview: (a: number, b: number) => number;
    readonly step_to_triangle_buf: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
