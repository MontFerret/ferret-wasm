import { createWithPlatform, type Platform } from './factory';
import type { CreateOptions } from './types';

const moduleURL = import.meta.url;
const platform: Platform = {
    defaultWasm: new URL('./ferret.wasm', moduleURL),
    async prepare(runtime): Promise<void> {
        await import(/* @vite-ignore */ runtime.href);
    },
    async load(source): Promise<BufferSource | WebAssembly.Module> {
        if (source instanceof WebAssembly.Module) {
            return source;
        }

        if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
            return source;
        }

        const response = await fetch(source);

        if (!response.ok) {
            throw new Error(
                `Failed to load WASM: ${response.status} ${response.statusText}`,
            );
        }

        return response.arrayBuffer();
    },
};

export function create(options?: CreateOptions) {
    return createWithPlatform(
        platform,
        new URL('./wasm_exec.js', moduleURL),
        options,
    );
}

export type {
    CompileOptions,
    CreateOptions,
    Engine,
    ExecutionOptions,
    HTTPOptions,
    Params,
    Plan,
    RuntimeFunction,
    Session,
    SessionOptions,
    SessionRunOptions,
    SourceInput,
    Version,
} from './types';
