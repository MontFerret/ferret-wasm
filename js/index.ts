import isNodeJS from './is-node';
import { Go } from './wasm_exec';
import { Engine } from './engine';

declare var WebAssembly: any;

const MODULE_PATH = 'ferret.wasm';

export const isNode = isNodeJS;

export async function create(module?: string): Promise<Engine> {
    let file;

    if (!isNodeJS) {
        const resp = await fetch(module || MODULE_PATH);
        file = await resp.arrayBuffer();
    } else {
        const fs = require('fs');
        const path = require('path');

        file = await new Promise((resolve, reject) => {
            const targetModule = module || path.resolve(__dirname, MODULE_PATH);

            fs.readFile(targetModule, (err, buffer) => {
                if (err != null) {
                    return reject(err);
                }

                return resolve(buffer);
            });
        });
    }

    const go = new Go();
    const asm = await WebAssembly.instantiate(file, go.importObject);

    go.run(asm.instance);

    return new Engine(go);
}
