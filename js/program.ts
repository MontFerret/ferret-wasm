import { Compiler } from './compiler';

export class Program {
    private readonly __compiler: Compiler;
    private readonly __id: string;

    constructor(engine: Compiler, id: string) {
        this.__compiler = engine;
        this.__id = id;
    }

    public run<T = any>(args?: object): T {
        const result = this.__compiler.run(this.__id, args);

        if (result.ok) {
            return result.data as T;
        }

        throw new Error(result.error);
    }
}
