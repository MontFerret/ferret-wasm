import isNodeJS from './is-node';
import { Go } from './wasm_exec';

declare var WebAssembly: any;

export class Ferret {
    constructor(go: Go) {
    }

    exec() {
    }
}

export async function create(module: string = './ferret.wasm'): Promise<Ferret> {
    let file;

    if (!isNodeJS) {
        file = await fetch(module);

    } else {
        const fs = require('fs');

        file = await new Promise((resolve, reject) => {
            fs.readFile(module, (err, buffer) => {
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