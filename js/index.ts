import isNodeJS from './is-node';
import { Go } from './wasm_exec';

declare var WebAssembly: any;

const MODULE = 'ferret.wasm';

export class Ferret {
    constructor(go: Go) {
    }

    exec() {
    }
}

export async function create(module?: string): Promise<Ferret> {
    let file;

    if (!isNodeJS) {
        file = await fetch(module || MODULE);

    } else {
        const fs = require('fs');
        const path = require('path');

        file = await new Promise((resolve, reject) => {
            const targetModule = module || path.resolve(__dirname, MODULE);

            fs.readFile(targetModule, (err, buffer) => {
                if (err != null) {
                    return reject(err)
                }

                return resolve(buffer);
            });
        });
    }

    const go = new Go();
    const asm = await WebAssembly.instantiate(file, go.importObject);

    go.run(asm.instance);

    return new Ferret(go);
}