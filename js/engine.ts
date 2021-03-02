import { Go } from './wasm_exec';
import { Program } from './program';
import { Compiler, createCallback, RuntimeFunction, Version } from './compiler';
import { assert } from './helpers';

export class Engine {
    // @ts-ignore
    private readonly __go: Go;
    private readonly __compiler: Compiler;
    private readonly __version: Readonly<Version>;

    constructor(go: Go) {
        this.__go = go;
        this.__compiler = go.platform.$ferret;

        const res = this.__compiler.version();

        this.__version = Object.freeze(
            res.ok
                ? (res.data as Version)
                : {
                      self: 'undefined',
                      ferret: 'undefined',
                  },
        );
    }

    public version(): Readonly<Version> {
        return this.__version;
    }

    public register(name: string, fn: RuntimeFunction): void {
        const res = this.__compiler.register(name, fn);

        assert(res);

        if (!res.ok) {
            throw new Error(res.error);
        }
    }

    public compile(query: string): Program {
        const res = this.__compiler.compile(query);

        assert(res);

        if (!res.ok) {
            throw new Error(res.error);
        }

        return new Program(this.__compiler, res.data as string);
    }

    public async exec<T>(query: string, params: object = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.__compiler.exec(
                query,
                params,
                createCallback(resolve, reject),
            );
        });
    }
}
