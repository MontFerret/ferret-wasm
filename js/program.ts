import { Compiler, createCallback } from './compiler';
import { assert } from './helpers';

export class Program {
    private __compiler: Compiler;
    private __id: string;

    constructor(engine: Compiler, id: string) {
        this.__compiler = engine;
        this.__id = id;
    }

    public get isDestroyed(): boolean {
        return this.__compiler == null;
    }

    public async run<T = any>(params: object = {}): Promise<T> {
        if (this.isDestroyed) {
            return Promise.reject(new Error('Program is destroyed'));
        }

        return new Promise<T>((resolve, reject) => {
            this.__compiler.run(
                this.__id,
                params,
                createCallback(resolve, reject),
            );
        });
    }

    public destroy(): void {
        const res = this.__compiler.destroy(this.__id);

        assert(res);

        if (!res.ok) {
            throw new Error(res.error);
        }

        delete this.__compiler;
        delete this.__id;
    }
}
