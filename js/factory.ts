import type {
    FerretGlobals,
    GoBridge,
    GoRuntime,
    GoRuntimeConstructor,
} from './bridge';
import { unwrap } from './bridge';
import { EngineImpl } from './engine';
import type { CreateOptions, Engine } from './types';

export interface Platform {
    defaultWasm: URL;
    prepare(runtime: URL): Promise<void>;
    load(
        source: string | URL | ArrayBuffer | Uint8Array | WebAssembly.Module,
    ): Promise<BufferSource | WebAssembly.Module>;
}

export async function createWithPlatform(
    platform: Platform,
    runtimeURL: URL,
    options: CreateOptions = {},
): Promise<Engine> {
    if (options == null || typeof options !== 'object') {
        throw new TypeError('options must be an object');
    }

    if (options.functions != null && !isPlainObject(options.functions)) {
        throw new TypeError('functions must be a plain JavaScript object');
    }

    await platform.prepare(runtimeURL);
    const globals = globalThis as typeof globalThis & FerretGlobals;
    const Go = globals.Go as GoRuntimeConstructor | undefined;

    if (Go == null) {
        throw new Error('Go WASM runtime did not initialize');
    }

    const token = createToken();
    globals.__ferretWasmBridges ??= Object.create(null);

    const go = new Go();
    go.env = { ...go.env, FERRET_WASM_INSTANCE_ID: token };
    const input = await platform.load(options.wasm ?? platform.defaultWasm);
    let instance: WebAssembly.Instance;

    if (input instanceof WebAssembly.Module) {
        instance = await WebAssembly.instantiate(input, go.importObject);
    } else {
        const instantiated = await WebAssembly.instantiate(
            input,
            go.importObject,
        );
        instance = instantiated.instance;
    }

    const runtimeDone = runGoRuntime(go, instance);

    let bridge: GoBridge;

    try {
        bridge = await waitForBridge(globals, token, runtimeDone);
        delete globals.__ferretWasmBridges?.[token];
        unwrap(bridge.initialize(options.functions ?? {}));
    } catch (error) {
        const candidate = globals.__ferretWasmBridges?.[token];
        delete globals.__ferretWasmBridges?.[token];

        if (candidate != null) {
            try {
                unwrap(candidate.closeEngine());
                unwrap(candidate.shutdown());
                await runtimeDone;
            } catch {
                // Preserve the initialization error.
            }
        }

        throw error;
    }

    return new EngineImpl(bridge, runtimeDone, unwrap(bridge.version()));
}

/** @internal */
export function runGoRuntime(
    go: GoRuntime,
    instance: WebAssembly.Instance,
): Promise<void> {
    return go.run(instance).finally(() => {
        for (const timeout of go._scheduledTimeouts.values()) {
            clearTimeout(timeout);
        }

        go._scheduledTimeouts.clear();
    });
}

async function waitForBridge(
    globals: typeof globalThis & FerretGlobals,
    token: string,
    runtimeDone: Promise<void>,
): Promise<GoBridge> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const bridge = globals.__ferretWasmBridges?.[token];

        if (bridge != null) {
            return bridge;
        }

        await Promise.race([
            new Promise<void>((resolve) => setTimeout(resolve, 0)),
            runtimeDone.then(() => {
                throw new Error(
                    'Go runtime exited before publishing its bridge',
                );
            }),
        ]);
    }

    throw new Error('Timed out waiting for the Go WASM bridge');
}

function createToken(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPlainObject(value: unknown): boolean {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
