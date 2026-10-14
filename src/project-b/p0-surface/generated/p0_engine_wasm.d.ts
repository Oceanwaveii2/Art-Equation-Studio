/* tslint:disable */
/* eslint-disable */

/**
 * Worker-local persistent decoded resources. Raw canonical bytes and CPU
 * pixmaps are both counted; neither is inferred from GPU readback.
 */
export class B4CpuRenderer {
    free(): void;
    [Symbol.dispose](): void;
    dispose(): void;
    constructor();
    register_image(reference_json: string, pixels: Uint8Array): string;
    render_snapshot(width: number, height: number, snapshot_json: string, scale: number, pan_x: number, pan_y: number): Uint8Array;
    resource_stats(): string;
    retain_images(references_json: string): string;
}

export class B4SurfaceRenderer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Check device health while idle. Calls must not overlap initialization
     * or preparation, which hold the mutable renderer borrow until resolved.
     */
    check_health(): void;
    /**
     * Destroy the actual device without disposing its observable state.
     * WebGPU resolves GPUDevice.lost asynchronously; the installed callback
     * then makes check_health report DEVICE_LOST. Do not synthesize a loss
     * flag or clear state here, which would bypass that recovery evidence.
     * Calls must not overlap initialization/preparation's mutable borrow.
     */
    destroy_device_for_recovery_test(): void;
    discard_prepared(): void;
    dispose(): void;
    /**
     * Warm the optional second rasterizer on this existing browser device.
     * It never creates another canvas, surface, queue or image atlas.
     */
    enable_hybrid(): Promise<string>;
    /**
     * Initialize the main-thread canvas; no document/project state is opened.
     */
    initialize(canvas: HTMLCanvasElement): Promise<string>;
    load_retained_scene(snapshot_json: string, expected_revision: number): number;
    constructor();
    patch_retained_scene(patch_json: string, expected_revision: number): number;
    prepare_retained_frame(width: number, height: number, revision: number, scale: number, pan_x: number, pan_y: number): Promise<string>;
    /**
     * Render into the retained target only. No visible canvas resize,
     * surface configuration/acquisition or presentation happens here.
     * The caller checks its generation before synchronously committing.
     */
    prepare_snapshot(width: number, height: number, snapshot_json: string, scale: number, pan_x: number, pan_y: number): Promise<string>;
    /**
     * One synchronous commit point for surface pixels and caller-owned DOM
     * ownership/camera updates. A prepared frame is consumed exactly once.
     * Preparation queue completion does not certify scan-out; this method
     * submits the final small blit and presents in the current JS turn.
     */
    present_prepared(): string;
    /**
     * Registration is synchronous and must finish before async preparation
     * takes the mutable renderer borrow. Revisions are immutable.
     */
    register_image(reference_json: string, pixels: Uint8Array): string;
    resource_stats(): string;
    retain_images(references_json: string): string;
    set_completion_policy(policy: string): void;
    set_render_policy(policy: string): void;
    /**
     * Representative checked work on the actual viewport device; never presents test pixels.
     */
    warm_classic(): Promise<string>;
}

/**
 * Explicit registered font authority; no fabricated family or system fallback.
 */
export class TextEngine {
    free(): void;
    [Symbol.dispose](): void;
    constructor(epoch: string);
    register_font(key: string, revision: string, face_index: number, bytes: Uint8Array): string;
    remove_font(key: string): void;
    resource_stats(): string;
    shape(request: string): string;
}

export function render_cpu_snapshot(width: number, height: number, snapshot_json: string, scale: number, pan_x: number, pan_y: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_textengine_free: (a: number, b: number) => void;
    readonly textengine_new: (a: number, b: number) => [number, number, number];
    readonly textengine_register_font: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly textengine_remove_font: (a: number, b: number, c: number) => [number, number];
    readonly textengine_resource_stats: (a: number) => [number, number];
    readonly textengine_shape: (a: number, b: number, c: number) => [number, number, number, number];
    readonly __wbg_b4surfacerenderer_free: (a: number, b: number) => void;
    readonly b4surfacerenderer_check_health: (a: number) => [number, number];
    readonly b4surfacerenderer_destroy_device_for_recovery_test: (a: number) => void;
    readonly b4surfacerenderer_discard_prepared: (a: number) => void;
    readonly b4surfacerenderer_dispose: (a: number) => void;
    readonly b4surfacerenderer_enable_hybrid: (a: number) => any;
    readonly b4surfacerenderer_initialize: (a: number, b: any) => any;
    readonly b4surfacerenderer_load_retained_scene: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly b4surfacerenderer_new: () => number;
    readonly b4surfacerenderer_patch_retained_scene: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly b4surfacerenderer_prepare_retained_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly b4surfacerenderer_prepare_snapshot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly b4surfacerenderer_present_prepared: (a: number) => [number, number, number, number];
    readonly b4surfacerenderer_register_image: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly b4surfacerenderer_resource_stats: (a: number) => [number, number, number, number];
    readonly b4surfacerenderer_retain_images: (a: number, b: number, c: number) => [number, number, number, number];
    readonly b4surfacerenderer_set_completion_policy: (a: number, b: number, c: number) => [number, number];
    readonly b4surfacerenderer_set_render_policy: (a: number, b: number, c: number) => [number, number];
    readonly b4surfacerenderer_warm_classic: (a: number) => any;
    readonly render_cpu_snapshot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly __wbg_b4cpurenderer_free: (a: number, b: number) => void;
    readonly b4cpurenderer_dispose: (a: number) => void;
    readonly b4cpurenderer_new: () => number;
    readonly b4cpurenderer_register_image: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly b4cpurenderer_render_snapshot: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly b4cpurenderer_resource_stats: (a: number) => [number, number];
    readonly b4cpurenderer_retain_images: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasm_bindgen_fd94ed078178adef___closure__destroy___dyn_core_f0fd674eaa06beef___ops__function__FnMut__wasm_bindgen_fd94ed078178adef___JsValue____Output_______: (a: number, b: number) => void;
    readonly wasm_bindgen_fd94ed078178adef___closure__destroy___dyn_core_f0fd674eaa06beef___ops__function__FnMut__wasm_bindgen_fd94ed078178adef___JsValue____Output___core_f0fd674eaa06beef___result__Result_____wasm_bindgen_fd94ed078178adef___JsError___: (a: number, b: number) => void;
    readonly wasm_bindgen_fd94ed078178adef___convert__closures_____invoke___wasm_bindgen_fd94ed078178adef___JsValue__core_f0fd674eaa06beef___result__Result_____wasm_bindgen_fd94ed078178adef___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_fd94ed078178adef___convert__closures_____invoke___js_sys_e427354ee19c6df8___Function_fn_wasm_bindgen_fd94ed078178adef___JsValue_____wasm_bindgen_fd94ed078178adef___sys__Undefined___js_sys_e427354ee19c6df8___Function_fn_wasm_bindgen_fd94ed078178adef___JsValue_____wasm_bindgen_fd94ed078178adef___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_fd94ed078178adef___convert__closures_____invoke___wasm_bindgen_fd94ed078178adef___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_fd94ed078178adef___convert__closures_____invoke___wasm_bindgen_fd94ed078178adef___JsValue______true__1: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
