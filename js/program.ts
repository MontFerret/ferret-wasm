import { Compiler, createCallback } from './compiler';

export class Program {
    private readonly __compiler: Compiler;
    private readonly __id: string;

    constructor(engine: Compiler, id: string) {
        this.__compiler = engine;
        this.__id = id;
    }

    public async run<T = any>(params: object = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.__compiler.run(this.__id, params, createCallback(resolve, reject));
        });
    }
}
