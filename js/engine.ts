import type { BridgeResult, GoBridge } from './bridge';
import { unwrap } from './bridge';
import type {
    Engine,
    ExecutionOptions,
    Params,
    Plan,
    Session,
    SessionOptions,
    SessionRunOptions,
    SourceInput,
    Version,
} from './types';

function normalizeSource(source: SourceInput): { name: string; text: string } {
    if (typeof source === 'string') {
        return { name: 'anonymous', text: source };
    }
    if (
        source == null ||
        typeof source !== 'object' ||
        typeof source.text !== 'string'
    ) {
        throw new TypeError('source must be a string or a source object');
    }
    if (source.name != null && typeof source.name !== 'string') {
        throw new TypeError('source.name must be a string');
    }
    return { name: source.name || 'anonymous', text: source.text };
}

async function runWithCleanup<T>(
    run: () => Promise<T>,
    cleanup: () => Promise<void>,
): Promise<T> {
    let runError: unknown;
    try {
        return await run();
    } catch (error) {
        runError = error;
        throw error;
    } finally {
        try {
            await cleanup();
        } catch (cleanupError) {
            if (runError !== undefined) {
                throw new AggregateError(
                    [runError, cleanupError],
                    'Execution and cleanup both failed',
                );
            }
            throw cleanupError;
        }
    }
}

export class SessionImpl implements Session {
    readonly #bridge: GoBridge;
    readonly #id: string;
    readonly #owner: PlanImpl;
    #closed = false;
    #running = false;

    /** @internal */
    constructor(bridge: GoBridge, id: string, owner: PlanImpl) {
        this.#bridge = bridge;
        this.#id = id;
        this.#owner = owner;
    }

    /** @internal */
    get running(): boolean {
        return this.#running;
    }

    /** @internal */
    get closed(): boolean {
        return this.#closed;
    }

    async run<T = unknown>(options: SessionRunOptions = {}): Promise<T> {
        if (this.#closed) {
            throw new Error('Session is closed');
        }
        if (this.#running) {
            throw new Error('Session is already running');
        }
        if (
            options == null ||
            (options.signal != null &&
                typeof options.signal.addEventListener !== 'function')
        ) {
            throw new TypeError('signal must be an AbortSignal');
        }

        this.#running = true;
        try {
            return await new Promise<T>((resolve, reject) => {
                const callback = (result: BridgeResult<string>): void => {
                    try {
                        const json = unwrap(result);
                        resolve(JSON.parse(json) as T);
                    } catch (error) {
                        reject(error);
                    }
                };

                try {
                    unwrap(
                        this.#bridge.runSession(
                            this.#id,
                            options.signal,
                            callback,
                        ),
                    );
                } catch (error) {
                    reject(error);
                }
            });
        } finally {
            this.#running = false;
        }
    }

    async close(): Promise<void> {
        if (this.#closed) {
            return;
        }
        if (this.#running) {
            throw new Error('Cannot close a running session');
        }
        unwrap(this.#bridge.closeSession(this.#id));
        this.#closed = true;
        this.#owner.removeSession(this);
    }
}

export class PlanImpl implements Plan {
    readonly #bridge: GoBridge;
    readonly #id: string;
    readonly #owner: EngineImpl;
    readonly #sessions = new Set<SessionImpl>();
    readonly params: readonly string[];
    #closed = false;

    /** @internal */
    constructor(
        bridge: GoBridge,
        id: string,
        params: string[],
        owner: EngineImpl,
    ) {
        this.#bridge = bridge;
        this.#id = id;
        this.#owner = owner;
        this.params = Object.freeze([...params]);
    }

    /** @internal */
    get hasRunningSession(): boolean {
        for (const session of this.#sessions) {
            if (session.running) {
                return true;
            }
        }
        return false;
    }

    /** @internal */
    removeSession(session: SessionImpl): void {
        this.#sessions.delete(session);
    }

    createSession(options: SessionOptions = {}): SessionImpl {
        if (this.#closed) {
            throw new Error('Plan is closed');
        }
        if (options == null || !isParams(options.params)) {
            throw new TypeError('params must be a plain JavaScript object');
        }

        const id = unwrap(this.#bridge.createSession(this.#id, options.params));
        const session = new SessionImpl(this.#bridge, id, this);
        this.#sessions.add(session);
        return session;
    }

    async run<T = unknown>(options: ExecutionOptions = {}): Promise<T> {
        if (options == null || !isParams(options.params)) {
            throw new TypeError('params must be a plain JavaScript object');
        }
        const session = this.createSession({ params: options.params });
        return runWithCleanup(
            () => session.run<T>({ signal: options.signal }),
            () => session.close(),
        );
    }

    async close(): Promise<void> {
        if (this.#closed) {
            return;
        }
        if (this.hasRunningSession) {
            throw new Error('Cannot close a plan with a running session');
        }

        for (const session of [...this.#sessions]) {
            await session.close();
        }
        unwrap(this.#bridge.closePlan(this.#id));
        this.#closed = true;
        this.#owner.removePlan(this);
    }
}

export class EngineImpl implements Engine {
    readonly #bridge: GoBridge;
    readonly #runtimeDone: Promise<void>;
    readonly #plans = new Set<PlanImpl>();
    readonly version: Readonly<Version>;
    #closed = false;

    /** @internal */
    constructor(
        bridge: GoBridge,
        runtimeDone: Promise<void>,
        version: Version,
    ) {
        this.#bridge = bridge;
        this.#runtimeDone = runtimeDone;
        this.version = Object.freeze({ ...version });
    }

    /** @internal */
    removePlan(plan: PlanImpl): void {
        this.#plans.delete(plan);
    }

    compile(source: SourceInput): PlanImpl {
        if (this.#closed) {
            throw new Error('Engine is closed');
        }
        const normalized = normalizeSource(source);
        const result = unwrap(
            this.#bridge.compile(normalized.name, normalized.text),
        );
        const plan = new PlanImpl(this.#bridge, result.id, result.params, this);
        this.#plans.add(plan);
        return plan;
    }

    async run<T = unknown>(
        source: SourceInput,
        options: ExecutionOptions = {},
    ): Promise<T> {
        const plan = this.compile(source);
        return runWithCleanup(
            () => plan.run<T>(options),
            () => plan.close(),
        );
    }

    async close(): Promise<void> {
        if (this.#closed) {
            return;
        }
        for (const plan of this.#plans) {
            if (plan.hasRunningSession) {
                throw new Error(
                    'Cannot close an engine with a running session',
                );
            }
        }
        for (const plan of [...this.#plans]) {
            await plan.close();
        }

        unwrap(this.#bridge.closeEngine());
        this.#closed = true;
        unwrap(this.#bridge.shutdown());
        await this.#runtimeDone;
    }
}

function isParams(value: Params | undefined): boolean {
    if (value === undefined) {
        return true;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
