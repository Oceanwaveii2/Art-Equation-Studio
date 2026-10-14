/* tslint:disable */
/* eslint-disable */

export class B3Renderer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Harness-only device-loss simulation. Production recovery uses the same
     * state transition after wgpu reports a genuinely lost device.
     */
    destroy_device_for_recovery_test(): void;
    /**
     * Request the browser WebGPU device and compile Vello's area-AA pipelines once.
     */
    initialize(): Promise<string>;
    constructor();
    /**
     * Encode and execute a deterministic Vello Classic/WebGPU vector frame.
     */
    render(width: number, height: number, path_count: number): Promise<void>;
    render_overlap_fixture(width: number, height: number): Promise<string>;
    /**
     * Render the sanitized copy of a real saved board. The source workspace is
     * never opened or mutated by this harness.
     */
    render_real_board(width: number, height: number): Promise<string>;
    /**
     * Render the real-board fixture and read the actual GPU texture back as
     * tightly packed RGBA8 pixels for browser-canvas presentation proof.
     */
    render_real_board_pixels(width: number, height: number): Promise<Uint8Array>;
    /**
     * Replay the frozen SceneSnapshotV1 fixture, encode it through the shared
     * scene seam, and execute the resulting Vello scene on the warmed device.
     */
    render_replay(width: number, height: number): Promise<string>;
    /**
     * Render an arbitrary SceneSnapshotV1 JSON value through the same seam.
     * This is intentionally JSON at the harness boundary so production board
     * adapters can be exercised without coupling the renderer to React state.
     */
    render_snapshot(width: number, height: number, snapshot_json: string): Promise<string>;
    /**
     * Production seam: render caller-owned scene data through the persistent
     * device with the live canvas viewport applied to the complete scene.
     */
    render_snapshot_pixels(width: number, height: number, snapshot_json: string, scale: number, pan_x: number, pan_y: number): Promise<Uint8Array>;
    render_workload(width: number, height: number, path_count: number, scale: number, pan_x: number, pan_y: number, edit_index: number, edit_delta: number): Promise<void>;
}

export function project_b_preflight(): string;

/**
 * M3/B1's deliberately isolated CPU renderer workload.
 *
 * The returned RGBA buffer is consumed only by the standalone benchmark worker;
 * no production canvas state, tools, or compositor are involved.
 */
export function render_b1_fixture(width: number, height: number, path_count: number): Uint8Array;

/**
 * Render the same deterministic scene under viewport and single-object edit changes.
 * This gives M3 repeatable zoom, pan, resize, and live-preview round-trip inputs.
 */
export function render_b1_workload(width: number, height: number, path_count: number, scale: number, pan_x: number, pan_y: number, edit_index: number, edit_delta: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_b3renderer_free: (a: number, b: number) => void;
    readonly b3renderer_destroy_device_for_recovery_test: (a: number) => void;
    readonly b3renderer_initialize: (a: number) => any;
    readonly b3renderer_new: () => number;
    readonly b3renderer_render: (a: number, b: number, c: number, d: number) => any;
    readonly b3renderer_render_overlap_fixture: (a: number, b: number, c: number) => any;
    readonly b3renderer_render_real_board: (a: number, b: number, c: number) => any;
    readonly b3renderer_render_real_board_pixels: (a: number, b: number, c: number) => any;
    readonly b3renderer_render_replay: (a: number, b: number, c: number) => any;
    readonly b3renderer_render_snapshot: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly b3renderer_render_snapshot_pixels: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly b3renderer_render_workload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly project_b_preflight: () => [number, number, number, number];
    readonly render_b1_fixture: (a: number, b: number, c: number) => [number, number];
    readonly render_b1_workload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_bindgen_641f96222e64b03b___closure__destroy___dyn_core_f0fd674eaa06beef___ops__function__FnMut__wasm_bindgen_641f96222e64b03b___JsValue____Output_______: (a: number, b: number) => void;
    readonly wasm_bindgen_641f96222e64b03b___closure__destroy___dyn_core_f0fd674eaa06beef___ops__function__FnMut__wasm_bindgen_641f96222e64b03b___JsValue____Output___core_f0fd674eaa06beef___result__Result_____wasm_bindgen_641f96222e64b03b___JsError___: (a: number, b: number) => void;
    readonly wasm_bindgen_641f96222e64b03b___convert__closures_____invoke___wasm_bindgen_641f96222e64b03b___JsValue__core_f0fd674eaa06beef___result__Result_____wasm_bindgen_641f96222e64b03b___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_641f96222e64b03b___convert__closures_____invoke___js_sys_f479fed54ab3b745___Function_fn_wasm_bindgen_641f96222e64b03b___JsValue_____wasm_bindgen_641f96222e64b03b___sys__Undefined___js_sys_f479fed54ab3b745___Function_fn_wasm_bindgen_641f96222e64b03b___JsValue_____wasm_bindgen_641f96222e64b03b___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_641f96222e64b03b___convert__closures_____invoke___wasm_bindgen_641f96222e64b03b___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
