export type SourceInput = string | { name?: string; text: string };
export type Params = Record<string, unknown>;
export type RuntimeFunction = (
    ...args: unknown[]
) => unknown | Promise<unknown>;

export interface CreateOptions {
    wasm?: string | URL | ArrayBuffer | Uint8Array | WebAssembly.Module;
    functions?: Record<string, RuntimeFunction>;
}

export interface ExecutionOptions {
    params?: Params;
    signal?: AbortSignal;
}

export interface SessionOptions {
    params?: Params;
}

export interface SessionRunOptions {
    signal?: AbortSignal;
}

export interface Version {
    wasm: string;
    ferret: string;
}

export interface Session {
    run<T = unknown>(options?: SessionRunOptions): Promise<T>;
    close(): Promise<void>;
}

export interface Plan {
    readonly params: readonly string[];
    createSession(options?: SessionOptions): Session;
    run<T = unknown>(options?: ExecutionOptions): Promise<T>;
    close(): Promise<void>;
}

export interface Engine {
    readonly version: Readonly<Version>;
    compile(source: SourceInput): Plan;
    run<T = unknown>(
        source: SourceInput,
        options?: ExecutionOptions,
    ): Promise<T>;
    close(): Promise<void>;
}
