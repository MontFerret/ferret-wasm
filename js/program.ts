import { Compiler } from './compiler';
import { assert } from './helpers';

export class Program {
    private readonly __compiler: Compiler;
    private readonly __id: string;

    constructor(engine: Compiler, id: string) {
        this.__compiler = engine;
        this.__id = id;
    }

    public run<T = any>(args?: object): T {
        const res = this.__compiler.run(this.__id, args);

        assert(res);

        if (res.ok) {
            return res.data as T;
        }

        throw new Error(res.error);
    }
}
